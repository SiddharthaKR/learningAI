import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import { visionConfigFromEnv, type IndexVision } from "../knowledge/vision-job.ts";

/**
 * Vision for document indexing, from .env (VISION_* or the main model when
 * LLM_VISION=true). Each picture call takes one permit of the process-wide
 * background LLM pool, so describing a large deck cannot starve live chats.
 * Undefined when vision is off: indexing stays text-only.
 */
export function knowledgeVision(env: Record<string, string | undefined> = process.env): IndexVision | undefined {
	const config = visionConfigFromEnv(env);
	return config ? { config, runSlot: (call) => withBgLlmSlot(undefined, call) } : undefined;
}
