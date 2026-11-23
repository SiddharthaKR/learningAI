/**
 * The office engine's thinking levels and request body (owner, 2026-11-23).
 * Regression: a thinkingLevelMap with off: null made pi-ai treat "off" as
 * unsupported and clamp it up to "minimal", so thinking kept running.
 * No model server: fetch is stubbed and only the request body is read.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

process.env.LLM_REASONING = "true";
const { piEngineForSpec, piModels } = await import("../src/agent/models.ts");
const { fixedOfficeModelSpec } = await import("../src/core/office-config.ts");
const { getSupportedThinkingLevels } = await import("@earendil-works/pi-ai");

const realFetch = globalThis.fetch;
after(() => {
	globalThis.fetch = realFetch;
});

/** Run one request on the engine and return the JSON body it sent. */
async function sentBody(thinkingLevel?: "off"): Promise<Record<string, unknown>> {
	let body: Record<string, unknown> = {};
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (typeof init?.body === "string") body = JSON.parse(init.body);
		return new Response(JSON.stringify({ error: { message: "stub" } }), { status: 500, headers: { "content-type": "application/json" } });
	}) as typeof fetch;
	const engine = piEngineForSpec({ ...fixedOfficeModelSpec(), ...(thinkingLevel ? { thinkingLevel } : {}) });
	const stream = engine.streamFn(engine.model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] } as never, {});
	for await (const _event of stream as AsyncIterable<unknown>) { /* drain until the stub error ends it */ }
	return body;
}

describe("office thinking levels", () => {
	it("supports exactly off and medium, defaulting to medium", () => {
		const model = piModels().getModel("office", fixedOfficeModelSpec().id)!;
		assert.deepEqual(getSupportedThinkingLevels(model), ["off", "medium"]);
		assert.equal(piEngineForSpec(fixedOfficeModelSpec()).level, "medium");
		assert.equal(piEngineForSpec({ ...fixedOfficeModelSpec(), thinkingLevel: "off" }).level, "off");
	});

	it("on: sends reasoning_effort medium and enable_thinking true", async () => {
		const body = await sentBody();
		assert.equal(body.reasoning_effort, "medium");
		assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
	});

	it("off: sends reasoning_effort none and enable_thinking false", async () => {
		const body = await sentBody("off");
		assert.equal(body.reasoning_effort, "none");
		assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
	});
});
