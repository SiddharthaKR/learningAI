import type { ChatInput } from "@/src/core";

export const pendingAttachmentTurns = new Map<string, Extract<ChatInput, { type: "text" }>>();

export type AttachmentDestination = "chat" | "personal" | "shared";

export interface ChatDocument {
	file: File;
	destination: AttachmentDestination;
}

export async function prepareAttachmentText(prompt: string, documents: ChatDocument[]): Promise<string> {
	const attachments: string[] = [];
	for (const { file, destination } of documents) {
		const form = new FormData();
		form.set("file", file);
		form.set("destination", destination);
		const response = await fetch("/api/knowledge/documents", { method: "POST", body: form });
		const result = await response.json() as { text?: string; truncated?: boolean; error?: string };
		if (!response.ok || !result.text) throw new Error(`${file.name}: ${result.error ?? "upload_failed"}`);
		attachments.push(`Attached document: ${file.name}\n${result.text}${result.truncated ? "\n[Attachment text truncated]" : ""}`);
	}
	if (attachments.length === 0) return prompt;
	return [prompt, "Extracted attachment content", ...attachments].join("\n\n");
}

