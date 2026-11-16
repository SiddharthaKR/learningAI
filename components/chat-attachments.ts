import { formatMessage, type ChatInput, type LocaleCatalog } from "@/src/core";

export const pendingAttachmentTurns = new Map<string, Extract<ChatInput, { type: "text" }>>();

export type AttachmentDestination = "chat" | "personal" | "shared";

export interface ChatDocument {
	file: File;
	destination: AttachmentDestination;
}

/** Pictures in one attached file that could not be read (slides are 1-based). */
export interface AttachmentImageIssue {
	fileName: string;
	failedSlides: number[];
	skipped: number;
}

/** Picture problems carried from the new-session page to the session it opens (keyed by chat id). */
export const pendingAttachmentNotices = new Map<string, AttachmentImageIssue[]>();

/** Max pictures described per file; mirrors the server's MAX_DESCRIBED_IMAGES for the notice text. */
const MAX_DESCRIBED_IMAGES = 30;

/** One short, localized line per file with problems; undefined when every picture was read. */
export function formatImageNotice(issues: AttachmentImageIssue[], catalog: LocaleCatalog): string | undefined {
	const copy = catalog.composer;
	const lines: string[] = [];
	for (const { fileName, failedSlides, skipped } of issues) {
		if (failedSlides.length) {
			const template = failedSlides.length === 1 ? copy.imageUnreadableSlide : copy.imagesUnreadableSlides;
			lines.push(formatMessage(template, { file: fileName, slides: failedSlides.join(", ") }));
		}
		if (skipped > 0) lines.push(formatMessage(copy.imagesSkipped, { file: fileName, max: MAX_DESCRIBED_IMAGES }));
	}
	return lines.length ? lines.join(" ") : undefined;
}

/**
 * Upload each attachment, collect its extracted text for the turn, and report any
 * pictures that could not be read. Picture problems never fail the send.
 */
export async function prepareAttachments(prompt: string, documents: ChatDocument[]): Promise<{ text: string; imageIssues: AttachmentImageIssue[] }> {
	const attachments: string[] = [];
	const imageIssues: AttachmentImageIssue[] = [];
	for (const { file, destination } of documents) {
		const form = new FormData();
		form.set("file", file);
		form.set("destination", destination);
		const response = await fetch("/api/knowledge/documents", { method: "POST", body: form });
		const result = await response.json() as { text?: string; truncated?: boolean; error?: string; imageReport?: { failedSlides: number[]; skipped: number } };
		if (!response.ok || !result.text) throw new Error(`${file.name}: ${result.error ?? "upload_failed"}`);
		attachments.push(`Attached document: ${file.name}\n${result.text}${result.truncated ? "\n[Attachment text truncated]" : ""}`);
		const report = result.imageReport;
		if (report && (report.failedSlides.length || report.skipped)) imageIssues.push({ fileName: file.name, failedSlides: report.failedSlides, skipped: report.skipped });
	}
	if (attachments.length === 0) return { text: prompt, imageIssues };
	return { text: [prompt, "Extracted attachment content", ...attachments].join("\n\n"), imageIssues };
}
