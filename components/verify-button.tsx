"use client";

import { useState } from "react";
import { ShieldCheckIcon } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

export interface VerifyClaim {
	claim: string;
	verdict: "supported" | "unsupported" | "partial";
	sourceUrl: string | null;
	sourceQuote: string | null;
	explanation: string;
}

const VERDICT_STYLES: Record<string, string> = {
	supported: "text-emerald-500",
	partial: "text-amber-500",
	unsupported: "text-red-400",
};

const VERDICT_BG: Record<string, string> = {
	supported: "bg-emerald-500/10 border-emerald-500/20",
	partial: "bg-amber-500/10 border-amber-500/20",
	unsupported: "bg-red-400/10 border-red-400/20",
};

export function VerifyButton({ chatId, text }: { chatId: string; text: string }) {
	const copy = useI18n().verify;
	const [state, setState] = useState<"idle" | "loading" | "done">("idle");
	const [claims, setClaims] = useState<VerifyClaim[]>([]);
	const [expanded, setExpanded] = useState(false);

	const verify = async () => {
		if (state === "loading") return;
		if (state === "done") {
			setExpanded(!expanded);
			return;
		}
		setState("loading");
		try {
			const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/verify`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
			});
			if (!res.ok) {
				setState("idle");
				return;
			}
			const data = (await res.json()) as { claims: VerifyClaim[] };
			setClaims(data.claims);
			setState("done");
			setExpanded(true);
		} catch {
			setState("idle");
		}
	};

	return (
		<div className="lh-verify-wrapper">
			<button
				type="button"
				onClick={() => void verify()}
				title={state === "done" ? copy.verified : copy.tooltip}
				className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] transition-all ${
					state === "done"
						? "text-emerald-500/70 hover:text-emerald-500"
						: state === "loading"
							? "animate-pulse text-muted-foreground/50"
							: "text-muted-foreground/0 hover:text-muted-foreground/60 group-hover/passage:text-muted-foreground/30"
				}`}
			>
				<ShieldCheckIcon className="size-3" />
				{state === "loading" && <span>{copy.running}</span>}
			</button>

			{expanded && claims.length > 0 && (
				<div className="mt-2 space-y-2 rounded-lg border bg-card/50 p-3">
					{claims.map((c, i) => (
						<div
							key={i}
							className={`rounded-md border p-2.5 text-xs ${VERDICT_BG[c.verdict] ?? ""}`}
						>
							<div className="flex items-start justify-between gap-2">
								<span className="font-medium text-foreground">{c.claim}</span>
								<span className={`shrink-0 text-[10px] font-semibold uppercase ${VERDICT_STYLES[c.verdict] ?? ""}`}>
									{c.verdict === "supported" ? copy.supported : c.verdict === "partial" ? copy.partial : copy.unsupported}
								</span>
							</div>
							<p className="mt-1 text-muted-foreground">{c.explanation}</p>
							{c.sourceQuote && (
								<blockquote className="mt-1.5 border-l-2 border-muted-foreground/30 pl-2 text-[11px] italic text-muted-foreground">
									{c.sourceQuote}
								</blockquote>
							)}
							{c.sourceUrl && (
								<a
									href={c.sourceUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-1 block truncate text-[10px] text-muted-foreground/60 underline-offset-2 hover:underline"
								>
									{c.sourceUrl}
								</a>
							)}
						</div>
					))}
				</div>
			)}

			{expanded && claims.length === 0 && state === "done" && (
				<div className="mt-2 rounded-lg border bg-card/50 p-3 text-xs text-muted-foreground">
					{copy.noClaims}
				</div>
			)}
		</div>
	);
}
