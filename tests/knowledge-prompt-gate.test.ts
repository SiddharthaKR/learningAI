import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProberAgent } from "../src/agent/teacher-agent.ts";
import type { ProberToolContext } from "../src/agent/tools.ts";
import type { KnowledgeToolContext } from "../src/agent/tools/knowledge.ts";
import { jobStore, chatStore } from "./support/test-stores.ts";
import { createFauxCore } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

function fauxEngine(): PiEngine {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

const KNOWLEDGE_HEADING = "## Office documents (`search_knowledge`)";
const knowledge: KnowledgeToolContext = {
	ownerId: "u",
	chatId: "c",
	retriever: { search: async () => [] },
	markKnowledgeUsed: () => true,
	openSection: async () => null,
};
const promptOf = (agent: { state: { systemPrompt: string } }) => agent.state.systemPrompt;

describe("knowledge prompt segment follows the knowledge tool", () => {
	const base: ProberToolContext = { chatId: "c", chatStore, deliver: () => {}, jobStore, spawn: () => {} };

	it("is omitted when office knowledge is off (no search_knowledge tool)", () => {
		const agent = createProberAgent(base, { engine: fauxEngine() });
		assert.ok(!promptOf(agent).includes(KNOWLEDGE_HEADING));
		assert.ok(!agent.state.tools.some((t) => t.name === "search_knowledge"));
	});

	it("is included when office knowledge is on", () => {
		const agent = createProberAgent({ ...base, knowledge }, { engine: fauxEngine() });
		assert.ok(agent.state.tools.some((t) => t.name === "search_knowledge"));
		assert.ok(promptOf(agent).includes(KNOWLEDGE_HEADING));
	});
});
