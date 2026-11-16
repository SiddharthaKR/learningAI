import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { createSessionToken } from "../src/server/session-auth.ts";
import { POST } from "../app/api/knowledge/documents/route.ts";
import { POST as PICTURES } from "../app/api/knowledge/documents/[id]/pictures/route.ts";
import { officeZip, slideXml } from "./fixtures/knowledge/builders.ts";

function png(seed: number): Uint8Array {
	const bytes = new Uint8Array(12_000);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, 200);
	view.setUint32(20, 200);
	bytes[100] = seed;
	return bytes;
}
const rel = (target: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`;
function deck(seed: number): Uint8Array {
	return officeZip({
		"ppt/slides/slide1.xml": slideXml(["Intro", `Deck ${seed}`]),
		"ppt/slides/slide2.xml": slideXml(["Timing", "See the diagram"]),
		"ppt/slides/_rels/slide2.xml.rels": rel("../media/diagram.png"),
		"ppt/media/diagram.png": png(seed),
	});
}

let server: Server;
let mode: "ok" | "fail" = "ok";
let calls = 0;
let account: Account;
const saved = { url: process.env.VISION_BASE_URL, model: process.env.VISION_MODEL, user: process.env.LH_TEST_USER_ID };

before(async () => {
	server = createServer((request, response) => {
		calls++;
		let body = "";
		request.on("data", (chunk) => { body += chunk; });
		request.on("end", () => {
			const parsed = JSON.parse(body) as { messages: Array<{ content: Array<{ type: string }> }> };
			assert.ok(parsed.messages[0]!.content.some((part) => part.type === "image_url"), "the picture is sent to the vision model");
			if (mode === "fail") { response.writeHead(500); response.end("vision down"); return; }
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ choices: [{ message: { content: "Timing diagram: clock edge, setup window before it, hold window after it." } }] }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	process.env.VISION_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
	process.env.VISION_MODEL = "test-vision";
	delete process.env.LH_TEST_USER_ID;
	account = await createAccountStore(PATHS.data).create("pptx-vision-user", "correct horse battery staple", "en");
});
after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	for (const [key, value] of [["VISION_BASE_URL", saved.url], ["VISION_MODEL", saved.model], ["LH_TEST_USER_ID", saved.user]] as const) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
});

function upload(data: Uint8Array, destination: string | null, readImages = true) {
	const form = new FormData();
	form.set("file", new Blob([new Uint8Array(data)]), "lesson.pptx");
	if (destination) form.set("destination", destination);
	if (readImages) form.set("readImages", "true");
	return POST(new Request("http://office.test/api/knowledge/documents", {
		method: "POST",
		headers: { cookie: `lh_session=${createSessionToken(account.id, process.env.SESSION_SECRET!)}` },
		body: form,
	}));
}
const readPictures = (id: string) => PICTURES(new Request(`http://office.test/api/knowledge/documents/${id}/pictures`, {
	method: "POST",
	headers: { cookie: `lh_session=${createSessionToken(account.id, process.env.SESSION_SECRET!)}` },
}), { params: Promise.resolve({ id }) });

it("chat attachment with pictures ticked: the description reaches the chat text, marked as an image on its slide", async () => {
	mode = "ok"; calls = 0;
	const response = await upload(deck(1), "chat");
	assert.equal(response.status, 200);
	const body = await response.json() as { text: string; imageReport: unknown };
	assert.ok(body.text.includes("Slide 2 (image)\n§ Timing\nTiming diagram: clock edge"), "marked as an image, under its slide's section");
	assert.deepEqual(body.imageReport, { described: 1, failed: [], skipped: 0 });
	assert.equal(calls, 1);
});

it("pictures not ticked: no model calls and no report, even with vision available", async () => {
	mode = "ok"; calls = 0;
	const response = await upload(deck(5), "chat", false);
	const body = await response.json() as { text: string; imageReport?: unknown };
	assert.equal(calls, 0);
	assert.equal(body.imageReport, undefined);
	assert.ok(!body.text.includes("(image)"));
});

it("vision failure: the upload still succeeds with the slide text, and the report names the slide", async () => {
	mode = "fail"; calls = 0;
	const response = await upload(deck(2), "chat");
	assert.equal(response.status, 200);
	const body = await response.json() as { text: string; imageReport: { failed: unknown[] } };
	assert.match(body.text, /See the diagram/u);
	assert.ok(body.text.includes("[Pictures that could not be read: slide 2.]"), "the model is told too");
	assert.deepEqual(body.imageReport.failed, [{ kind: "slide", number: 2 }]);
});

it("saved to My Knowledge: described once; re-attaching the same deck makes no model calls", async () => {
	mode = "ok"; calls = 0;
	// One build: the zip builder stamps the current time, so two builds can differ by a second.
	const data = deck(3);
	const first = await upload(data, "personal");
	assert.equal(first.status, 200);
	assert.equal(calls, 1, "one picture, one call (no double indexing)");
	const again = await upload(data, "personal");
	const body = await again.json() as { text: string; imageReport?: unknown };
	assert.equal(calls, 1, "the stored copy is reused");
	assert.ok(body.text.includes("Slide 2 (image)\n§ Timing\nTiming diagram"), "earlier descriptions come back from the store");
	assert.equal(body.imageReport, undefined);
});

it("upgrade: a deck saved without pictures gets them read in place when re-attached with pictures ticked", async () => {
	mode = "ok"; calls = 0;
	const data = deck(6); // one build: the same bytes both times
	const first = await upload(data, "personal", false);
	const saved = await first.json() as { document: { id: string; hasPictures?: boolean; picturesRead?: boolean } };
	assert.equal(saved.document.hasPictures, true);
	assert.equal(saved.document.picturesRead, undefined);
	assert.equal(calls, 0);
	const again = await upload(data, "personal");
	const body = await again.json() as { document: { id: string; picturesRead?: boolean }; text: string; imageReport: unknown };
	assert.equal(calls, 1);
	assert.equal(body.document.id, saved.document.id, "same document, no duplicate");
	assert.equal(body.document.picturesRead, true);
	assert.ok(body.text.includes("Slide 2 (image)"));
	assert.deepEqual(body.imageReport, { described: 1, failed: [], skipped: 0 });
});

it("Knowledge page upload (no destination) also returns the report", async () => {
	mode = "fail"; calls = 0;
	const response = await upload(deck(4), null);
	const body = await response.json() as { document: { status: string }; imageReport: { failed: unknown[] } };
	assert.equal(body.document.status, "ready");
	assert.deepEqual(body.imageReport.failed, [{ kind: "slide", number: 2 }]);
});

it("Read pictures on a saved document: reads them in place; refuses files without pictures", async () => {
	mode = "ok"; calls = 0;
	const saved = await (await upload(deck(7), null, false)).json() as { document: { id: string } };
	const response = await readPictures(saved.document.id);
	assert.equal(response.status, 200);
	const body = await response.json() as { document: { id: string; picturesRead?: boolean }; imageReport: unknown };
	assert.equal(body.document.id, saved.document.id);
	assert.equal(body.document.picturesRead, true);
	assert.deepEqual(body.imageReport, { described: 1, failed: [], skipped: 0 });
	assert.equal(calls, 1);
	const form = new FormData();
	form.set("file", new Blob(["plain notes"]), "notes.txt");
	const text = await (await POST(new Request("http://office.test/api/knowledge/documents", { method: "POST", headers: { cookie: `lh_session=${createSessionToken(account.id, process.env.SESSION_SECRET!)}` }, body: form }))).json() as { document: { id: string } };
	assert.equal((await readPictures(text.document.id)).status, 409);
	assert.equal((await readPictures("f".repeat(64))).status, 404);
});
