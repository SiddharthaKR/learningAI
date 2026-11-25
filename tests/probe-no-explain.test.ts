/**
 * The prober does not explain (owner-approved wording, 2026-11-25): Gemma
 * 12B explained the topic in 8 of 10 replayed probing replies (Ohm's law,
 * after "like water in a pipe" and after "dont know").
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

it("the prober's instructions open with the no-explaining rule and say what to do after a miss", () => {
	const prober = composeInstructions("prober");
	const rule = "Find where the teacher should begin. While probing, do not explain the topic, give hints, or correct the learner. Ask one diagnostic question at a time, without giving away its answer.";
	assert.ok(prober.includes(rule));
	assert.ok(prober.indexOf(rule) < prober.indexOf("## The goal"), "the rule leads the probing doctrine");
	assert.ok(prober.includes("Treat \"I don't know\" as a gap and a wrong answer as evidence about how the learner thinks. Ask one simpler question only if its answer could change where teaching starts. If the goal and starting point are clear, call `probe_done` now."));
	assert.ok(!composeInstructions("teacher").includes(rule), "the teacher keeps its own doctrine");
});
