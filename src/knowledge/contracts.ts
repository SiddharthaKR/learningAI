export type KnowledgeFormat = "pdf" | "pptx" | "docx" | "md" | "txt";

export type KnowledgeCitation =
	| { format: "pdf"; fileName: string; page: number }
	| { format: "pptx"; fileName: string; slide: number; title: string }
	| { format: "docx"; fileName: string; heading?: string; paragraph: number }
	| { format: "md" | "txt"; fileName: string; heading?: string; lineStart: number; lineEnd: number };

export interface ExtractedBlock {
	text: string;
	citation: KnowledgeCitation;
}

export type ExtractedDocument = {
	fileName: string;
	format: KnowledgeFormat;
} & (
	| { status: "ready"; blocks: ExtractedBlock[] }
	| { status: "no_text_layer"; blocks: [] }
);
