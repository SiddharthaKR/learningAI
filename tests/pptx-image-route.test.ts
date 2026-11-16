import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PATHS } from "../config.ts";
import { createAccountStore, type Account } from "../src/server/accounts.ts";
import { createSessionToken } from "../src/server/session-auth.ts";
import { POST } from "../app/api/knowledge/documents/route.ts";
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

function upload(data: Uint8Array, destination: string | null) {
	const form = new FormData();
	form.set("file", new Blob([new Uint8Array(data)]), "lesson.pptx");
	if (destination) form.set("destination", destination);
	return POST(new Request("http://office.test/api/knowledge/documents", {
		method: "POST",
		headers: { cookie: `lh_session=${createSessionToken(account.id, process.env.SESSION_SECRET!)}` },
		body: form,
	}));
}

it("chat attachment: the picture's description reaches the chat text, marked as an image on its slide", async () => {
	mode = "ok"; calls = 0;
	const response = await upload(deck(1), "chat");
	assert.equal(response.status, 200);
	const body = await response.json() as { text: string; imageReport: { described: number; failedSlides: number[] } };
	assert.match(body.text, /Slide 2 \(image\)\n§ Timing\nTiming diagram: clock edge/u, "marked as an image, under its slide's section");
	assert.deepEqual(body.imageReport, { described: 1, failedSlides: [], skipped: 0 });
	assert.equal(calls, 1);
});

it("vision failure: the upload still succeeds with the slide text, and the report names the slide", async () => {
	mode = "fail"; calls = 0;
	const response = await upload(deck(2), "chat");
	assert.equal(response.status, 200);
	const body = await response.json() as { text: string; imageReport: { failedSlides: number[] } };
	assert.match(body.text, /See the diagram/u);
	assert.match(body.text, /\[The image on slide 2 could not be read\.\]/u, "the model is told too");
	assert.deepEqual(body.imageReport.failedSlides, [2]);
});

it("saved to My Knowledge: described once; re-attaching the same deck makes no model calls", async () => {
	mode = "ok"; calls = 0;
	const first = await upload(deck(3), "personal");
	assert.equal(first.status, 200);
	assert.equal(calls, 1, "one picture, one call (no double indexing)");
	const again = await upload(deck(3), "personal");
	const body = await again.json() as { text: string; imageReport?: unknown };
	assert.equal(calls, 1, "the stored copy is reused");
	assert.match(body.text, /Slide 2 \(image\)\n§ Timing\nTiming diagram/u, "earlier descriptions come back from the store");
	assert.equal(body.imageReport, undefined);
});

it("Knowledge page upload (no destination) also returns the report", async () => {
	mode = "fail"; calls = 0;
	const response = await upload(deck(4), null);
	const body = await response.json() as { document: { status: string }; imageReport: { failedSlides: number[] } };
	assert.equal(body.document.status, "ready");
	assert.deepEqual(body.imageReport.failedSlides, [2]);
});
