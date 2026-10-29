import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { restrictedWebGet } from '../src/agent/tools/restricted-web-fetch.ts';

type Fetcher = typeof globalThis.fetch;
const env = { HTTP_PROXY: 'http://proxy.example:8080', HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: '*' };
const publicLookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as any;
const page = () => new Response('<html><body>hello</body></html>', { headers: { 'content-type': 'text/html' } });

function mocked(fetcher: Fetcher, overrides: Record<string, unknown> = {}) {
  return { fetch: fetcher, lookup: publicLookup, env, ...overrides };
}

describe('restricted web fetch', () => {
  it('uses ProxyAgent and manual redirects even when NO_PROXY matches', async () => {
    const calls: Array<{ url: string; init: RequestInit & { dispatcher?: unknown } }> = [];
    const fetcher = (async (url: string, init: RequestInit & { dispatcher?: unknown }) => {
      calls.push({ url, init });
      return page();
    }) as Fetcher;
    const result = await restrictedWebGet('https://example.com/page', mocked(fetcher));
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init.method, 'GET');
    assert.equal(calls[0]?.init.redirect, 'manual');
    assert.ok(calls[0]?.init.dispatcher);
  });

  it('rejects local, private, DNS-private, mixed, and blocklisted hosts before fetch', async () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return page(); }) as Fetcher;
    const privateLookup = (async () => [{ address: '10.1.2.3', family: 4 }]) as any;
    const mixedLookup = (async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]) as any;
    for (const [url, deps, pattern] of [
      ['http://localhost/a', mocked(fetcher), /local host/],
      ['http://127.0.0.1/a', mocked(fetcher), /non-public IP/],
      ['http://[::1]/a', mocked(fetcher), /non-public IP/],
      ['https://example.com/a', mocked(fetcher, { lookup: privateLookup }), /non-public IP/],
      ['https://example.com/a', mocked(fetcher, { lookup: mixedLookup }), /non-public IP/],
      ['https://sub.blocked.example/a', mocked(fetcher, { env: { ...env, WEB_FETCH_BLOCKLIST: 'blocked.example' } }), /blocklisted/],
    ] as const) {
      await assert.rejects(restrictedWebGet(url, deps), pattern);
    }
    assert.equal(calls, 0);
  });

  it('validates redirect targets and limits the chain to three', async () => {
    let calls = 0;
    const toLocal = (async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://localhost/admin' } }); }) as Fetcher;
    await assert.rejects(restrictedWebGet('https://example.com', mocked(toLocal)), /local host/);
    assert.equal(calls, 1);
    const loop = (async () => { calls++; return new Response(null, { status: 302, headers: { location: '/next' } }); }) as Fetcher;
    await assert.rejects(restrictedWebGet('https://example.com', mocked(loop)), /too many redirects/);
    assert.equal(calls, 5); // first redirect + four attempts on the second request
  });

  it('requires a proxy and rejects disallowed content types and declared or streamed oversize bodies', async () => {
    const fetcher = (async () => page()) as Fetcher;
    await assert.rejects(restrictedWebGet('https://example.com', mocked(fetcher, { env: {} })), /HTTPS_PROXY is required/);
    const image = (async () => new Response('x', { headers: { 'content-type': 'image/png' } })) as Fetcher;
    await assert.rejects(restrictedWebGet('https://example.com', mocked(image)), /unsupported content type/);
    const declared = (async () => new Response('x', { headers: { 'content-type': 'text/plain', 'content-length': String(6 * 1024 * 1024) } })) as Fetcher;
    await assert.rejects(restrictedWebGet('https://example.com', mocked(declared)), /exceeds 5 MB/);
    const streamed = (async () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/pdf' } })) as Fetcher;
    await assert.rejects(restrictedWebGet('https://example.com', mocked(streamed)), /exceeds 5 MB/);
  });

  it('returns PDF bytes in memory and reports proxy failures without exposing URL paths', async () => {
    const fetcher = (async () => new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })) as Fetcher;
    const result = await restrictedWebGet('https://example.com/private-token', mocked(fetcher));
    assert.equal(result.contentType, 'application/pdf');
    assert.equal(new TextDecoder().decode(result.bytes), '%PDF-1.4');
    const failed = (async () => { throw new Error('private-token'); }) as Fetcher;
    await assert.rejects(restrictedWebGet('https://example.com/private-token', mocked(failed)), (error: Error) => {
      assert.match(error.message, /configured proxy/);
      assert.doesNotMatch(error.message, /private-token/);
      return true;
    });
  });
});
