import { formatMessage, type ChatInput, type LocaleCatalog } from "@/src/core";

export const pendingAttachmentTurns = new Map<string, Extract<ChatInput, { type: "text" }>>();

export type AttachmentDestination = "chat" | "personal" | "shared";

export interface ChatDocument {
	file: File;
	destination: AttachmentDestination;
	/** Read the pictures in this file too (opt-in; PPTX, Word and PDF). */
	readImages?: boolean;
}

/** Where a picture is: slide (PowerPoint), page (PDF) or paragraph under a heading (Word). */
export interface PictureLocation {
	kind: "slide" | "page" | "paragraph";
	number: number;
	heading?: string;
}

/** Pictures in one attached file that could not be read, and how many were over the per-file limit. */
export interface AttachmentImageIssue {
	fileName: string;
	failed: PictureLocation[];
	skipped: number;
}

/** Picture problems carried from the new-session page to the session it opens (keyed by chat id). */
export const pendingAttachmentNotices = new Map<string, AttachmentImageIssue[]>();

/** Max pictures read per file; mirrors the server's MAX_DESCRIBED_IMAGES for the notice text. */
const MAX_DESCRIBED_IMAGES = 30;

/** "slides 3, 7", "page 12", "near “Results”" — in the user's language. */
function describeWhere(failed: PictureLocation[], catalog: LocaleCatalog): string {
	const copy = catalog.composer;
	const parts: string[] = [];
	const numbers = (kind: PictureLocation["kind"], withHeading = false) => failed.filter((l) => l.kind === kind && Boolean(l.heading) === withHeading).map((l) => l.number);
	const add = (list: number[], one: string, many: string) => { if (list.length) parts.push(formatMessage(list.length === 1 ? one : many, { list: list.join(", ") })); };
	add(numbers("slide"), copy.whereSlide, copy.whereSlides);
	add(numbers("page"), copy.wherePage, copy.wherePages);
	const headings = [...new Set(failed.filter((l) => l.kind === "paragraph" && l.heading).map((l) => l.heading!))];
	if (headings.length) parts.push(formatMessage(copy.whereNear, { list: headings.map((text) => formatMessage(copy.quote, { text })).join(", ") }));
	add(numbers("paragraph"), copy.whereParagraph, copy.whereParagraphs);
	return parts.join(", ");
}

/** One short, localized line per file with problems; undefined when every picture was read. */
export function formatImageNotice(issues: AttachmentImageIssue[], catalog: LocaleCatalog): string | undefined {
	const copy = catalog.composer;
	const lines: string[] = [];
	for (const { fileName, failed, skipped } of issues) {
		if (failed.length) lines.push(formatMessage(copy.picturesUnreadable, { file: fileName, where: describeWhere(failed, catalog) }));
		if (skipped > 0) lines.push(formatMessage(copy.imagesSkipped, { file: fileName, max: MAX_DESCRIBED_IMAGES }));
	}
	return lines.length ? lines.join(" ") : undefined;
}

/** The report's problems, or nothing when every picture was read. */
export function imageIssue(fileName: string, report: { failed: PictureLocation[]; skipped: number } | undefined): AttachmentImageIssue | undefined {
	return report && (report.failed.length || report.skipped) ? { fileName, failed: report.failed, skipped: report.skipped } : undefined;
}

/**
 * Upload each attachment, collect its extracted text for the turn, and report any
 * pictures that could not be read. Picture problems never fail the send.
 */
export async function prepareAttachments(prompt: string, documents: ChatDocument[]): Promise<{ text: string; imageIssues: AttachmentImageIssue[] }> {
	const attachments: string[] = [];
	const imageIssues: AttachmentImageIssue[] = [];
	for (const { file, destination, readImages } of documents) {
		const form = new FormData();
		form.set("file", file);
		form.set("destination", destination);
		if (readImages) form.set("readImages", "true");
		const response = await fetch("/api/knowledge/documents", { method: "POST", body: form });
		const result = await response.json() as { text?: string; truncated?: boolean; error?: string; imageReport?: { failed: PictureLocation[]; skipped: number } };
		if (!response.ok || !result.text) throw new Error(`${file.name}: ${result.error ?? "upload_failed"}`);
		attachments.push(`Attached document: ${file.name}\n${result.text}${result.truncated ? "\n[Attachment text truncated]" : ""}`);
		const issue = imageIssue(file.name, result.imageReport);
		if (issue) imageIssues.push(issue);
	}
	if (attachments.length === 0) return { text: prompt, imageIssues };
	return { text: [prompt, "Extracted attachment content", ...attachments].join("\n\n"), imageIssues };
}
