import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { PictureReadingProvider } from "../components/picture-reading.tsx";
import { Composer } from "../components/composer.tsx";
import { KnowledgePage } from "../components/knowledge-page.tsx";
import { formatImageNotice, prepareAttachments } from "../components/chat-attachments.ts";
import { catalogFor } from "../src/i18n/catalog.ts";

describe("formatImageNotice", () => {
	const en = catalogFor("en");
	const ja = catalogFor("ja");
	it("is empty when every picture was read", () => {
		assert.equal(formatImageNotice([], en), undefined);
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failed: [], skipped: 0 }], en), undefined);
	});
	it("speaks each format's language: slides, pages, Word headings", () => {
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failed: [{ kind: "slide", number: 3 }], skipped: 0 }], en), "Couldn't read pictures in a.pptx (slide 3). Continuing with the text.");
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failed: [{ kind: "slide", number: 3 }, { kind: "slide", number: 7 }], skipped: 0 }], en), "Couldn't read pictures in a.pptx (slides 3, 7). Continuing with the text.");
		assert.equal(formatImageNotice([{ fileName: "r.pdf", failed: [{ kind: "page", number: 12 }], skipped: 0 }], en), "Couldn't read pictures in r.pdf (page 12). Continuing with the text.");
		assert.equal(formatImageNotice([{ fileName: "r.docx", failed: [{ kind: "paragraph", number: 3, heading: "Results" }, { kind: "paragraph", number: 9, heading: "Results" }], skipped: 0 }], en), "Couldn't read pictures in r.docx (near “Results”). Continuing with the text.");
		assert.equal(formatImageNotice([{ fileName: "r.docx", failed: [{ kind: "paragraph", number: 2 }], skipped: 0 }], en), "Couldn't read pictures in r.docx (paragraph 2). Continuing with the text.");
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failed: [{ kind: "slide", number: 3 }, { kind: "slide", number: 7 }], skipped: 0 }], ja), "a.pptx の画像を読み取れませんでした（スライド 3, 7）。テキストで続行します。");
		assert.equal(formatImageNotice([{ fileName: "r.docx", failed: [{ kind: "paragraph", number: 3, heading: "結果" }], skipped: 0 }], ja), "r.docx の画像を読み取れませんでした（「結果」 付近）。テキストで続行します。");
	});
	it("mentions pictures over the limit and joins several files", () => {
		const text = formatImageNotice([
			{ fileName: "a.pptx", failed: [{ kind: "slide", number: 2 }], skipped: 0 },
			{ fileName: "b.pptx", failed: [], skipped: 4 },
		], en)!;
		assert.ok(text.includes("a.pptx (slide 2)"));
		assert.ok(text.includes("b.pptx: only the first 30 images were read."));
	});
});

function composer(available: boolean, readImages: boolean | undefined, fileName = "deck.pptx") {
	return renderToStaticMarkup(
		<I18nProvider language="en">
			<PictureReadingProvider available={available} initialEnabled={false}>
				<Composer busy={false} value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} canSend
					documents={[{ file: new File(["x"], fileName), destination: "chat", ...(readImages === undefined ? {} : { readImages }) }]} onDocumentsChange={() => {}} />
			</PictureReadingProvider>
		</I18nProvider>,
	);
}

describe("Composer picture opt-in", () => {
	const label = catalogFor("en").composer.readPictures;
	it("shows the box only when the server can read pictures, and only for PPTX/Word/PDF", () => {
		assert.ok(!composer(false, undefined).includes(label), "no vision model: no box");
		assert.ok(composer(true, undefined).includes(label));
		assert.ok(composer(true, undefined, "notes.docx").includes(label));
		assert.ok(composer(true, undefined, "report.pdf").includes(label));
	});
	it("reflects each file's choice", () => {
		assert.ok(!/<input[^>]*type="checkbox"[^>]*checked/u.test(composer(true, undefined)));
		assert.ok(/<input[^>]*type="checkbox"[^>]*checked/u.test(composer(true, true)));
	});
	it("renders a dismissible, non-blocking note", () => {
		const html = renderToStaticMarkup(<I18nProvider language="en"><Composer busy={false} value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} canSend notice="Couldn't read pictures" onDismissNotice={() => {}} /></I18nProvider>);
		assert.ok(html.includes('role="status"') && html.includes("Couldn&#x27;t read pictures"));
		assert.ok(html.includes(`aria-label="${catalogFor("en").composer.dismissNotice}"`));
		assert.ok(!html.includes('role="alert"'), "a note, not an error");
	});
});

describe("prepareAttachments", () => {
	it("sends readImages only for files that opted in, and returns each file's problems", async () => {
		const saved = globalThis.fetch;
		const flags: Array<string | null> = [];
		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			flags.push((init!.body as FormData).get("readImages") as string | null);
			return Response.json({ text: "Slide 2\nSee the diagram", imageReport: flags.length === 1 ? { described: 0, failed: [{ kind: "slide", number: 2 }], skipped: 0 } : undefined });
		}) as typeof fetch;
		try {
			const result = await prepareAttachments("Explain", [
				{ file: new File(["x"], "with.pptx"), destination: "chat", readImages: true },
				{ file: new File(["y"], "without.pptx"), destination: "chat" },
			]);
			assert.deepEqual(flags, ["true", null]);
			assert.match(result.text, /Attached document: with\.pptx\nSlide 2\nSee the diagram/u);
			assert.deepEqual(result.imageIssues, [{ fileName: "with.pptx", failed: [{ kind: "slide", number: 2 }], skipped: 0 }]);
		} finally { globalThis.fetch = saved; }
	});
});

describe("Knowledge page picture opt-in", () => {
	async function mount(available: boolean, enabled: boolean, initialDocuments: Parameters<typeof KnowledgePage>[0]["initialDocuments"], respond: (url: string, init?: RequestInit) => Response) {
		const dom = parseHTML("<html><body><div id='host'></div></body></html>");
		const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
		Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			requests.push({ url, ...(init ? { init } : {}) });
			if (url.includes("/api/knowledge/audit")) return Response.json({ events: [] }, { status: 403 });
			return respond(url, init);
		}) as typeof fetch;
		const host = dom.document.querySelector("#host")!;
		const root = createRoot(host);
		await act(async () => { root.render(<I18nProvider language="en"><PictureReadingProvider available={available} initialEnabled={enabled}><KnowledgePage initialDocuments={initialDocuments} /></PictureReadingProvider></I18nProvider>); });
		const cleanup = async () => { await act(async () => root.unmount()); Object.assign(globalThis, saved); };
		return { dom, host, requests, cleanup };
	}
	const deckDoc = { id: "e".repeat(64), fileName: "lesson.pptx", format: "pptx" as const, status: "ready" as const, hasPictures: true };

	it("uploads with readImages when the user's choice is on, and shows which slides failed", async () => {
		const page = await mount(true, true, [], (_url, init) => init?.method === "POST"
			? Response.json({ document: { ...deckDoc, picturesRead: true }, imageReport: { described: 1, failed: [{ kind: "slide", number: 4 }], skipped: 0 } })
			: Response.json({}));
		try {
			const input = page.host.querySelector('input[type="file"]')!;
			Object.defineProperty(input, "files", { configurable: true, get: () => [new File(["deck"], "lesson.pptx")] });
			await act(async () => { input.dispatchEvent(new page.dom.window.Event("change", { bubbles: true })); });
			const upload = page.requests.find((r) => r.init?.method === "POST")!;
			assert.equal((upload.init!.body as FormData).get("readImages"), "true");
			assert.equal(page.host.querySelector('[data-testid="image-notice"]')?.textContent?.includes("lesson.pptx (slide 4)"), true);
		} finally { await page.cleanup(); }
	});

	it("'Read pictures' appears only on text-only saved files, and updates the row", async () => {
		const page = await mount(true, false, [deckDoc, { id: "f".repeat(64), fileName: "notes.md", format: "md", status: "ready" }], (url) => url.endsWith("/pictures")
			? Response.json({ document: { ...deckDoc, picturesRead: true }, imageReport: { described: 2, failed: [], skipped: 0 } })
			: Response.json({}));
		try {
			const buttons = () => [...page.host.querySelectorAll("button")].filter((b) => b.textContent === "Read pictures");
			assert.equal(buttons().length, 1, "only the deck with pictures");
			await act(async () => { (buttons()[0] as unknown as HTMLButtonElement).click(); });
			assert.ok(page.requests.some((r) => r.url === `/api/knowledge/documents/${"e".repeat(64)}/pictures` && r.init?.method === "POST"));
			assert.equal(buttons().length, 0, "now read");
			assert.ok(page.host.textContent?.includes("Pictures read"));
		} finally { await page.cleanup(); }
	});

	it("hides all picture controls when the server cannot read pictures", async () => {
		const page = await mount(false, true, [deckDoc], () => Response.json({}));
		try {
			assert.ok(!page.host.textContent?.includes("Read pictures"));
		} finally { await page.cleanup(); }
	});
});
