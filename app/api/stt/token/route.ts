export async function GET() { return Response.json({ error: "Dictation is disabled" }, { status: 410 }); }
