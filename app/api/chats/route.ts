import { withOfficeUser } from "@/src/server";
import { currentUserId } from "@/src/server";
import { createAccountStore } from "@/src/server";
import { PATHS } from "@/config";
import { chainsForSelection, formatChainLine } from "@/src/core";
import { newGraphContextMessage, type GraphContextPick } from "@/src/core";
import { compactionInFlight, createChat, isTurnRunning, listChats, fixedOfficeModelSpec, officeModel, stores, titleFromPrompt } from "@/src/server";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight". */
async function GETImpl() {
	const chats: ChatListItem[] = listChats().map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
	}));
	return Response.json({ chats });
}

async function POSTImpl(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; graphContext?: unknown; teachingLanguage?: unknown; model?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// Practice sessions (owner, 2026-10-04): kind "practice" marks the
	// record — the practice agent + its tools from turn 1, no extraction.
	const kind = body.kind === "practice" ? ("practice" as const) : body.kind === "chat" ? ("chat" as const) : undefined;
	const account = await createAccountStore(PATHS.data).byId(currentUserId());
	if (!account) return Response.json({ error: "Account not found" }, { status: 401 });
	const language = body.teachingLanguage === undefined ? account.teachingLanguage : body.teachingLanguage;
	if (language !== "en" && language !== "ja") return Response.json({ error: "Invalid teaching language" }, { status: 400 });
	// Model selection (owner, 2026-11-27): the model picked on the new-session
	// screen, by name; absent means model 1. An unknown name is refused.
	if (body.model !== undefined && (typeof body.model !== "string" || !officeModel(body.model))) {
		return Response.json({ error: "Unknown model" }, { status: 400 });
	}
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind, language);
	const model = typeof body.model === "string" ? { provider: "office" as const, id: body.model } : fixedOfficeModelSpec();
	stores.chatStore.saveSettings(chat.id, { model });
	// The session's map context (owner, 2026-10-04): the picked
	// propositions ride the CREATION — message[0] is a graph-context
	// marker (a separate custom message BEFORE the learner's first user
	// message), carrying the picks plus the reasoning chains among them.
	// The picks carry their own name/statement (what the learner saw at
	// pick time); the chains derive from the CURRENT graph snapshot.
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, 64)
			: [];
	if (picks.length > 0) {
		const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
			formatChainLine(c, Object.fromEntries(byId)),
		);
		stores.chatStore.saveMessages(chat.id, [newGraphContextMessage(picks, chainLines)]);
	}
	return Response.json({ id: chat.id, title: chat.title });
}

export const GET = withOfficeUser(GETImpl);
export const POST = withOfficeUser(POSTImpl);
