import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface RestrictedFetchDeps {
  fetch?: typeof globalThis.fetch;
  lookup?: typeof dnsLookup;
  env?: Record<string, string | undefined>;
}

export interface RestrictedResponse {
  url: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

function publicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const normalized = ip.toLowerCase();
    if (normalized.includes('.')) return false; // IPv4 mapped or embedded
    const first = Number.parseInt(normalized.split(':')[0] ?? '', 16);
    return first >= 0x2000 && first <= 0x3fff &&
      !normalized.startsWith('2001:db8:') && normalized !== '2001:db8::' &&
      !normalized.startsWith('2001:0:') && !normalized.startsWith('2002:') &&
      !normalized.startsWith('3fff:');
  }
  return false;
}

function validateUrl(raw: string, blocklist: string[]): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('invalid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only HTTP(S) URLs are supported');
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  const host = url.hostname.toLowerCase().replace(/\.$/u, '').replace(/^\[|\]$/gu, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('local host is blocked');
  }
  if (blocklist.some((entry) => host === entry || host.endsWith(`.${entry}`))) throw new Error('host is blocklisted');
  return url;
}

async function validateDns(url: URL, lookup: typeof dnsLookup): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(host)) {
    if (!publicIp(host)) throw new Error('non-public IP address is blocked');
    return;
  }
  let addresses: Array<{ address: string; family: number }>; 
  try { addresses = await lookup(host, { all: true }); }
  catch { throw new Error('DNS lookup failed'); }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((entry) => !publicIp(entry.address))) {
    throw new Error('DNS returned a non-public IP address');
  }
}

export async function restrictedWebGet(rawUrl: string, deps: RestrictedFetchDeps = {}): Promise<RestrictedResponse> {
  const env = deps.env ?? process.env;
  const blocklist = (env.WEB_FETCH_BLOCKLIST ?? '').split(/[\s,]+/u).map((item) => item.trim().toLowerCase().replace(/^\./u, '').replace(/\.$/u, '')).filter(Boolean);
  const lookup = deps.lookup ?? dnsLookup;
  const fetcher = deps.fetch ?? (undiciFetch as unknown as typeof globalThis.fetch);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = rawUrl;
  let agent: ProxyAgent | undefined;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const url = validateUrl(current, blocklist);
      await validateDns(url, lookup);
      const proxy = url.protocol === 'https:' ? (env.HTTPS_PROXY ?? env.https_proxy) : (env.HTTP_PROXY ?? env.http_proxy);
      if (!proxy?.trim()) throw new Error(`${url.protocol.slice(0, -1).toUpperCase()}_PROXY is required for web fetch`);
      let proxyUrl: URL;
      try { proxyUrl = new URL(proxy); } catch { throw new Error('configured proxy URL is invalid'); }
      if (!['http:', 'https:'].includes(proxyUrl.protocol)) throw new Error('configured proxy must use HTTP(S)');
      await agent?.close();
      agent = new ProxyAgent(proxy);
      let response: Response;
      try {
        response = await fetcher(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: { Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9' },
          signal,
          dispatcher: agent,
        } as RequestInit);
      } catch {
        throw new Error(signal.aborted ? 'request timed out after 10 seconds' : 'request failed through configured proxy');
      }
      if (REDIRECTS.has(response.status)) {
        await response.body?.cancel();
        if (redirects === MAX_REDIRECTS) throw new Error('too many redirects (maximum 3)');
        const location = response.headers.get('location');
        if (!location) throw new Error('redirect has no Location header');
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!['text/html', 'application/xhtml+xml', 'text/plain', 'application/pdf'].includes(contentType)) {
        await response.body?.cancel();
        throw new Error(`unsupported content type: ${contentType || 'unknown'}`);
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error('response exceeds 5 MB');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error('response exceeds 5 MB');
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { url: url.toString(), status: response.status, contentType, bytes };
    }
    throw new Error('too many redirects (maximum 3)');
  } finally {
    await agent?.close();
  }
}

