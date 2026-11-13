import type { Usage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";

/**
 * The verifier sub-agent: takes a teaching message's text and stored
 * source content, breaks the teaching into individual claims, compares
 * each claim against the raw fetched pages, and returns structured
 * results with verdicts.
 */

const INSTRUCTIONS = `You are a fact-checking specialist. You receive a teaching passage and a set
of source documents that the researcher fetched during this session. Your job
is to break the teaching into individual factual claims and verify each claim
against the source material.

For each claim:
1. Extract the specific factual assertion.
2. Search the source documents for evidence that supports or contradicts it.
3. If you find a supporting quote, cite it exactly.
4. Give a verdict: "supported", "unsupported", or "partial".
5. Briefly explain your reasoning.

Respond with ONLY a JSON array. Each element must have these fields:
- "claim": the extracted factual assertion (string)
- "verdict": "supported" | "unsupported" | "partial" (string)
- "sourceUrl": the URL where evidence was found, or null (string | null)
- "sourceQuote": exact quote from the source, or null (string | null)
- "explanation": brief reasoning (string)

Example:
[
  {
    "claim": "Python was created by Guido van Rossum",
    "verdict": "supported",
    "sourceUrl": "https://en.wikipedia.org/wiki/Python_(programming_language)",
    "sourceQuote": "Python was conceived in the late 1980s by Guido van Rossum",
    "explanation": "The source confirms Guido van Rossum as Python's creator."
  }
]

If there are no verifiable factual claims, return an empty array [].
Do not include opinions, pedagogical choices, or subjective statements as claims.`;

export interface VerifierClaim {
	claim: string;
	verdict: "supported" | "unsupported" | "partial";
	sourceUrl: string | null;
	sourceQuote: string | null;
	explanation: string;
}

export interface VerifierRunOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
}

export async function runVerifierAgent(
	teachingText: string,
	sources: { url: string; markdown: string }[],
	opts: VerifierRunOptions = {},
): Promise<VerifierClaim[]> {
	const sourceBlock = sources.length > 0
		? sources.map((s) => `--- SOURCE: ${s.url} ---\n${s.markdown.slice(0, 20_000)}\n--- END SOURCE ---`).join("\n\n")
		: "(No sources available)";

	const prompt = `## Teaching passage to verify:\n${teachingText}\n\n## Source documents:\n${sourceBlock}`;

	const { text } = await runSubagent([], {
		role: "verifier",
		prompt,
		engine: opts.engine,
		systemPrompt: INSTRUCTIONS,
		maxTurns: 1,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
	});

	try {
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) return [];
		const parsed = JSON.parse(jsonMatch[0]);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(c: unknown): c is VerifierClaim =>
				typeof c === "object" &&
				c !== null &&
				typeof (c as VerifierClaim).claim === "string" &&
				typeof (c as VerifierClaim).verdict === "string" &&
				["supported", "unsupported", "partial"].includes((c as VerifierClaim).verdict),
		);
	} catch {
		return [];
	}
}
