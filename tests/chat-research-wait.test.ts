import assert from "node:assert/strict";
import { it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createChatAgent } from "../src/agent/teacher-agent.ts";
import { chatStore, jobStore } from "./support/test-stores.ts";

it("Chat pauses after research dispatch and answers when the brief arrives", async () => {
	const chat = chatStore.createChat("Research wait");
	const faux = createFauxCore({});
	let requests = 0;
	let spawned = 0;
	faux.setResponses([
		() => {
			requests++;
			return fauxAssistantMessage([fauxToolCall("research", { question: "Vivado version" }, { id: "r1" })], { stopReason: "toolUse" });
		},
		() => {
			requests++;
			return fauxAssistantMessage([fauxText("The researched answer.")]);
		},
	]);
	const agent = createChatAgent({
		chatId: chat.id,
		jobs: { chatId: chat.id, jobStore, spawn: () => { spawned++; } },
	}, { engine: { model: faux.getModel(), streamFn: faux.streamSimple } });
	await agent.prompt("Research the current Vivado version.");
	assert.equal(spawned, 1);
	assert.equal(requests, 1, "no speculative answer request while the researcher runs");
	await agent.prompt("Research brief: the verified version and source are now available.");
	assert.equal(requests, 2, "a delivered brief can resume the answer");
});
