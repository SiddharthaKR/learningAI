import type { ExtractedBlock, ExtractedImage } from "./contracts.ts";

export interface VisionConfig {
	baseUrl: string;
	model: string;
	apiKey?: string;
}

export type VisionCallFn = (imageBase64: string, mimeType: string, prompt: string) => Promise<string>;

const DESCRIBE_PROMPT = "Describe this image in detail for a text search index. Include all visible text, diagrams, charts, labels, and key visual elements. Be concise but thorough.";

async function defaultVisionCall(imageBase64: string, mimeType: string, prompt: string, config: VisionConfig): Promise<string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
	const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
			max_tokens: 512,
		}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`Vision API ${response.status}: ${await response.text().catch(() => "")}`);
	const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
	const content = body.choices?.[0]?.message?.content;
	if (!content) throw new Error("Vision API returned no content");
	return content;
}

export async function describeImages(images: ExtractedImage[], config: VisionConfig, callFn?: VisionCallFn): Promise<ExtractedBlock[]> {
	const blocks: ExtractedBlock[] = [];
	for (const image of images) {
		try {
			const base64 = Buffer.from(image.data).toString("base64");
			const description = callFn
				? await callFn(base64, image.mimeType, DESCRIBE_PROMPT)
				: await defaultVisionCall(base64, image.mimeType, DESCRIBE_PROMPT, config);
			if (description.trim()) {
				blocks.push({
					text: description.trim(),
					citation: { ...image.citation, imageDescription: true } as ExtractedBlock["citation"],
				});
			}
		} catch {
			// Best-effort: skip failed descriptions without blocking text indexing.
		}
	}
	return blocks;
}
