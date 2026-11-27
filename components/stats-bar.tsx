"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { contextWindow, sessionCost, turnCost, type ChatSettings, type KnowledgeSearchScope, type TurnUsage } from "@/src/core";
import { formatTokens, formatUsd, prettyModel } from "@/components/usage-format";
import { catalogLimits, useModelCatalog } from "@/components/model-picker";
import { useI18n } from "@/components/i18n-provider";
import { useServerCapabilities } from "@/components/server-capabilities";
import { formatMessage } from "@/src/core";

/**
 * The below-composer stats bar (wave 4 observability): the session's
 * money/context footprint as one quiet row beneath the composer —
 * LEFT-aligned: context window + session cost; RIGHT-aligned: model +
 * thinking level. Clicking the left side opens the per-turn detail popover.
 *
 *  Pre-chat views (home, /chat/new) render NO left side at all (owner,
 *  wave 7 sweep: the knowledge-context budget slider that used to live
 *  there died with the injection; a "— · —" summary over an empty
 *  popover is pure noise) — the dictation strip's middle simply widens.
 *
 * All folds come from core/prices.ts (sessionCost, contextWindow, turnCost)
 * — no cost math lives here. Absent data renders "—", never zero (the
 * doctrine): no turns yet → every figure is "—"; turns the price table
 * can't price count as unpriced, shown in the popover, never folded into
 * a fake $0. The RIGHT side is the model + thinking control (components/
 * model-picker.tsx): one controller for the conversation agents, backed by
 * pi-ai's catalog; the buttons show the EFFECTIVE model (the record's
 * settings, else config's pin), while the left-side figures still fold the
 * turn log's actual billed models.
 */
/** Scope select beside "Use office knowledge"; rendered only while that is ON. */
export function KnowledgeScopeSelect({ settings, disabled, onChange }: {
 settings: ChatSettings | null;
 disabled: boolean;
 onChange: (scope: KnowledgeSearchScope) => void;
}) {
 const copy = useI18n().activityUi;
 if (settings?.officeKnowledgeEnabled !== true) return null;
 return (
  <select
   aria-label={copy.knowledgeScope}
   value={settings.knowledgeScope ?? "all"}
   disabled={disabled}
   onChange={(event) => onChange(event.target.value as KnowledgeSearchScope)}
   className="cursor-pointer rounded border border-border bg-background px-1 py-0.5 text-inherit"
   data-testid="knowledge-scope-select"
  >
   <option value="all">{copy.knowledgeScopeAll}</option>
   <option value="shared">{copy.knowledgeScopeShared}</option>
   <option value="personal">{copy.knowledgeScopePersonal}</option>
  </select>
 );
}

/** The new-session screen's model dropdown (model selection, owner 2026-11-27):
 *  the configured models by name, always shown — even with only one. */
export function ModelSelect({ value, onChange }: { value: string; onChange: (model: string) => void }) {
 const copy = useI18n().activityUi;
 const { models } = useServerCapabilities();
 if (models.length === 0) return null;
 return (
  <select
   aria-label={copy.model}
   value={models.includes(value) ? value : models[0]}
   onChange={(event) => onChange(event.target.value)}
   className="pointer-events-auto cursor-pointer rounded border border-border bg-background px-1 py-0.5 text-inherit"
   data-testid="model-select"
  >
   {models.map((m) => <option key={m} value={m}>{m}</option>)}
  </select>
 );
}

/** A session's web/knowledge switch (or the knowledge scope). */
export type SourceField = "webResearchEnabled" | "officeKnowledgeEnabled" | "knowledgeScope";

export function StatsBar({
	turns,
	dictationSlot,
	chatId,
	leadingSlot,
	webMode: webModeProp,
	draftSources,
	draftModel,
}: {
	turns: TurnUsage[];
	/** The bound session (per-session models, owner 2026-09-28): present
	 *  on the in-session bar — the model control binds THE SESSION'S own
	 *  record; absent on the draft surfaces, where it binds the strong
	 *  slot (the new-session default). */
	chatId?: string;
	/** The dictation strip (STT wave, 2026-09-17): the row's middle is dead
	 *  space between the session data and the model control — the mic
	 *  button lives there, and while recording the meter unfurls to fill
	 *  whatever width the row has (owner placement). */
	dictationSlot?: ReactNode;
	/** The row's LEFT edge (practice sessions, 2026-10-04): the home
	 *  composer's teach | practice switch rides here — before the session
	 *  data (which renders nothing pre-chat on that surface). */
	leadingSlot?: ReactNode;
	/** Overrides the server's setup (tests); normally read from ServerCapabilitiesProvider. */
	webMode?: "linked-pages" | "search";
	/** The new-session screen's web/knowledge switches: held locally until the session
	 *  exists, then saved to it before its first reply (no chatId yet). */
	draftSources?: { settings: ChatSettings; onChange: (field: SourceField, value: boolean | KnowledgeSearchScope) => void };
	/** The new-session screen's model choice, sent when the session is created. */
	draftModel?: { value: string; onChange: (model: string) => void };
}) {
	const copy = useI18n().activityUi;
	// The web switch says "Enable web search" when the server has a search provider,
	// "Read linked pages" when it can only open links the user pastes.
	const { webSearch } = useServerCapabilities();
	const webMode = webModeProp ?? (webSearch ? "search" : "linked-pages");
	const webLabel = webMode === "search" ? copy.enableWebSearch : copy.readLinkedPages;
	const [open, setOpen] = useState(false);
	// Same dropdown discipline as the model control (owner, df4433f treatment,
	// stats round 1): close on any pointerdown outside the bar or on Escape.
	const barRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// THE ONE-ESC LAW (keyboard round 2026-10-06): claim — the
				// window chain must not also act under this popover.
				e.preventDefault();
				e.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);
	// The live-limits join (context-meter amendment, owner 2026-09-23):
	// contextWindow's denominator resolves ONLY from pi's live catalog —
	// built client-side over the picker's cached /api/models fetch (the
	// same fetch ModelControl below rides; module-level dedupe). Catalog
	// pending or failed → undefined index → limit null → USAGE-ONLY (the
	// honest-render precedent, never a fake window); the usage-only render
	// IS the null path.
	const { catalog } = useModelCatalog();
	const limits = useMemo(() => (catalog ? catalogLimits(catalog) : undefined), [catalog]);
	const ctx = contextWindow({ turns }, limits);
	const { cost, unpriced } = sessionCost({ turns });
	// Honest cost: show dollars only when at least one turn priced;
	// otherwise "—" (never a fake $0.0000).
	const pricedCount = turns.length - unpriced;
	const costLabel = pricedCount > 0 ? formatUsd(cost) : "—";
	const lastModel = turns.at(-1)?.model;
 const [sessionSettings, setSessionSettings] = useState<ChatSettings | null>(null);
 const [saving, setSaving] = useState(false);
 const [settingError, setSettingError] = useState<string | null>(null);
 useEffect(() => {
  if (!chatId) return;
  let cancelled = false;
  setSessionSettings(null);
  fetch(`/api/chats/${encodeURIComponent(chatId)}`)
   .then((response) => response.ok ? response.json() : Promise.reject())
   .then((body: { settings?: ChatSettings }) => { if (!cancelled) setSessionSettings(body.settings ?? {}); })
   .catch(() => { if (!cancelled) setSettingError(copy.loadControlsError); });
  return () => { cancelled = true; };
 }, [chatId]);
 const saveFlag = async (field: "webResearchEnabled" | "officeKnowledgeEnabled" | "knowledgeScope", value: boolean | KnowledgeSearchScope) => {
  if (!chatId || !sessionSettings || saving) return;
  setSaving(true);
  setSettingError(null);
  const next = {
   webResearchEnabled: sessionSettings.webResearchEnabled ?? false,
   officeKnowledgeEnabled: sessionSettings.officeKnowledgeEnabled ?? false,
   knowledgeScope: sessionSettings.knowledgeScope ?? "all",
   [field]: value,
  };
  try {
   const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
   });
   if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? copy.saveControlsError);
   }
   const body = await response.json() as { settings?: ChatSettings };
   setSessionSettings(body.settings ?? next);
  } catch (error) {
   setSettingError(error instanceof Error ? error.message : copy.saveControlsError);
  } finally {
   setSaving(false);
  }
 };


	return (
		<div
			data-testid="stats-bar"
			// pointer-events-auto: the sticky composer wrapper is pointer-events-none
			// (so its transparent gradient area never blocks scrolling) — this row
			// must re-enable events or every control on it is dead (the model-
			// control wave caught this live: buttons rendered, clicks never landed).
			className="pointer-events-auto relative flex items-center justify-between gap-3 px-3 pt-2 text-xs text-muted-foreground"
		>
			{/* The summary button + its popover: the popover anchors to this
			    wrapper, CENTERED over the button itself (owner, stats round 2)
			    — not over the whole bar row, which made it line up oddly. The
			    outside-close ref anchors HERE too (owner, round 3): on the whole
			    bar it wrapped the model control, so clicking model/thinking never
			    counted as outside — the asymmetry the owner observed. */}
			{/* The leading slot (2026-10-04): the leftmost control surface —
			    the home composer's mode switch. */}
			{leadingSlot}
			{/* The left side: the session-data summary — only once a session
			    exists (turns). Pre-chat renders nothing (see the header). */}
			{turns.length > 0 && (
			<div ref={barRef} className="relative">
				{/* No tooltip — the numbers describe themselves and the popover
			    speaks on click (owner, subtlety round 2026-09-25). */}
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				data-testid="stats-summary"
				className="flex items-center gap-1.5 tabular-nums transition-colors hover:text-foreground"
			>
				<span data-testid="stats-context">
					{ctx ? (ctx.limit !== null ? `${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.limit)}` : formatTokens(ctx.usedTokens)) : "—"}
				</span>
				<span aria-hidden>·</span>
				<span data-testid="stats-cost">{costLabel}</span>
			</button>
				{open && (
					<div
						data-testid="stats-detail"
						className="absolute bottom-full left-1/2 z-40 mb-1.5 w-72 -translate-x-1/2 rounded-xl border bg-card p-3 text-xs shadow-xl"
					>
						<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{copy.sessionStats}
						</div>
						<div className="flex flex-col gap-1 text-muted-foreground">
							<div className="flex justify-between gap-2">
								<span>{copy.contextLastCall}</span>
								<span className="tabular-nums text-card-foreground">
									{ctx ? (ctx.limit !== null ? `${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.limit)}` : formatTokens(ctx.usedTokens)) : "—"}
								</span>
							</div>
							<div className="flex justify-between gap-2">
								<span>{copy.totalCost}</span>
								<span className="tabular-nums text-card-foreground">{costLabel}</span>
							</div>
							{unpriced > 0 && (
								<div className="flex justify-between gap-2">
									<span>{copy.unpricedTurns}</span>
									<span className="tabular-nums text-card-foreground">{unpriced}</span>
								</div>
							)}
						</div>
						{turns.length > 0 && (
							<>
								<div className="mb-1 mt-2.5 border-t pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
									{copy.turns}
								</div>
								<ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
									{turns.map((turn, i) => {
										const c = turnCost(turn);
										return (
											<li key={`${turn.messageId}-${i}`} className="flex items-center justify-between gap-2">
												<span className="truncate text-muted-foreground">
													#{i + 1} · {prettyModel(turn.model, true)}
												</span>
												<span className="flex shrink-0 items-center gap-2 tabular-nums text-card-foreground">
											<span className="text-muted-foreground">{formatMessage(copy.stepCount, { count: turn.steps.length })}</span>
													<span>{c === null ? "—" : formatUsd(c)}</span>
												</span>
											</li>
										);
									})}
								</ul>
							</>
						)}
					</div>
				)}
			</div>
			)}
			{/* The middle slot: dictation (owner, 2026-09-17). flex-1 lets the
			    meter expand into the row's free width; justify-center keeps the
			    lone idle mic button visually centered. */}
			{dictationSlot && (
				<div className="flex min-w-0 flex-1 items-center justify-center">{dictationSlot}</div>
			)}

   {draftModel && !chatId && <ModelSelect value={draftModel.value} onChange={draftModel.onChange} />}
   {(chatId || draftSources) && (() => {
    // A running session saves each change to its record; the new-session screen
    // holds them until the session exists (draftSources).
    const settings = chatId ? sessionSettings : draftSources!.settings;
    const disabled = chatId ? !sessionSettings || saving : false;
    const change = (field: SourceField, value: boolean | KnowledgeSearchScope) => { if (chatId) void saveFlag(field, value); else draftSources!.onChange(field, value); };
    return (
     <div className="flex flex-wrap items-center gap-3" data-testid="session-source-controls">
      {(["webResearchEnabled", "officeKnowledgeEnabled"] as const).map((field) => (
       <label key={field} className="flex cursor-pointer items-center gap-1.5">
        <input
         type="checkbox"
         checked={settings?.[field] ?? false}
         disabled={disabled}
         onChange={(event) => change(field, event.target.checked)}
         aria-label={field === "webResearchEnabled" ? webLabel : copy.officeKnowledge}
         className="accent-foreground"
        />
        <span>{field === "webResearchEnabled" ? webLabel : copy.officeKnowledge}</span>
       </label>
      ))}
      <KnowledgeScopeSelect settings={settings} disabled={chatId ? saving : false} onChange={(scope) => change("knowledgeScope", scope)} />
      {chatId && settingError && <span role="alert" className="text-red-400">{settingError}</span>}
     </div>
    );
   })()}

		</div>
	);
}
