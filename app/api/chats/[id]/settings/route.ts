import { withOfficeUser } from "@/src/server";
import { getChat, parseSettingsBody, stores } from "@/src/server";
import { emit } from "@/src/core";

/** Owner-scoped office controls, replace-whole: absent flags mean OFF.
 * Agent composition adopts the persisted controls on the next run.
 * Model/provider/thinking choices belong to the fixed server configuration. */
async function PUTImpl(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });

	const body = await req.json().catch(() => null);
	if (body && typeof body === "object" && "model" in body) return Response.json({ error: "Models are managed by the server environment" }, { status: 403 });
	const parsed = parseSettingsBody(body);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	for (const field of Object.keys(body)) {
		if (field !== "webResearchEnabled" && field !== "officeKnowledgeEnabled") {
			return Response.json({ error: `Unsupported session setting: ${field}` }, { status: 400 });
		}
	}

	// The settings and neutral history marker share one durable publication.
	const { settings, changed } = stores.chatStore.saveSessionControls(id, {
		webResearchEnabled: parsed.settings.webResearchEnabled === true,
		officeKnowledgeEnabled: parsed.settings.officeKnowledgeEnabled === true,
	});
	if (changed) emit("record-changed", { chatId: id });
	return Response.json({ settings });
}

export const PUT = withOfficeUser(PUTImpl);
