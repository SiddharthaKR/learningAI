/** Office deployment owns credentials through its environment. */
export async function PUT() {
	return Response.json({ error: "API keys are managed by the server environment" }, { status: 403 });
}

export async function DELETE() {
	return Response.json({ error: "API keys are managed by the server environment" }, { status: 403 });
}
