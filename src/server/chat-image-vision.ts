import { withImageDescriptions, type LhMessage } from "../core/native-messages.ts";
import { describeOneImage, visionConfigFromEnv, type VisionCallFn } from "../knowledge/vision-job.ts";

/**
 * Chat images through the vision route (owner, 2026-11-19). When the main
 * model does not take images (LLM_VISION=false) and VISION_BASE_URL +
 * VISION_MODEL are set, each image attached to a learner message — in any
 * session: chat, teaching, practice — is described once by the vision model
 * (LM Studio directly, not the Gemma proxy, which cannot carry images). The
 * descriptions are stored on the message; the chat model reads them in place
 * of the pictures. Images are described in parallel; a failure is recorded
 * as unreadable and never throws.
 */
export async function describeAttachedImages(
	appends: LhMessage[],
	options: { env?: Record<string, string | undefined>; callFn?: VisionCallFn } = {},
): Promise<LhMessage[]> {
	const env = options.env ?? process.env;
	if (env.LLM_VISION?.trim().toLowerCase() === "true") return appends;
	// Only the dedicated VISION_* route: with LLM_VISION=false the main-model
	// fallback in visionConfigFromEnv never applies, so this is VISION_* or nothing.
	const config = visionConfigFromEnv(env);
	if (!config) return appends;
	return Promise.all(
		appends.map(async (message) => {
			if (message.role !== "user" || !Array.isArray(message.content)) return message;
			const images = message.content.filter((part) => part.type === "image");
			if (images.length === 0) return message;
			const descriptions = await Promise.all(
				images.map((image) => describeOneImage(image.data, image.mimeType, config, options.callFn)),
			);
			return withImageDescriptions(message, descriptions);
		}),
	);
}
