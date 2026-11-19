/**
 * Switch changes reach the model (owner, 2026-11-19). Turning web research on
 * mid-chat was shown only to the learner; the model never learned it, kept its
 * earlier "I cannot search" answers and never called research. The note now
 * carries one owner-approved line per change for the model.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { newSessionControlsChangedMessage, toLlmMessages } from "../src/core/native-messages.ts";
import { sessionControlsText } from "../src/core/contracts/chat.ts";

const at = "2026-11-19T10:00:00.000Z";

it("one line per change, in the approved wording", () => {
	assert.equal(
		sessionControlsText({ at, changes: [{ field: "webResearchEnabled", from: false, to: true }] }),
		"Session settings changed: web research is now ON — the research tool is available.",
	);
	assert.equal(
		sessionControlsText({ at, changes: [
			{ field: "webResearchEnabled", from: true, to: false },
			{ field: "officeKnowledgeEnabled", from: false, to: true },
			{ field: "knowledgeScope", from: "all", to: "shared" },
		] }),
		[
			"Session settings changed: web research is now OFF — the research tool is no longer available.",
			"Session settings changed: office knowledge is now ON — the knowledge search tool is available.",
			"Session settings changed: knowledge search now covers shared documents only.",
		].join("\n"),
	);
});

it("the model now sees the note; the learner's screen is unchanged", () => {
	const note = newSessionControlsChangedMessage({ at, changes: [{ field: "webResearchEnabled", from: false, to: true }] });
	const llm = toLlmMessages([note] as never) as Array<{ role: string; content: Array<{ text: string }> }>;
	assert.equal(llm.length, 1);
	assert.equal(llm[0]!.role, "user");
	assert.match(llm[0]!.content[0]!.text, /web research is now ON/);
});

it("notes saved before this change (empty text) still never reach the model", () => {
	const old = { ...newSessionControlsChangedMessage({ at, changes: [] }), content: "" };
	assert.equal(toLlmMessages([old] as never).length, 0);
});
