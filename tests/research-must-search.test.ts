/**
 * The must-search guard (owner, 2026-11-25): with web search available the
 * researcher wrote a Vivado brief from memory ("web_search was not
 * utilized") and named a 2024 release as the latest. A brief written
 * without a single search goes back once with the approved reminder.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { MUST_SEARCH_TEXT, runResearcherAgent } from "../src/agent/subagents/researcher.ts";

const provider = { id: "fake", search: async () => [{ title: "Vivado 2026.1 release notes", url: "https://example.com/vivado", snippet: "2026.1" }] };

function scripted(responses: Array<(context: { messages: Array<{ role: string; content: unknown }> }) => ReturnType<typeof fauxAssistantMessage>>) {
	const faux = createFauxCore({});
	const seen: string[] = [];
	faux.setResponses(responses.map((r) => (context: unknown) => {
		const ctx = context as { messages: Array<{ role: string; content: unknown }> };
		const last = ctx.messages.at(-1);
		seen.push(typeof last?.content === "string" ? last.content : JSON.stringify(last?.content));
		return r(ctx);
	}));
	return { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, seen };
}

describe("the must-search guard", () => {
	it("sends a no-search brief back once, and returns the searched brief", async () => {
		const { engine, seen } = scripted([
			() => fauxAssistantMessage([fauxText("Brief from memory: 2024.1")]),
			() => fauxAssistantMessage([fauxToolCall("web_search", { query: "vivado latest version", reason: "check" }, { id: "s1" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("Brief from search: 2026.1")]),
		]);
		const brief = await runResearcherAgent("Research question: latest Vivado", { engine, search: () => provider as never });
		assert.equal(brief, "Brief from search: 2026.1");
		assert.ok(seen.some((s) => s.includes(MUST_SEARCH_TEXT)), "the reminder reached the model");
	});

	it("does not remind when the researcher searched, or when search is unavailable or off", async () => {
		const searched = scripted([
			() => fauxAssistantMessage([fauxToolCall("web_search", { query: "q", reason: "r" }, { id: "s1" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("Searched brief")]),
		]);
		assert.equal(await runResearcherAgent("Q", { engine: searched.engine, search: () => provider as never }), "Searched brief");
		assert.ok(!searched.seen.some((s) => s.includes(MUST_SEARCH_TEXT)));

		const noSearch = scripted([() => fauxAssistantMessage([fauxText("Memory brief")])]);
		assert.equal(await runResearcherAgent("Q", { engine: noSearch.engine, search: () => null }), "Memory brief");

		const off = scripted([() => fauxAssistantMessage([fauxText("Memory brief")])]);
		assert.equal(await runResearcherAgent("Q", { engine: off.engine, search: () => provider as never, webPolicy: { enabled: () => false } }), "Memory brief");
	});

	it("reminds at most once per job", async () => {
		const { engine, seen } = scripted([
			() => fauxAssistantMessage([fauxText("Memory brief 1")]),
			() => fauxAssistantMessage([fauxText("Memory brief 2")]),
		]);
		assert.equal(await runResearcherAgent("Q", { engine, search: () => provider as never }), "Memory brief 2");
		assert.equal(seen.filter((s) => s.includes(MUST_SEARCH_TEXT)).length, 1);
	});
});
