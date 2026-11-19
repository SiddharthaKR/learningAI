import assert from "node:assert/strict";
import { it } from "node:test";
import type { KnowledgeChunk } from "../src/knowledge/contracts.ts";
import { KnowledgeSearch } from "../src/knowledge/search.ts";
import { createKnowledgeTool } from "../src/agent/tools/knowledge.ts";

it("keeps each neighboring slide's citation next to its own text", async () => {
	const chunks: KnowledgeChunk[] = [
		{ id: "slide1", sourceId: "deck", ordinal: 0, text: "Calibrate the sensor first.", citation: { format: "pptx", fileName: "deck.pptx", slide: 1, title: "Calibration" } },
		{ id: "slide2", sourceId: "deck", ordinal: 1, text: "Collect seven readings.", citation: { format: "pptx", fileName: "deck.pptx", slide: 2, title: "Readings" } },
	];
	const retriever = new KnowledgeSearch(() => chunks, [{ rank: () => new Map([["slide1", 5]]) }]);
	const tools = createKnowledgeTool({
		ownerId: "owner", chatId: "chat", retriever,
		markKnowledgeUsed: () => true, openSection: async () => null,
	});
	const result = await tools.search_knowledge!.execute("call", { queries: ["deck"] });
	const text = typeof result === "string" ? result : result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
	assert.match(text, /\[deck.pptx, slide 1: Calibration\]\nCalibrate the sensor first\./);
	assert.match(text, /\[deck.pptx, slide 2: Readings\]\nCollect seven readings\./);
	assert.equal((text.match(/Collect seven readings\./g) ?? []).length, 1);
});
