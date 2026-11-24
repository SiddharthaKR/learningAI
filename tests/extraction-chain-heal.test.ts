/**
 * The chain-endpoint heal (owner, 2026-11-24): Gemma 12B wrote a chain's
 * premises as [{"id": "p2"}] instead of ["p2"] in 4 of 7 extraction runs;
 * four slips in a row ended the run ("the extractor never submitted
 * findings"). An object holding only a string id becomes that id.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { healChainEndpoints, healExtractorArguments } from "../src/agent/subagents/submit-agent.ts";

describe("healChainEndpoints", () => {
	it("unwraps {id} objects in premises and the conclusion", () => {
		const raw = { propositions: [], chains: [{ conclusion: { id: "p1" }, premises: [{ id: "p2" }, "p3"] }] };
		assert.deepEqual(healChainEndpoints(raw), { propositions: [], chains: [{ conclusion: "p1", premises: ["p2", "p3"] }] });
	});

	it("leaves anything else for validation", () => {
		const raw = { chains: [{ conclusion: "p1", premises: [{ name: "x" }, { id: "p2", note: "y" }, { id: 3 }] }] };
		assert.deepEqual(healChainEndpoints(raw), raw);
		assert.equal(healChainEndpoints("x"), "x");
		assert.deepEqual(healChainEndpoints({ chains: "[]" }), { chains: "[]" });
	});

	it("runs after the stringified-array heal", () => {
		const raw = { chains: JSON.stringify([{ conclusion: "p1", premises: [{ id: "p2" }] }]) };
		assert.deepEqual(healExtractorArguments(raw), { chains: [{ conclusion: "p1", premises: ["p2"] }] });
	});
});
