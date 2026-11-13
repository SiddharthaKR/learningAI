import { withOfficeUser } from "@/src/server";
import { getChat } from "@/src/server";
import { getSessionSources } from "@/src/agent/session-sources.ts";
import { runVerifierAgent, type VerifierClaim } from "@/src/agent/subagents/verifier.ts";

/**
 * POST /api/chats/[id]/verify — verify a teaching message's claims
 * against stored session sources. Body: { text: string }.
 * Returns: { claims: VerifierClaim[] }.
 */
async function POSTImpl(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });

	const body = (await req.json()) as { text?: string };
	if (!body.text || typeof body.text !== "string") {
		return Response.json({ error: "Missing text" }, { status: 400 });
	}

	const sourceStore = getSessionSources(id);
	const sources = Array.from(sourceStore.values()).map((s) => ({
		url: s.url,
		markdown: s.markdown,
	}));

	try {
		const claims: VerifierClaim[] = await runVerifierAgent(body.text, sources);
		return Response.json({ claims });
	} catch (err) {
		return Response.json(
			{ error: err instanceof Error ? err.message : "Verification failed" },
			{ status: 500 },
		);
	}
}

export const POST = withOfficeUser(POSTImpl);
