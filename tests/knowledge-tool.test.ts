import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KnowledgeResult } from "../src/knowledge/contracts.ts";
import type { KnowledgeToolContext } from "../src/agent/tools/knowledge.ts";
import type { ProberToolContext, TeacherToolContext } from "../src/agent/tools.ts";

const { createKnowledgeTool } = await import("../src/agent/tools/knowledge.ts");
const { createProberTools, createTeacherTools } = await import("../src/agent/tools.ts");

function fakeResult(overrides: Partial<KnowledgeResult> & { citation: KnowledgeResult["citation"] }): KnowledgeResult {
	return {
		id: "chunk_1",
		documentId: "doc_1",
		text: "sample text",
		score: 1.5,
		...overrides,
	} as KnowledgeResult;
}

function makeCtx(overrides: Partial<KnowledgeToolContext> = {}): KnowledgeToolContext {
	return {
		ownerId: "test-owner",
		chatId: "test-chat",
		retriever: { search: async () => [] },
		markKnowledgeUsed: () => true,
		...overrides,
	};
}

describe("createKnowledgeTool", () => {
	it("returns a record with search_knowledge", () => {
		const tools = createKnowledgeTool(makeCtx());
		assert.ok(tools.search_knowledge);
		assert.equal(tools.search_knowledge.name, "search_knowledge");
	});

	it("returns no-match message on empty retrieval", async () => {
		const tools = createKnowledgeTool(makeCtx({
			retriever: { search: async () => [] },
		}));
		const result = await tools.search_knowledge!.execute("call_1", { queries: ["test query"] });
		assert.ok(typeof result === "string" || (typeof result === "object" && "content" in result));
		const text = typeof result === "string" ? result : JSON.stringify(result);
		assert.ok(text.includes("No matching documents"), `Expected no-match message, got: ${text}`);
	});

	it("calls markKnowledgeUsed before returning non-empty results", async () => {
		const calls: string[] = [];
		const tools = createKnowledgeTool(makeCtx({
			retriever: {
				search: async () => [
					fakeResult({ citation: { format: "pdf", fileName: "report.pdf", page: 3 } }),
				],
			},
			markKnowledgeUsed: (chatId) => { calls.push(chatId); return true; },
		}));
		const result = await tools.search_knowledge!.execute("call_2", { queries: ["budget"] });
		assert.deepEqual(calls, ["test-chat"]);
		const text = typeof result === "string" ? result : JSON.stringify(result);
		assert.ok(text.includes("report.pdf"), `Expected citation in result, got: ${text}`);
	});

	it("withholds chunks when markKnowledgeUsed throws", async () => {
		const tools = createKnowledgeTool(makeCtx({
			retriever: {
				search: async () => [
					fakeResult({ citation: { format: "pdf", fileName: "secret.pdf", page: 1 } }),
				],
			},
			markKnowledgeUsed: () => { throw new Error("persist failed"); },
		}));
		const result = await tools.search_knowledge!.execute("call_3", { queries: ["data"] });
		const text = typeof result === "string" ? result : JSON.stringify(result);
		assert.ok(!text.includes("secret.pdf"), "Chunks must be withheld on persist failure");
		assert.ok(text.includes("could not be updated"), `Expected error message, got: ${text}`);
	});

	it("formats PDF citations as [fileName, page N]", async () => {
		const tools = createKnowledgeTool(makeCtx({
			retriever: { search: async () => [fakeResult({ citation: { format: "pdf", fileName: "doc.pdf", page: 7 } })] },
		}));
		const result = await tools.search_knowledge!.execute("call_4", { queries: ["test"] });
		const text = typeof result === "string" ? result : JSON.stringify(result);
		assert.ok(text.includes("[doc.pdf, page 7]"), `Expected PDF citation, got: ${text}`);
	});

	it("formats PPTX citations as [fileName, slide N: title]", async () => {
		const tools = createKnowledgeTool(makeCtx({
			retriever: { search: async () => [fakeResult({ citation: { format: "pptx", fileName: "deck.pptx", slide: 3, title: "Summary" } })] },
		}));
		const result = await tools.search_knowledge!.execute("call_5", { queries: ["test"] });
		const text = typeof result === "string" ? result : JSON.stringify(result);
		assert.ok(text.includes("[deck.pptx, slide 3: Summary]"), `Expected PPTX citation, got: ${text}`);
	});

	it("formats DOCX citations as [fileName, §heading, ¶N]", async () => {
		const tools = createKnowledgeTool(makeCtx({
			retriever: { search: async () => [fakeResult({ citation: { format: "docx", fileName: "memo.docx", heading: "Intro", paragraph: 2 } })] },
		}));
		const result = await tools.search_knowledge!.execute("call_6", { queries: ["test"] });
		const text = typeof result === "string" ? result : JSON.stringify(result);
		assert.ok(text.includes("[memo.docx, §Intro, ¶2]"), `Expected DOCX citation, got: ${text}`);
	});

	it("formats MD citations as [fileName, §heading, lines N–M]", async () => {
		const tools = createKnowledgeTool(makeCtx({
			retriever: { search: async () => [fakeResult({ citation: { format: "md", fileName: "notes.md", heading: "Setup", lineStart: 10, lineEnd: 15 } })] },
		}));
		const result = await tools.search_knowledge!.execute("call_7", { queries: ["test"] });
		const text = typeof result === "string" ? result : JSON.stringify(result);
		assert.ok(text.includes("[notes.md, §Setup, lines 10–15]"), `Expected MD citation, got: ${text}`);
	});
});

describe("registry gating", () => {
	it("search_knowledge is absent from prober tools when knowledge context is undefined", () => {
		const minimalCtx = {
			chatId: "c1",
			chatStore: { getChat: () => ({ messages: [], kind: "probe" }) } as any,
			deliver: () => {},
			jobStore: {} as any,
			spawn: () => {},
		} satisfies Omit<ProberToolContext, "knowledge">;
		const tools = createProberTools(minimalCtx as any);
		assert.equal(tools.search_knowledge, undefined, "search_knowledge must not be in registry without knowledge ctx");
	});

	it("search_knowledge is present in teacher tools when knowledge context is provided", () => {
		const ctx = {
			chatId: "c2",
			chatStore: { getChat: () => ({ messages: [], kind: "teach" }) } as any,
			jobStore: {} as any,
			spawn: () => {},
			knowledge: makeCtx(),
		} satisfies Partial<TeacherToolContext>;
		const tools = createTeacherTools(ctx as any);
		assert.ok(tools.search_knowledge, "search_knowledge must be in registry with knowledge ctx");
	});
});
