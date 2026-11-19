import assert from "node:assert/strict";
import { it } from "node:test";
import { projectView } from "../src/core/view.ts";

// Owner report, 2026-11-19: when the first model call failed (HTTP 400), the
// failure was saved (stopReason "error", no content) but the chat showed
// nothing — empty assistant messages are hidden. A failed turn must say so.
const user = { id: "u1", role: "user", content: "teach me black holes", timestamp: 1 };
function assistant(extra: Record<string, unknown>) {
	return { id: "a1", role: "assistant", content: [], api: "openai-completions", provider: "office", model: "m", usage: {}, timestamp: 2, ...extra };
}

it("a saved failed turn projects an error part carrying the reason", () => {
	const view = projectView([user, assistant({ stopReason: "error", errorMessage: "400: Unknown name \"store\"" })] as never);
	assert.equal(view.length, 2);
	const errors = view[1]!.parts.filter((p) => p.type === "data-turn-error");
	assert.equal(errors.length, 1);
	assert.equal((errors[0]!.data as { message: string }).message, "400: Unknown name \"store\"");
});

it("long reasons are shortened for the screen", () => {
	const view = projectView([user, assistant({ stopReason: "error", errorMessage: "x".repeat(2000) })] as never);
	const message = (view[1]!.parts.find((p) => p.type === "data-turn-error")!.data as { message: string }).message;
	assert.ok(message.length <= 301);
});

it("a stopped turn (aborted) and a normal empty message stay hidden", () => {
	assert.equal(projectView([user, assistant({ stopReason: "aborted", errorMessage: "Operation aborted" })] as never).length, 1);
	assert.equal(projectView([user, assistant({ stopReason: "stop" })] as never).length, 1);
});
