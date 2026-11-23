/**
 * Chat images through the vision route (owner, 2026-11-19): with LLM_VISION=false
 * and VISION_* set, an image attached in any session (chat, teaching, practice)
 * is described once by the vision model (LM Studio direct, :1234) and the chat
 * model receives the description as text. The proxy on :8088 cannot carry
 * images (it renders a plain-text prompt), so before this the model never saw them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newUserMessage, toLlmMessages, withImageDescriptions } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import { describeAttachedImages } from "../src/server/chat-image-vision.ts";

const PNG = { data: "iVBORw0KGgo=", mimeType: "image/png" };

describe("the model sees descriptions instead of images", () => {
	it("replaces each image part with its description, in order, keeping the text", () => {
		const msg = withImageDescriptions(newUserMessage("what is this", [PNG, PNG]), ["A flow chart: start, applicant, approval, end.", null]);
		const [llm] = toLlmMessages([msg] as never) as Array<{ content: Array<{ type: string; text?: string }> }>;
		assert.deepEqual(llm!.content.map((c) => c.type), ["text", "text", "text"]);
		assert.match(llm!.content[0]!.text!, /^\[Image 1, described by the vision model: A flow chart: start, applicant, approval, end\.\]$/);
		assert.match(llm!.content[1]!.text!, /^\[Image 2 could not be read by the vision model\.\]$/);
		assert.equal(llm!.content[2]!.text, "what is this");
		assert.ok(!JSON.stringify(llm).includes("iVBORw0KGgo="), "no image bytes go to the text model");
	});

	it("without descriptions, images pass through as before", () => {
		const [llm] = toLlmMessages([newUserMessage("hi", [PNG])] as never) as Array<{ content: Array<{ type: string }> }>;
		assert.deepEqual(llm!.content.map((c) => c.type), ["image", "text"]);
	});

	it("the learner still sees the image in their message", () => {
		const msg = withImageDescriptions(newUserMessage("what is this", [PNG]), ["A chart."]);
		const view = projectView([msg] as never);
		assert.ok(view[0]!.parts.some((p) => p.type === "image"));
		assert.ok(!JSON.stringify(view).includes("A chart."), "the description is for the model only");
	});
});

describe("describeAttachedImages (server)", () => {
	const env = { LLM_VISION: "false", VISION_BASE_URL: "http://127.0.0.1:1234/v1", VISION_MODEL: "gemma-4-26b" };

	it("describes each attached image once through the vision route", async () => {
		const calls: string[] = [];
		const appends = [newUserMessage("what is this", [PNG])];
		const out = await describeAttachedImages(appends, { env, callFn: async (_b64, mime) => { calls.push(mime); return "A flow chart."; } });
		assert.deepEqual(calls, ["image/png"]);
		assert.deepEqual((out[0] as { imageDescriptions?: unknown }).imageDescriptions, ["A flow chart."]);
	});

	it("a failed description is recorded as unreadable, never thrown", async () => {
		const out = await describeAttachedImages([newUserMessage("x", [PNG])], { env, callFn: async () => { throw new Error("vision down"); } });
		assert.deepEqual((out[0] as { imageDescriptions?: unknown }).imageDescriptions, [null]);
	});

	it("does nothing when the main model takes images, or no vision route is set", async () => {
		let called = false;
		const callFn = async () => { called = true; return "x"; };
		const a = await describeAttachedImages([newUserMessage("x", [PNG])], { env: { ...env, LLM_VISION: "true" }, callFn });
		const b = await describeAttachedImages([newUserMessage("x", [PNG])], { env: { LLM_VISION: "false" }, callFn });
		assert.equal(called, false);
		for (const out of [a, b]) assert.equal((out[0] as { imageDescriptions?: unknown }).imageDescriptions, undefined);
	});

	it("messages without images are untouched", async () => {
		const appends = [newUserMessage("plain text")];
		const out = await describeAttachedImages(appends, { env, callFn: async () => "x" });
		assert.equal(out[0], appends[0]);
	});
});
