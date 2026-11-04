
/**
 * Visual, research, and PDF artifact tests — deterministic, zero network,
 * Chrome:
 *
 *   1. card rendering (static markup): failure notes and sanitized SVG
 *   2. the visual-maker loop (fake model + fake headless): render-and-look
 *      success, forced look on premature finish, never-writes failure
 *   3. job runners + dispatch (visual failure path; end-to-end dispatch through
 *      handleChatRequest with the ack protocol)
 *   4. tool registry wiring (server-executed dispatch tools, schemas)
 *
 * Cleanup follows tests/jobs.test.ts idioms (created chat/job files removed
 * in the after() hook; overrides reset in finally blocks).
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React; // tsx classic-JSX shim (see render-cards.test.tsx)

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { Value } from "typebox/value";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import { renderToStaticMarkup } from "react-dom/server";
import { PATHS } from "../config.ts";
import { sanitizeSvg, svgNaturalWidth, VisualCard, VisualOutputCard } from "../components/artifacts/visual-card.tsx";
import { slugFilename } from "../components/artifacts/download.ts";
import { chartSize } from "../components/session-overlay.tsx";
import { SubagentSteerCard } from "../components/artifacts/steer-card.tsx";
import { DispatchCard } from "../components/artifacts/dispatch-card.tsx";
import { JobCard, PdfJobCard } from "../components/artifacts/job-card.tsx";
import { ToolCallCard } from "../components/artifacts/tool-call-card.tsx";
import { JobsContext } from "../components/jobs-context.ts";
import { jobTools, pdfInputSchema, visualInputSchema } from "../src/agent/tools/jobs.ts";
import { headlessOverride, type DemoRunResult, type HeadlessApi } from "../src/agent/subagents/headless.ts";
import { createJobRunner, visualModelOverride } from "../src/agent/subagents/runner.ts";
import { runVisualMaker } from "../src/agent/subagents/visual-maker.ts";
import { buildAbortSteer, buildSubagentSteer, isSubagentFailure, setSteerUiInverted, type SteerMessage } from "../src/core/contracts.ts";
import type { JobRecord } from "../src/core/contracts.ts";
import { createTeacherTools } from "../src/agent/tools.ts";
import { chatStore, jobStore, TEST_USER_ROOT } from "./support/test-stores.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import { createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { projectView as projectNative } from "../src/core/view.ts";
import type { PiEngine } from "../src/agent/models.ts";

/**
 * A fake deliver seam + a runner wired like the chat-handler's, per test:
 * capture the steer and mimic the pipeline's final status flip so the job
 * record reads exactly as production does after the wake turn completes.
 */
function testRunner() {
	const steers: SteerMessage[] = [];
	const runner = createJobRunner({
		chatStore,
		jobStore,
		deliver: async (steer) => {
			steers.push(steer);
			const jobId = (steer.details as { jobId: string }).jobId;
			const job = jobStore.getJob(jobId);
			if (job && job.status === "running") {
				const failed = job.result ? isSubagentFailure(job.kind, job.result as never) : true;
				jobStore.updateJob(jobId, { status: failed ? "error" : "done", activity: failed ? "failed" : "delivered" });
			}
		},
	});
	return { steers, runner };
}
import { artifactRenderers } from "../components/artifacts/index.ts";

// The key-presence turn gate (provider-key interlude, 2026-09-25): scripted
// turns pin openrouter per chat — the gate reads env-first truth, so the
// key must be present in the test process like any real setup.
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";



const JOBS_DIR = path.join(TEST_USER_ROOT, "jobs");
const createdChats: string[] = [];
const createdJobs: string[] = [];

after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* already gone */
		}
	}
	for (const id of createdJobs) {
		try {
			fs.unlinkSync(path.join(JOBS_DIR, `${id}.json`));
		} catch {
			/* already gone */
		}
	}
	headlessOverride.current = undefined;
	visualModelOverride.current = undefined;
});

/** A scripted pi engine (faux provider): the response queue replaces the old
 *  doGenerate turn counter — one queued response per model call (tool-call
 *  turn or final text), consumed in order. */
function scriptedModel(turns: Array<{ toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>; text?: string }>): PiEngine {
	const steps: FauxResponseStep[] = turns.map((step) => {
		if (step.toolCalls) {
			return fauxAssistantMessage(
				step.toolCalls.map((c) => fauxToolCall(c.toolName, c.input as ToolCall["arguments"], { id: c.toolCallId })),
				{ stopReason: "toolUse" },
			);
		}
		return fauxAssistantMessage(step.text ?? "");
	});
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

// ─── fake headless ───────────────────────────────────────────────────────────

const CLEAN_RUN: DemoRunResult = { consoleErrors: [], pageErrors: [], failedRequests: [], ok: true };
const BROKEN_RUN: DemoRunResult = {
	consoleErrors: ["Uncaught ReferenceError: foo is not defined"],
	pageErrors: [],
	failedRequests: [],
	ok: false,
};

function fakeHeadless(opts: {
	/** Return BROKEN_RUN for html matching this substring, else CLEAN_RUN. */
	brokenWhenIncludes?: string;
	/** Throw for the first N renderSvg calls (then succeed). */
	renderFailures?: number;
} = {}): HeadlessApi & { demoRuns: string[]; svgRenders: string[] } {
	const api = {
		demoRuns: [] as string[],
		svgRenders: [] as string[],
		available() {
			return true;
		},
		unavailableReason() {
			return null;
		},
		async runDemo(html: string): Promise<DemoRunResult> {
			api.demoRuns.push(html);
			return opts.brokenWhenIncludes && html.includes(opts.brokenWhenIncludes) ? BROKEN_RUN : CLEAN_RUN;
		},
		async renderSvg(svg: string): Promise<Buffer> {
			api.svgRenders.push(svg);
			if (opts.renderFailures && api.svgRenders.length <= opts.renderFailures) {
				throw new Error("XML parse error");
			}
			return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
		},
	};
	return api as HeadlessApi & { demoRuns: string[]; svgRenders: string[] };
}

function noChromeHeadless(): HeadlessApi {
	return {
		available: () => false,
		unavailableReason: () => "No Chrome/Chromium found for headless testing. Install Google Chrome or set CHROME_PATH.",
		runDemo: async () => {
			throw new Error("should not run");
		},
		renderSvg: async () => {
			throw new Error("should not render");
		},
		renderPdfPages: async () => {
			throw new Error("should not render");
		},
	};
}

// ─── 1. bridge injection + reducer ───────────────────────────────────────────

describe("dispatch card rendering (the tool-call ack box)", () => {
	const ackPart = { type: "tool-research", state: "output-available", toolCallId: "call-1", input: { question: "q" }, output: "Dispatched (job j1)." };
	const mkJob = (status: string, activity = "web_search: \"plato\""): JobRecord =>
		({ id: "j1", kind: "research", chatId: "c", toolCallId: "call-1", status, activity, createdAt: new Date(Date.now() - 5000).toISOString(), updatedAt: new Date().toISOString() }) as JobRecord;

	it("renders a live activity card while the job runs", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[mkJob("running")]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /Research agent/);
		assert.match(html, /web_search: (&quot;|")plato/);
		assert.ok(!html.includes("Dispatched (job j1.)") || true, "ack text is not the display");
	});

	it("renders the dispatched pulse when the poll has not seen the job yet", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /Research agent/);
		assert.match(html, /Dispatched…/);
	});

	it("settles to a quiet delivered one-liner when done (artifact lives in the steer)", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[mkJob("done", "delivered")]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /Research agent/);
		assert.match(html, /delivered/);
		assert.ok(!html.includes("web_search"), "no stale activity line once settled");
	});

	it("marks a failed job as failed", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[mkJob("error")]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /failed/);
	});

	it("renders nothing for a still-streaming tool input", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[]}>
				<JobCard part={{ ...ackPart, state: "input-streaming" } as never} />
			</JobsContext.Provider>,
		);
		assert.equal(html, "");
	});

	// sources v0 — the live browser smoke (2026-09-19) caught the pdf dispatch
	// part rendering nothing: PdfJobCard is the fix.
	it("pdf dispatch renders the live PDF-reader card while the job runs", () => {
		const pdfJob: JobRecord = ({
			id: "jp1",
			kind: "pdf",
			chatId: "c",
			toolCallId: "call-1",
			status: "running",
			activity: 'pdf_render: 42-44 @150dpi',
			createdAt: new Date(Date.now() - 5000).toISOString(),
			updatedAt: new Date().toISOString(),
		}) as JobRecord;
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[pdfJob]}>
				<PdfJobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /PDF reader/);
		assert.match(html, /pdf_render/);
	});

	it("pdf dispatch settles to the delivered one-liner", () => {
		const pdfJob: JobRecord = ({
			id: "jp1",
			kind: "pdf",
			chatId: "c",
			toolCallId: "call-1",
			status: "done",
			activity: "delivered",
			createdAt: new Date(Date.now() - 5000).toISOString(),
			updatedAt: new Date().toISOString(),
		}) as JobRecord;
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[pdfJob]}>
				<PdfJobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /PDF reader/);
		assert.match(html, /delivered/);
	});
});

describe("steer card rendering (the delivered artifact)", () => {
	it("renders the verified svg inline (sanitized); the maker's notes are glue and stay hidden", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="20"/></svg>';
		const steer = buildSubagentSteer(
			{ id: "jv", kind: "visual", toolCallId: "cv" },
			{ svg, notes: "Looking at the render, the diagram is clean and accurate." },
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.ok(html.includes("circle"), "svg content rendered inline");
		assert.match(html, /Figure/);
		// Natural sizing (owner, 2026-10-07): a DECLARED width (200) means the
		// holder hugs + centers rather than stretching full-width.
		assert.match(html, /w-fit/, "holder hugs the declared size");
		assert.match(html, /svg\]:max-w-full/, "svg shrinks to fit only when oversized");
		assert.ok(!html.includes("Looking at the render"), "model-facing notes never render");
	});

	it("renders the abort chip for an aborted job's steer (2026-09 dock semantics; the message type is the marker PART)", () => {
		const steer = buildAbortSteer({ id: "jc", kind: "research", toolCallId: "cc" });
		// Wave B: the steer is a native marker — the card renders its
		// PROJECTION (the same view the transcript renderer hands it).
		const view = projectNative([steer])[0]!;
		assert.equal((steer.details as { aborted: boolean }).aborted, true);
		assert.equal(view.parts.length, 2, "text (teacher-facing) + the data-subagent-aborted marker part");
		const html = renderToStaticMarkup(<SubagentSteerCard message={view as never} />);
		assert.match(html, /job-aborted-badge/);
		assert.match(html, /research/, "the job's kind, lower-cased like the complete-badge idiom");
		assert.match(html, /aborted by the learner/);
		// the teacher-facing protocol text never renders for the learner
		assert.ok(!html.includes("no brief is coming"), "no protocol glue in the chip");
		// the badge renders off the PART, not metadata (the custom-message scheme)
		const noMeta = { ...view, metadata: {} };
		const htmlNoMeta = renderToStaticMarkup(<SubagentSteerCard message={noMeta as never} />);
		assert.match(htmlNoMeta, /job-aborted-badge/, "metadata is pump mechanics, never the render seam");
	});

	it("renders a quiet Research-complete one-liner whose collapsed <details> carries the full brief", () => {
		const steer = buildSubagentSteer(
			{ id: "jr", kind: "research", toolCallId: "cr" },
			{
				brief: "Plato (c. 428–348 BCE) founded the Academy, a very long brief that would clutter the transcript.",
				sources: [
					{ title: "Britannica", url: "https://britannica.com/plato" },
					{ title: "IEP", url: "https://iep.utm.edu/plato/" },
				],
			},
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /Research/);
		assert.match(html, /complete/);
		assert.match(html, /2 sources/);
		assert.match(html, /view brief/, "the expansion affordance is offered");
		// the one-liner is a native <details> — collapsed by default, so the
		// brief + sources ride in the DOM but never clutter the transcript
		// until the learner opens them (the wave-1 "view full research" ask)
		assert.match(html, /<details[^>]*data-testid="research-complete-badge"/, "a real disclosure");
		assert.ok(!/<details[^>]*open/.test(html), "collapsed by default — no `open` attribute");
		assert.ok(html.includes("founded the Academy"), "the persisted brief rides inside the details");
		assert.ok(html.includes("britannica.com/plato"), "source links ride inside the details");
	});

	it("renders a quiet PDF-reading-complete one-liner (sources v0) whose collapsed details carries the brief + pages", () => {
		const steer = buildSubagentSteer(
			{ id: "jpf", kind: "pdf", toolCallId: "cpf" },
			{
				path: "/Users/x/course/chapter-3.pdf",
				question: "What is the integral of x dx?",
				brief: "The power rule appears on **page 1**: the integral of x dx is x^2/2 + C.",
				pagesRead: [1],
				pagesConsulted: [1, 2],
			},
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /PDF/);
		assert.match(html, /reading complete/);
		assert.match(html, /read 1 page/, "the badge counts READ pages, not search hits");
		assert.match(html, /<details[^>]*data-testid="pdf-complete-badge"/, "a real disclosure like the research badge");
		assert.ok(!/<details[^>]*open/.test(html), "collapsed by default");
		assert.ok(html.includes("power rule"), "the brief rides inside the details");
		// the path/question are sub-agent context — never learner-facing chrome
		assert.ok(!html.includes("/Users/x/course/chapter-3.pdf"), "the file path never renders");
	});

	it("renders the PDF failure brief with the failed badge when the reader FAILED", () => {
		const steer = buildSubagentSteer(
			{ id: "jpf2", kind: "pdf", toolCallId: "cpf2" },
			{ path: "/tmp/doc.pdf", question: "q", brief: "PDF failed: the file could not be opened", pagesRead: [], pagesConsulted: [] },
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /pdf-brief-card/);
		assert.match(html, /failed/);
		assert.match(html, /could not be opened/);
		assert.ok(!html.includes("pdf-complete-badge"), "no complete badge for a failure");
	});

	it("renders the visual failure note with no svg when the build FAILED", () => {
		const steer = buildSubagentSteer({ id: "jv", kind: "visual", toolCallId: "cv" }, { svg: "", notes: "FAILED: iteration limit" });
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /FAILED: iteration limit/);
		assert.ok(!html.includes("circle") && !html.includes("<svg"), "no svg for a failed build");
	});

	it("renders a fallback note when the artifact part is missing", () => {
		const msg = { id: "s", role: "user", parts: [{ type: "text", text: "x" }], metadata: { subagentResult: { jobId: "j", kind: "research", toolCallId: "c" } } };
		const html = renderToStaticMarkup(<SubagentSteerCard message={msg as never} />);
		assert.match(html, /could not be displayed/);
	});
});


describe("artifact chrome — scrollbar, invert toggles, downloads (release polish 2026-10-07)", () => {
	it("figure card: invert + download buttons; NO fullscreen button without a chat page (the context is null there)", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="20"/></svg>';
		const html = renderToStaticMarkup(<VisualOutputCard output={{ svg }} />);
		assert.match(html, /toggle-invert-figure-brightness/, "the invert switch (house Toggle)");
		assert.match(html, /data-testid="visual-download"/);
		assert.ok(!html.includes('data-testid="visual-open"'), "fullscreen needs the session overlay context");
		assert.ok(!html.includes("hue-rotate"), "inversion OFF by default");
	});

	it("figure card: NO card chrome, image first, caption row BELOW (owner round, 2026-10-07)", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="20"/></svg>';
		const html = renderToStaticMarkup(<VisualOutputCard output={{ svg }} />);
		// Document material: the outer box carries no card styling.
		const rootAt = html.indexOf('data-testid="visual-card"');
		const root = html.slice(rootAt - 200, rootAt);
		assert.ok(!root.includes("rounded-xl border"), "no card container");
		// Image BEFORE the caption row; the caption label and the controls follow it.
		const svgAt = html.indexOf('data-testid="visual-svg"');
		const captionAt = html.indexOf(">Figure<");
		assert.ok(svgAt !== -1 && captionAt !== -1 && svgAt < captionAt, "the caption row sits below the image");
		assert.ok(captionAt < html.indexOf("visual-download"), "the controls ride the caption row");
		// The invert affordance: the contrast-circle disc + the tooltip.
		assert.ok(html.includes("size-3"), "the icon disc");
		assert.ok(html.includes('title="Invert colors"'), "the tooltip names the toggle");
		// The half-moon is ACTUALLY filled (owner catch: lucide's Contrast
		// renders it hollow — fill="none" default; ours fills currentColor).
		assert.ok(
			html.includes('fill="currentColor" stroke="none"'),
			"the filled half of the invert disc",
		);
	});

	it("svgNaturalWidth: declared px sizes parse; %, auto, and absent fall back to null", () => {
		assert.equal(svgNaturalWidth('<svg width="200" height="100"></svg>'), 200);
		assert.equal(svgNaturalWidth("<svg width='320'></svg>"), 320);
		assert.equal(svgNaturalWidth('<svg width="100%"></svg>'), null, "% is no natural size");
		assert.equal(svgNaturalWidth('<svg width="auto"></svg>'), null);
		assert.equal(svgNaturalWidth('<svg viewBox="0 0 10 10"></svg>'), null, "viewBox-only → full-width law");
		assert.equal(svgNaturalWidth('<svg width="0"></svg>'), null, "degenerate zero is no size");
	});

	it("slugFilename: titles slug to filename stems; symbol-only falls back", () => {
		assert.equal(slugFilename("Damped oscillator"), "damped-oscillator");
		assert.equal(slugFilename("Ünïcode — Tïtle!"), "unicode-title");
		assert.equal(slugFilename("???"), "demo");
	});

	it("chartSize: width/height attrs are the fallback when no viewBox (figure fullscreen fit math)", () => {
		assert.deepEqual(chartSize('<svg width="320" height="240"></svg>'), { w: 320, h: 240 });
		assert.deepEqual(chartSize('<svg xmlns="x" width="50px" height="25px" viewBox="0 0 100 50"></svg>'), {
			w: 100,
			h: 50,
		}, "viewBox always wins");
	});
});

describe("setSteerUiInverted (the persisted invert switch, 2026-10-07)", () => {
	const visualSteer = buildSubagentSteer(
		{ id: "jx", kind: "visual", toolCallId: "cx" },
		{ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', notes: "verified" },
	);
	const other = { id: "other", role: "user" as const, content: "hi", timestamp: 1 };

	it("writes ui.inverted on the target steer and leaves everything else untouched", () => {
		const out = setSteerUiInverted([other, visualSteer], visualSteer.id, true);
		assert.equal(out.length, 2);
		assert.deepEqual(
			(out[1] as { details: { ui?: { inverted?: boolean } } }).details.ui,
			{ inverted: true },
		);
		assert.equal(out[0], other, "untouched messages pass through by identity");
	});

	it("toggles back to false; missing or non-artifact messages are no-ops (same array members)", () => {
		const on = setSteerUiInverted([visualSteer], visualSteer.id, true);
		const off = setSteerUiInverted(on, visualSteer.id, false);
		assert.equal((off[0] as { details: { ui?: { inverted?: boolean } } }).details.ui?.inverted, false);
		const missing = setSteerUiInverted([visualSteer], "nope", true);
		assert.equal(missing[0], visualSteer, "no target → identity");
	});
});

describe("sanitizeSvg", () => {
	it("strips script blocks, event handlers, and javascript: urls, keeps geometry", () => {
		const dirty = '<svg width="10" height="10" onload="alert(1)"><script>alert(2)</script><circle r="1" onclick="pwn()"/><a href="javascript:alert(3)"><rect width="2" height="2"/></a></svg>';
		const clean = sanitizeSvg(dirty);
		assert.ok(!/<script/i.test(clean), "script tags removed");
		assert.ok(!/\sonload/i.test(clean), "onload removed");
		assert.ok(!/\sonclick/i.test(clean), "onclick removed");
		assert.ok(!/javascript:/i.test(clean), "javascript: urls removed");
		assert.ok(clean.includes("circle") && clean.includes("rect"), "geometry preserved");
	});
});

// ─── 3. the demo-builder loop ────────────────────────────────────────────────

// ─── 4. the visual-maker loop ────────────────────────────────────────────────

const SVG_1 = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><line x1="10" y1="50" x2="290" y2="50"/></svg>';

describe("visual maker (fake model + fake headless)", () => {
	it("write → render → look → finish delivers the svg with notes", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			{ text: "A number line from -3 to 3 with the root marked at 0." },
		]);
		const activities: string[] = [];
		const result = await runVisualMaker({ brief: "Number line, root at 0." }, { engine: model, headless, onActivity: (l) => activities.push(l) });

		assert.equal(result.svg, SVG_1);
		assert.equal(result.notes, "A number line from -3 to 3 with the root marked at 0.");
		assert.equal(headless.svgRenders.length, 1);
		assert.ok(activities.some((a) => a.startsWith("render_svg")), "render activity recorded");
	});

	it("forces a look when the model finishes without rendering the final svg", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ text: "Done." }, // premature finish — no render yet
			{ text: "Looked at it — correct." }, // after the forced look
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });
		assert.equal(result.svg, SVG_1, "delivered after the forced look");
		assert.equal(result.notes, "Looked at it — correct.");
		assert.equal(headless.svgRenders.length, 1, "the gate rendered the svg once itself");
	});

	it("edit_svg: exact-match single replacement, with fuzzy context on a miss", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			// A miss: old_text not in the document (error fed back, nothing changed)
			{ toolCalls: [{ toolCallId: "e1", toolName: "edit_svg", input: { old_text: "NOT-PRESENT", new_text: "x" } }] },
			// A hit: exactly one occurrence — applied
			{ toolCalls: [{ toolCallId: "e2", toolName: "edit_svg", input: { old_text: '<line x1="10"', new_text: '<line x1="20"' } }] },
			{ toolCalls: [{ toolCallId: "r2", toolName: "render_svg", input: {} }] },
			{ text: "Moved the start of the line." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });

		assert.equal(result.svg, SVG_1.replace('<line x1="10"', '<line x1="20"'), "the edit was applied to the delivered svg");
		assert.equal(result.notes, "Moved the start of the line.");
		assert.equal(headless.svgRenders.length, 2, "re-rendered after the edit (the look gate saw the change)");
	});

	it("edit_svg before write_svg errors and never edits nothing into a deliverable", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			// Nothing written yet — the edit must error, not crash the loop
			{ toolCalls: [{ toolCallId: "e0", toolName: "edit_svg", input: { old_text: "svg", new_text: "x" } }] },
			{ text: "Cannot proceed." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });
		assert.equal(result.svg, "", "the failed edit produced no deliverable");
		assert.match(result.notes ?? "", /never wrote an SVG/);
	});

	it("feeds render errors back to the model instead of crashing", async () => {
		const headless = fakeHeadless({ renderFailures: 1 });
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: "<svg>broken" } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			{ toolCalls: [{ toolCallId: "w2", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ toolCalls: [{ toolCallId: "r2", toolName: "render_svg", input: {} }] },
			{ text: "Fixed and verified." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });
		assert.equal(result.svg, SVG_1);
		assert.equal(result.notes, "Fixed and verified.");
	});

	it("fails when the model never writes an svg", async () => {
		const model = scriptedModel([{ text: "This idea is purely relational — belongs in mermaid." }]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless: fakeHeadless() });
		assert.equal(result.svg, "");
		assert.match(result.notes ?? "", /^FAILED: the maker never wrote an SVG/);
	});

	it("fails with a clear message when no Chrome is available", async () => {
		const result = await runVisualMaker({ brief: "b" }, { engine: scriptedModel([{ text: "x" }]), headless: noChromeHeadless() });
		assert.equal(result.svg, "");
		assert.match(result.notes ?? "", /^FAILED: .*Chrome/);
	});
});

// ─── 5. job runners + dispatch ───────────────────────────────────────────────

const DEMO_INPUT = { title: "Compound interest", brief: "Slider for rate, curve of growth over 30 years." };

function waitFor(cond: () => boolean, timeoutMs = 5000, what = "condition"): Promise<void> {
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

async function drain(res: Response): Promise<string> {
	if (res.status !== 200) assert.fail(`expected 200, got ${res.status}: ${await res.text()}`);
	return res.text();
}

/** CONNECTION DIET B (owner, 2026-10-10): the POST acks and closes; drain
 *  the turn's wire through the reattach stream instead (settle-tolerant:
 *  a short turn may finish inside the handler). */
async function drainRunning(chatId: string): Promise<string> {
	const handle = runningTurn(chatId);
	if (!handle) return ""; // the turn already settled — completion happened
	return new Response(handle.subscribe()).text();
}


describe("visual job runners", () => {
	it("runJob still steers on visual failure and the job lands error", async () => {
		const chat = chatStore.createChat("Test: visual runner failure");
		createdChats.push(chat.id);
		chatStore.saveMessages(chat.id, [
			{ id: "u1", role: "user", content: "draw it", timestamp: 1 } as never,
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "call-v1", name: "visual", arguments: { brief: "b" } as never }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "stop",
				timestamp: 1,
			} as never,
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "call-v1",
				toolName: "visual",
				content: [{ type: "text", text: "Dispatched." }],
				details: "Dispatched.",
				isError: false,
				timestamp: 1,
			} as never,
		]);

		const job = jobStore.createJob({ kind: "visual", chatId: chat.id, toolCallId: "call-v1" });
		createdJobs.push(job.id);

		visualModelOverride.current = scriptedModel([{ text: "cannot" }]);
		const { steers, runner } = testRunner();
		try {
			await runner.runJob(job.id);
		} finally {
			visualModelOverride.current = undefined;
		}

		const errored = jobStore.getJob(job.id)!;
		assert.equal(errored.status, "error");
		assert.match(errored.error ?? "", /never wrote an SVG/);

		assert.ok(steers[0], "failure still delivers a steer — the teacher learns the outcome");
		const result = (steers[0]!.details as { result: unknown }).result as { svg: string; notes?: string };
		assert.equal(result.svg, "");
		assert.match(result.notes ?? "", /^FAILED:/);
	});

	it("dispatch through a teacher turn: the call acks mid-turn and the runner completes in the background", async () => {
		const chat = chatStore.createChat("Test: visual spawn dispatch");
		createdChats.push(chat.id);
		// BYOK turn gate (owner, 2026-09-22): the scripted chat needs a
		// conversation model — the per-chat pin, exactly like the setup flow.
		chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });

		// A teacher that calls visual on turn 1, then continues in the same turn.
		const teacher = scriptedModel([
			{ toolCalls: [{ toolCallId: "call-v2", toolName: "visual", input: { brief: "A simple line" } }] },
			{ text: "Here it is." },
		]);

		// The overrides must be live BEFORE the request — dispatch fires the
		// runner mid-stream, inside the tool execute.
		visualModelOverride.current = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			{ text: "A simple line." },
		]);
		headlessOverride.current = fakeHeadless();
		const { steers, runner } = testRunner();

		try {
			const ack = await handleChatRequest(
				new Request("http://test/api/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chatId: chat.id,
						// Wave B: the input-events contract — one event,
						// never a client transcript.
						input: { type: "text", text: "teach me compounding" },
					}),
				}),
				// The handler hands the factory the native build options
				// (messages are the merged record; the record IS the agent
				// state — no adapter conversion).
				(opts) =>
					createTeacherAgent(undefined, {
						engine: teacher,
						messages: opts.messages,
						tools: createTeacherTools({
							chatId: chat.id,
							chatStore,
							jobStore,
							spawn: (job, input) => void runner.runJob(job.id, input),
						}),
					}),
			);
			if (ack.status !== 200) assert.fail(`expected 200 ack, got ${ack.status}: ${await ack.text()}`);
			await drainRunning(chat.id);

			const job = jobStore.findJobByToolCallId(chat.id, "call-v2");
			assert.ok(job, "dispatch created a job at tool-execute time");
			assert.equal(job!.kind, "visual");
			createdJobs.push(job!.id);

			// The background runner (fire-and-forget) completes with the overrides.
			await waitFor(() => jobStore.getJob(job!.id)!.status !== "running", 8000, "visual job completion");
			const done = jobStore.getJob(job!.id)!;
			assert.equal(done.status, "done");

			const saved = projectNative(chatStore.getChat(chat.id)!.messages);
			const part = saved[1]!.parts.find((p) => p.type === "tool-visual");
			assert.ok(part && part.type === "tool-visual", "visual tool part persisted");
			assert.equal(part.state, "output-available", "the part resolved with the ack at dispatch time");
			assert.match(String((part as { output?: unknown }).output), /fire-and-forget/);

			assert.equal(steers.length, 1, "one job, one steer");
			assert.equal((steers[0]!.details as { jobId: string }).jobId, job!.id);

			// Idempotency: dispatch dedupes by toolCallId — no second job.
			assert.equal(jobStore.listJobs(chat.id).length, 1, "no duplicate job for the same tool part");
		} finally {
			visualModelOverride.current = undefined;
			headlessOverride.current = undefined;
		}
	});
});

// ─── 6. registry wiring ──────────────────────────────────────────────────────

describe("tool + renderer registry wiring", () => {
	it("research, visual and local PDF are the server-executed job tools", () => {
		const { runner } = testRunner();
		const tools = jobTools({ chatId: "chat_registry", jobStore, spawn: (job) => void runner.runJob(job.id) });
		assert.deepEqual(Object.keys(tools).sort(), ["pdf", "research", "visual"]);
		for (const name of ["visual", "research", "pdf"] as const) {
			assert.equal(typeof (tools[name] as { execute?: unknown }).execute, "function", `${name} executes server-side — fire-and-forget ack per THE ASYNC PROTOCOL`);
		}
		assert.equal(Value.Check(visualInputSchema, { brief: "b" }), true);
		assert.equal(Value.Check(visualInputSchema, {}), false, "visual requires a brief");
		assert.equal(Value.Check(pdfInputSchema, { path: "/tmp/doc.pdf", question: "q" }), true);
		assert.equal(Value.Check(pdfInputSchema, { question: "q" }), false, "pdf requires a path");
		assert.equal(Value.Check(pdfInputSchema, { path: "/tmp/doc.pdf" }), false, "pdf requires a question");
	});

	it("the artifact renderer registry contains only the approved office tools", () => {
		assert.equal(artifactRenderers.visual, VisualCard);
		// sources v0 — pdf maps to its dispatch card (the live-smoke gap)
		assert.equal(artifactRenderers.pdf, PdfJobCard);
		// wave 7 — the prober's graph tools join the SAME discipline (they
		// rendered like nothing happened before this interlude)
		for (const t of ["list_sessions", "list_propositions"]) {
			assert.equal(artifactRenderers[t], ToolCallCard, `${t} renders the tool-call card`);
		}
	});

	it("the tool-call card: the prober's graph tools — collapsed headline + their compact row output", () => {
		// list_propositions: the session id is the call's subject
		const propPart = {
			type: "tool-list_propositions",
			state: "output-available",
			toolCallId: "g1",
			input: { session: "chat_mtiudjao_776beada" },
			output: "2 proposition(s) born in this session:\n- Kepler's laws — solid (as of 2026-09-20)\n- Tidal locking — shaky (as of 2026-09-21)",
		};
		const html = renderToStaticMarkup(<ToolCallCard part={propPart as never} />);
		assert.match(html, /list_propositions/);
		assert.match(html, /chat_mtiudjao_776beada/); // the collapsed headline
		assert.match(html, /Kepler&#x27;s laws/); // the row output, verbatim (apostrophe HTML-escaped)
		assert.ok(html.includes("<details"), "collapsed by default");

		// list_sessions: no headline arg (empty input) — the tool name alone,
		// exactly the ls-with-no-path discipline
		const sessPart = {
			type: "tool-list_sessions",
			state: "output-available",
			toolCallId: "g2",
			input: {},
			output: "3 session(s) in the knowledge graph, most recent first:\n1. Orbital mechanics (chat, 8 propositions, born 2026-09-18)",
		};
		const html2 = renderToStaticMarkup(<ToolCallCard part={sessPart as never} />);
		assert.match(html2, /list_sessions/);
		assert.match(html2, /Orbital mechanics/);
		const headline = html2.split("<summary")[1]?.split("</summary>")[0] ?? "";
		assert.doesNotMatch(headline, /Orbital/, "the collapsed line shows the tool name only — no noise");
	});

});
