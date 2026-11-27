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
/** One selectable office model (owner, 2026-11-27): model 1 is LLM_*, then
 *  LLM_2_*, LLM_3_*, … — each with its own server URL, read until the first
 *  missing number. The dropdown shows `model` (the model's own name). */
export interface OfficeModelConfig {
  baseUrl: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
  vision: boolean;
  reasoning: boolean;
  apiKey?: string;
}

/** The highest LLM_<n>_ number read; a gap ends the list earlier. */
export const MAX_OFFICE_MODELS = 20;

function noProxyHosts(): string[] {
  return (process.env.NO_PROXY ?? process.env.no_proxy ?? '').split(',').map((part) => part.trim().toLowerCase());
}

function officeModelFrom(prefix: string): OfficeModelConfig {
  const env = (name: string) => process.env[prefix + name];
  const rawUrl = env("BASE_URL")?.trim();
  const model = env("MODEL")?.trim();
  if (!rawUrl || !model) throw new Error(`${prefix}BASE_URL and ${prefix}MODEL are required`);
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.replace(/\/$/u, '').endsWith('/v1') || url.username || url.password || url.search || url.hash) {
    throw new Error(`${prefix}BASE_URL must be an HTTP(S) API base ending in /v1`);
  }
  const hostname = url.hostname.toLowerCase();
  if (!noProxyHosts().some((part) => part === hostname || part === `.${hostname}` || part === '*')) {
    throw new Error(`NO_PROXY must include the internal LLM host ${hostname}`);
  }
  const apiKey = env("API_KEY")?.trim();
  return {
    baseUrl: url.toString().replace(/\/$/u, ''),
    model,
    contextWindow: requiredPositiveInt(env("CONTEXT_WINDOW"), `${prefix}CONTEXT_WINDOW`),
    maxTokens: requiredPositiveInt(env("MAX_TOKENS"), `${prefix}MAX_TOKENS`),
    vision: requiredBoolean(env("VISION"), `${prefix}VISION`),
    reasoning: requiredBoolean(env("REASONING"), `${prefix}REASONING`),
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Every configured office model, model 1 first. Model names must differ:
 *  a session stores the name it was started with. */
export function officeModels(): OfficeModelConfig[] {
  const models = [officeModelFrom("LLM_")];
  for (let n = 2; n <= MAX_OFFICE_MODELS; n++) {
    if (!process.env[`LLM_${n}_BASE_URL`]?.trim() && !process.env[`LLM_${n}_MODEL`]?.trim()) break;
    models.push(officeModelFrom(`LLM_${n}_`));
  }
  const seen = new Set<string>();
  for (const m of models) {
    if (seen.has(m.model)) throw new Error(`Model name ${m.model} is configured twice; each LLM_<n>_MODEL must differ`);
    seen.add(m.model);
  }
  return models;
}

/** One configured model by name; undefined when it is not (or no longer) configured. */
export function officeModel(name: string): OfficeModelConfig | undefined {
  return officeModels().find((m) => m.model === name);
}

export function officeConfig(): OfficeConfig {
  const first = officeModelFrom("LLM_");
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  const llmToolMode = process.env.LLM_TOOL_MODE?.trim();
  if (llmToolMode !== "native" && llmToolMode !== "prompt") throw new Error("LLM_TOOL_MODE must be native or prompt");
  return {
    llmBaseUrl: first.baseUrl,
    llmModel: first.model,
    llmContextWindow: first.contextWindow,
    llmMaxTokens: first.maxTokens,
    llmVision: first.vision,
    llmReasoning: first.reasoning,
    ...(first.apiKey ? { llmApiKey: first.apiKey } : {}),
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

/** The default model pin (model 1): new sessions without a choice, notes
 *  extraction, picture reading, and sessions whose model is gone. */
export function fixedOfficeModelSpec(): { provider: "office"; id: string } {
  return { provider: "office", id: officeConfig().llmModel };
}

/** A session's model pin: its stored model when still configured, else model 1. */
export function officeModelSpecFor(name: string | undefined): { provider: "office"; id: string } {
  return name !== undefined && officeModel(name) ? { provider: "office", id: name } : fixedOfficeModelSpec();
}
