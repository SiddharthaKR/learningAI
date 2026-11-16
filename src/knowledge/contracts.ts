export type KnowledgeFormat = "pdf" | "pptx" | "docx" | "md" | "txt";

export type KnowledgeCitation =
	| { format: "pdf"; fileName: string; page: number; imageDescription?: boolean; ocr?: boolean }
	| { format: "pptx"; fileName: string; slide: number; title: string; imageDescription?: boolean }
	| { format: "docx"; fileName: string; heading?: string; paragraph: number; imageDescription?: boolean }
	| { format: "md" | "txt"; fileName: string; heading?: string; lineStart: number; lineEnd: number };

export interface ExtractedBlock {
	text: string;
	citation: KnowledgeCitation;
	/** Heading path, outermost first (e.g. ["Chapter 5", "AXI Interface"]). */
	section?: string[];
	/** "table": keep whole when possible (the chunker avoids splitting it). */
	kind?: "table";
}

export interface ExtractedImage {
	data: Uint8Array;
	mimeType: string;
	width: number;
	height: number;
	citation: KnowledgeCitation;
	/** Heading path where the picture sits, when the reader knows it (Word). */
	section?: string[];
}

export interface KnowledgeChunk {
	id: string;
	sourceId: string;
	text: string;
	citation: KnowledgeCitation;
	/** Heading path of the block this chunk came from (absent on old indexes). */
	section?: string[];
	/** 0-based reading-order position within its source (absent on old indexes). */
	ordinal?: number;
}

export interface KnowledgeResult extends KnowledgeChunk {
	score: number;
}

export type ExtractedDocument = {
	fileName: string;
	format: KnowledgeFormat;
} & (
	| { status: "ready"; blocks: ExtractedBlock[]; images?: ExtractedImage[] }
	| { status: "no_text_layer"; blocks: []; images?: ExtractedImage[] }
);
