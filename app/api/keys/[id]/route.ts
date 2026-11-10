import { withOfficeUser } from "@/src/server";
﻿/** Office deployment owns credentials through its environment. */
async function PUTImpl() {
	return Response.json({ error: "API keys are managed by the server environment" }, { status: 403 });
}

async function DELETEImpl() {
	return Response.json({ error: "API keys are managed by the server environment" }, { status: 403 });
}

export const PUT = withOfficeUser(PUTImpl);
export const DELETE = withOfficeUser(DELETEImpl);
