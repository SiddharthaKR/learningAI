import { createHash } from "node:crypto";
import type { ExtractedBlock, ExtractedImage } from "./contracts.ts";

export interface VisionConfig {
	baseUrl: string;
	model: string;
	apiKey?: string;
}

export type VisionCallFn = (imageBase64: string, mimeType: string, prompt: string) => Promise<string>;

/** Runs one model call under the caller's concurrency limit (the server passes the shared background slot). */
export type VisionSlot = <T>(call: () => Promise<T>) => Promise<T>;

/** Vision for indexing: the model plus optional test seam and concurrency limit. */
export interface IndexVision {
	config: VisionConfig;
	callFn?: VisionCallFn;
	runSlot?: VisionSlot;
}

/** Per-document outcome the UI turns into a notice. Slides are 1-based, sorted, unique. */
export interface ImageReport {
	described: number;
	failedSlides: number[];
	skipped: number;
}

/** At most this many unique pictures are described per document; the rest are counted as skipped. */
export const MAX_DESCRIBED_IMAGES = 30;
/** Without a shared slot (e.g. the CLI indexer), this many calls run at once. */
const LOCAL_CONCURRENCY = 2;

/**
 * VISION_BASE_URL + VISION_MODEL when both are set; otherwise the main model when
 * LLM_VISION=true; otherwise off (undefined), which keeps today's text-only indexing.
 */
export function visionConfigFromEnv(env: Record<string, string | undefined>): VisionConfig | undefined {
	const trim = (value: string | undefined) => value?.trim() || undefined;
	const strip = (url: string) => url.replace(/\/+$/u, "");
	const visionUrl = trim(env.VISION_BASE_URL);
	const visionModel = trim(env.VISION_MODEL);
	if (visionUrl && visionModel) {
		const apiKey = trim(env.VISION_API_KEY);
		return { baseUrl: strip(visionUrl), model: visionModel, ...(apiKey ? { apiKey } : {}) };
	}
	const llmUrl = trim(env.LLM_BASE_URL);
	const llmModel = trim(env.LLM_MODEL);
	if (trim(env.LLM_VISION)?.toLowerCase() === "true" && llmUrl && llmModel) {
		const apiKey = trim(env.LLM_API_KEY);
		return { baseUrl: strip(llmUrl), model: llmModel, ...(apiKey ? { apiKey } : {}) };
	}
	return undefined;
}

function imageSlide(image: ExtractedImage): number {
	const citation = image.citation;
	if (citation.format === "pptx") return citation.slide;
	if (citation.format === "pdf") return citation.page;
	if (citation.format === "docx") return citation.paragraph;
	return 1;
}

/**
 * Describe pictures for indexing. Identical pictures (same bytes) are described once;
 * calls run in parallel, each through `runSlot` when given. A failed or empty answer
 * skips that picture and records its slide; it never throws.
 */
export async function describeImagesReport(
	images: ExtractedImage[],
	config: VisionConfig,
	options: { callFn?: VisionCallFn; runSlot?: VisionSlot } = {},
): Promise<{ blocks: ExtractedBlock[] } & ImageReport> {
	const unique: ExtractedImage[] = [];
	const seen = new Set<string>();
	for (const image of images) {
		const hash = createHash("sha256").update(image.data).digest("hex");
		if (seen.has(hash)) continue;
		seen.add(hash);
		unique.push(image);
	}
	const selected = unique.slice(0, MAX_DESCRIBED_IMAGES);
	const describeOne = async (image: ExtractedImage): Promise<ExtractedBlock | null> => {
		try {
			const base64 = Buffer.from(image.data).toString("base64");
			const call = () => options.callFn
				? options.callFn(base64, image.mimeType, DESCRIBE_PROMPT)
				: defaultVisionCall(base64, image.mimeType, DESCRIBE_PROMPT, config);
			const description = (await (options.runSlot ? options.runSlot(call) : call())).trim();
			if (!description) return null;
			return { text: description, citation: { ...image.citation, imageDescription: true } as ExtractedBlock["citation"] };
		} catch {
			return null;
		}
	};
	const results: (ExtractedBlock | null)[] = new Array(selected.length);
	if (options.runSlot) {
		await Promise.all(selected.map(async (image, index) => { results[index] = await describeOne(image); }));
	} else {
		let next = 0;
		const worker = async () => { while (next < selected.length) { const index = next++; results[index] = await describeOne(selected[index]!); } };
		await Promise.all(Array.from({ length: Math.min(LOCAL_CONCURRENCY, selected.length) }, worker));
	}
	const blocks: ExtractedBlock[] = [];
	const failed = new Set<number>();
	results.forEach((block, index) => { if (block) blocks.push(block); else failed.add(imageSlide(selected[index]!)); });
	return { blocks, described: blocks.length, failedSlides: [...failed].sort((a, b) => a - b), skipped: unique.length - selected.length };
}

const DESCRIBE_PROMPT = "Describe this image in detail for a text search index. Include all visible text, diagrams, charts, labels, and key visual elements. Be concise but thorough.";

/** Per-picture timeout: the large server model on a busy GPU needs more than a laptop. */
const VISION_TIMEOUT_MS = 60_000;

/**
 * One OpenAI-compatible vision call. Reasoning models (Gemma 4 with thinking on) can
 * spend the whole token budget thinking and return no description, so the first try
 * asks for no reasoning (measured: 8 s vs 20 s, same quality). A server that rejects
 * that option (400/422) gets one retry without it and room for thinking.
 */
async function defaultVisionCall(imageBase64: string, mimeType: string, prompt: string, config: VisionConfig): Promise<string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
	const signal = AbortSignal.timeout(VISION_TIMEOUT_MS);
	const post = (noReasoning: boolean) => fetch(`${config.baseUrl}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: config.model,
			messages: [{
				role: "user",
				content: [
					{ type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
					{ type: "text", text: prompt },
				],
			}],
			...(noReasoning ? { max_tokens: 1024, reasoning_effort: "none" } : { max_tokens: 2048 }),
		}),
		signal,
	});
	let response = await post(true);
	if (response.status === 400 || response.status === 422) {
		await response.body?.cancel();
		response = await post(false);
	}
	if (!response.ok) throw new Error(`Vision API ${response.status}: ${await response.text().catch(() => "")}`);
	const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
	const content = body.choices?.[0]?.message?.content;
	if (!content) throw new Error("Vision API returned no content");
	return content;
}

/** Best-effort descriptions only (no report): failed pictures are skipped. */
export async function describeImages(images: ExtractedImage[], config: VisionConfig, callFn?: VisionCallFn): Promise<ExtractedBlock[]> {
	return (await describeImagesReport(images, config, callFn ? { callFn } : {})).blocks;
}
