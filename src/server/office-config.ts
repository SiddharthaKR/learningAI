/** Server-owned office deployment settings. Never expose this object to the browser. */
export interface OfficeConfig {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
  embeddingModel?: string;
  port: number;
  sessionSecret: string;
  knowledgeDir: string;
  maxConcurrentLlm: number;
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function officeConfig(): OfficeConfig {
  const rawUrl = process.env.LLM_BASE_URL?.trim();
  const llmModel = process.env.LLM_MODEL?.trim();
  if (!rawUrl || !llmModel) throw new Error('LLM_BASE_URL and LLM_MODEL are required');
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.replace(/\/$/u, '').endsWith('/v1') || url.username || url.password || url.search || url.hash) {
    throw new Error('LLM_BASE_URL must be an HTTP(S) API base ending in /v1');
  }
  const hostname = url.hostname.toLowerCase();
  const noProxy = (process.env.NO_PROXY ?? process.env.no_proxy ?? '').split(',').map((part) => part.trim().toLowerCase());
  if (!noProxy.some((part) => part === hostname || part === `.${hostname}` || part === '*')) {
    throw new Error(`NO_PROXY must include the internal LLM host ${hostname}`);
  }
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return {
    llmBaseUrl: url.toString().replace(/\/$/u, ''),
    llmModel,
    ...(process.env.LLM_API_KEY?.trim() ? { llmApiKey: process.env.LLM_API_KEY.trim() } : {}),
    ...(process.env.EMBEDDING_MODEL?.trim() ? { embeddingModel: process.env.EMBEDDING_MODEL.trim() } : {}),
    port: positiveInt(process.env.PORT, 3000, 'PORT'),
    sessionSecret,
    knowledgeDir: process.env.KNOWLEDGE_DIR?.trim() ?? '',
    maxConcurrentLlm: positiveInt(process.env.MAX_CONCURRENT_LLM, 4, 'MAX_CONCURRENT_LLM'),
  };
}
