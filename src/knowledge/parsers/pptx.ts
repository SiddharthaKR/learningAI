import { posix } from "node:path";
import { extractSelectedZipEntries, KnowledgeArchiveError } from "../archive.ts";
import type { ExtractedBlock } from "../contracts.ts";
import { descendants, officeElements, paragraphText } from "./office.ts";

function paragraphs(data: Uint8Array): string[] {
	return descendants(officeElements(data), "a:p").map((paragraph) => paragraphText(paragraph, "a:t")).filter((text) => text.trim());
}

export function extractPptx(fileName: string, data: Uint8Array): ExtractedBlock[] {
	// Slides, relationships, and notes share one cumulative actual-output budget.
	const entries = extractSelectedZipEntries(data, (name) => /^ppt\/(?:slides\/(?:slide[1-9]\d*\.xml|_rels\/slide[1-9]\d*\.xml\.rels)|notesSlides\/notesSlide[1-9]\d*\.xml)$/.test(name));
	const slides = [...entries.keys()].filter((name) => /^ppt\/slides\/slide[1-9]\d*\.xml$/.test(name))
		.map((name) => ({ name, slide: Number(/slide(\d+)\.xml$/.exec(name)![1]) })).sort((left, right) => left.slide - right.slide);
	if (!slides.length) throw new KnowledgeArchiveError("XML_INVALID", "The PPTX archive contains no slide XML.");
	const notesForSlide = new Map<string, string[]>();
	for (const { name } of slides) {
		const relationships = entries.get(`ppt/slides/_rels/${posix.basename(name)}.rels`);
		if (!relationships) continue;
		for (const relationship of descendants(officeElements(relationships), "Relationship")) {
			const { "@_Type": type, "@_Target": target, "@_TargetMode": mode } = relationship.attributes;
			if (!type?.endsWith("/notesSlide") || !target || mode === "External") continue;
			const notesPath = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join("ppt/slides", target));
			if (!/^ppt\/notesSlides\/notesSlide[1-9]\d*\.xml$/.test(notesPath)) continue;
			notesForSlide.set(name, [...(notesForSlide.get(name) ?? []), notesPath]);
		}
	}
	const blocks: ExtractedBlock[] = [];
	for (const { name, slide } of slides) {
		const slideParagraphs = paragraphs(entries.get(name)!);
		const noteParagraphs = (notesForSlide.get(name) ?? []).flatMap((notesPath) => {
			const note = entries.get(notesPath);
			return note ? paragraphs(note) : [];
		});
		const text = [slideParagraphs.join("\n"), noteParagraphs.join("\n")].filter(Boolean).join("\n\n");
		if (text.trim()) blocks.push({ text, citation: { format: "pptx", fileName, slide, title: slideParagraphs[0] ?? "" } });
	}
	return blocks;
}
