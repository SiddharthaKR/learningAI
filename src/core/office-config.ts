/** Server-owned office deployment settings. Never expose this object to the browser. */
export interface OfficeConfig {
  llmBaseUrl: string;
  llmModel: string;
  llmContextWindow: number;
  llmMaxTokens: number;
  llmVision: boolean;
  llmReasoning: boolean;
  llmApiKey?: string;
  embeddingModel?: string;
  visionBaseUrl?: string;
  visionModel?: string;
  visionApiKey?: string;
  port: number;
  sessionSecret: string;
  maxConcurrentLlm: number;
  llmToolMode: "native" | "prompt";
  /** The quiz answer-key check (owner, 2026-11-19): QUIZ_ANSWER_CHECK, on unless "false". */
  quizAnswerCheck: boolean;
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function requiredPositiveInt(value: string | undefined, name: string): number {
  if (!value?.trim()) throw new Error(name + " is required");
  return positiveInt(value, 0, name);
}

function requiredBoolean(value: string | undefined, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(name + " must be true or false");
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
  const llmToolMode = process.env.LLM_TOOL_MODE?.trim();
  if (llmToolMode !== "native" && llmToolMode !== "prompt") throw new Error("LLM_TOOL_MODE must be native or prompt");
  return {
    llmBaseUrl: url.toString().replace(/\/$/u, ''),
    llmModel,
    llmContextWindow: requiredPositiveInt(process.env.LLM_CONTEXT_WINDOW, "LLM_CONTEXT_WINDOW"),
    llmMaxTokens: requiredPositiveInt(process.env.LLM_MAX_TOKENS, "LLM_MAX_TOKENS"),
    llmVision: requiredBoolean(process.env.LLM_VISION, "LLM_VISION"),
    llmReasoning: requiredBoolean(process.env.LLM_REASONING, "LLM_REASONING"),
    ...(process.env.LLM_API_KEY?.trim() ? { llmApiKey: process.env.LLM_API_KEY.trim() } : {}),
    ...(process.env.EMBEDDING_MODEL?.trim() ? { embeddingModel: process.env.EMBEDDING_MODEL.trim() } : {}),
    ...(process.env.VISION_BASE_URL?.trim() ? { visionBaseUrl: process.env.VISION_BASE_URL.trim() } : {}),
    ...(process.env.VISION_MODEL?.trim() ? { visionModel: process.env.VISION_MODEL.trim() } : {}),
    ...(process.env.VISION_API_KEY?.trim() ? { visionApiKey: process.env.VISION_API_KEY.trim() } : {}),
    port: positiveInt(process.env.PORT, 3000, 'PORT'),
    sessionSecret,
    maxConcurrentLlm: positiveInt(process.env.MAX_CONCURRENT_LLM, 4, 'MAX_CONCURRENT_LLM'),
    llmToolMode,
    quizAnswerCheck: process.env.QUIZ_ANSWER_CHECK === undefined || process.env.QUIZ_ANSWER_CHECK.trim() === "" ? true : requiredBoolean(process.env.QUIZ_ANSWER_CHECK.trim(), "QUIZ_ANSWER_CHECK"),
  };
}

/** The sole model pin used by every office role and conversation. */
export function fixedOfficeModelSpec(): { provider: "office"; id: string } {
  return { provider: "office", id: officeConfig().llmModel };
}
