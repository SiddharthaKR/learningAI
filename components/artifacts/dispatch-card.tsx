"use client";

import { useContext } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { JobsContext } from "@/components/jobs-context";
import { type JobKind, type JobRecord } from "@/src/core";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useI18n } from "@/components/i18n-provider";
import { formatMessage } from "@/src/core";

/**
 * The dispatch card (contracts.ts "THE ASYNC PROTOCOL" §4): the tool-call
 * box for a background sub-agent. The tool part's output is the FIRE-AND-
 * FORGET ACK (a string) — never the result. Live status comes from the
 * chat-view jobs feed via JobsContext, matched by toolCallId:
 *
 *   job unknown → "dispatched" pulse (the jobs feed hasn't seen it yet)
 *   running     → live activity card (activity line + elapsed)
 *   done/error  → quiet one-liner ("delivered" / "failed") — the artifact
 *                 itself arrives in the steer message right below, so the
 *                 box must not duplicate it.
 */
export function DispatchCard({ toolCallId, kind }: { toolCallId: string; kind: JobKind }) {
	const copy = useI18n().artifactUi;
	const jobs = useContext(JobsContext);
	const job = jobs.find((j) => j.toolCallId === toolCallId) ?? null;
	const labels: Record<JobKind, string> = {
		research: copy.researchAgent,
		demo: copy.demoAgent,
		visual: copy.figureAgent,
		pdf: copy.pdfReader,
	};
	const label = labels[kind];

	if (!job || job.status === "running") {
		return <DispatchActivityCard job={job} label={label} />;
	}
	const failed = job.status === "error";
	return (
		<div
			className="flex items-center gap-2 text-xs text-muted-foreground"
			data-testid="dispatch-settled"
		>
			{failed ? <XIcon className="size-3.5 text-red-500" /> : <CheckIcon className="size-3.5" />}
			<span className="font-medium uppercase tracking-wide">{label}</span>
			<span>{failed ? copy.failed : copy.delivered}</span>
		</div>
	);
}

function DispatchActivityCard({ job, label }: { job: JobRecord | null; label: string }) {
	const copy = useI18n().artifactUi;
	// Elapsed from createdAt — jobs appear here only via the jobs feed (post-mount),
	// so no SSR/hydration mismatch.
	const elapsed =
		job && job.createdAt ? Math.max(0, Math.round((Date.now() - Date.parse(job.createdAt)) / 1000)) : null;
	return (
		<div
			className="rounded-xl border bg-card p-4 text-card-foreground"
			data-testid="dispatch-card"
		>
			<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{/* The working-state grammar (owner, streaming round 2026-10-01):
				    the Braille spinner replaces the pulsing dot — one indicator
				    everywhere. This is the ONLY dispatch-card change; the card's
				    shape is untouched. */}
				<BrailleSpinner label={formatMessage(copy.runningAria, { agent: label })} />
				{label}
				{elapsed !== null && <span className="font-normal">· {elapsed}s</span>}
			</div>
			{job?.activity && (
				<div className="mt-1 truncate text-sm text-muted-foreground" data-testid="dispatch-activity-line">
					{job.activity}
				</div>
			)}
			{!job && (
				<div className="mt-1 text-sm text-muted-foreground" data-testid="dispatch-pending">
					{copy.dispatched}
				</div>
			)}
		</div>
	);
}
