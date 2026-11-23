/**
 * THE PROBE TOOL GUARD end to end (owner, 2026-11-23): a prober reply that
 * asks in prose settles, the server delivers ONE question-retry nudge
 * through the wake pipeline, and the re-run sees the instruction. A second
 * prose reply is left alone. Scripted faux engines: no real provider calls.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { AgentBuildOptions, TeachingAgent } from "../src/agent/teacher-agent.ts";
import type { PiEngine } from "../src/agent/models.ts";

const { createProberAgent } = await import("../src/agent/teacher-agent.ts");
const { handleChatInput, handleChatRequest } = await import("../src/server/chat-handler.ts");
const { setTurnRunner } = await import("../src/server/jobs.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { isTurnRunning } = await import("../src/server/turn-liveness.ts");
const { chatStore, jobStore } = await import("./support/test-stores.ts");
const { QUESTION_RETRY_TEXT } = await import("../src/core/contracts/chat.ts");

after(() => setTurnRunner(async () => 200));

function waitFor(cond: () => boolean, timeoutMs = 15_000, what = "condition"): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (cond()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${what}`));
			setTimeout(tick, 25);
		};
		tick();
	});
}

describe("the probe tool guard (server flow)", () => {
	it("re-runs a prose probe reply once with the question-tool instruction", async () => {
		const lastUserTexts: string[] = [];
		const faux = createFauxCore({});
		const step = (text: string): FauxResponseStep => (context) => {
			const last = context.messages.at(-1) as { role: string; content: unknown };
			lastUserTexts.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
			return fauxAssistantMessage([fauxText(text)]);
		};
		faux.setResponses([
			step("What is U|psi>? (Select the correct option)"),
			step("Still prose after the nudge."),
		]);
		const engine: PiEngine = { model: faux.getModel(), streamFn: faux.streamSimple };
		const chat = chatStore.createChat("Test: probe tool guard");
		const prober = (opts: AgentBuildOptions & { teaching: boolean }): TeachingAgent =>
			createProberAgent({ chatId: chat.id, chatStore, jobStore, deliver: () => {}, spawn: () => {} }, { ...opts, engine });
		let wakes = 0;
		setTurnRunner(async (chatId, input) => {
			wakes++;
			const res = await handleChatInput(chatId, input, prober);
			await res.arrayBuffer().catch(() => undefined);
			return res.status;
		});

		const ack = await handleChatRequest(
			new Request("http://test/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chatId: chat.id, input: { type: "text", text: "2" } }),
			}),
			prober,
		);
		assert.equal(ack.status, 200);
		const handle = runningTurn(chat.id);
		if (handle) await new Response(handle.subscribe()).text();

		await waitFor(() => lastUserTexts.length >= 2 && !isTurnRunning(chat.id), 15_000, "the nudged re-run settles");
		// Give a wrongly-owed second nudge time to fire before asserting none did.
		await new Promise((resolve) => setTimeout(resolve, 1500));

		assert.equal(wakes, 1, "exactly one nudge wake");
		assert.equal(lastUserTexts.length, 2, "two model calls: the prose reply and one re-run");
		assert.ok(lastUserTexts[1]!.includes(QUESTION_RETRY_TEXT.slice(0, 40)), "the re-run's last input is the instruction");
		const record = chatStore.getChat(chat.id)!;
		const kinds = record.messages.map((m) => (m.role === "custom" ? `custom:${(m as { customType: string }).customType}` : m.role));
		assert.deepEqual(kinds, ["user", "assistant", "custom:question-retry", "assistant"]);
	});
});
