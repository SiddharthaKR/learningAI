import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { Composer } from "../components/composer.tsx";
import { KnowledgePage } from "../components/knowledge-page.tsx";
import { formatImageNotice, prepareAttachments } from "../components/chat-attachments.ts";
import { catalogFor } from "../src/i18n/catalog.ts";

describe("formatImageNotice", () => {
	it("is empty when every picture was read", () => {
		assert.equal(formatImageNotice([], catalogFor("en")), undefined);
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failedSlides: [], skipped: 0 }], catalogFor("en")), undefined);
	});
	it("names the file and slides, one or many, in English and Japanese", () => {
		const en = catalogFor("en");
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failedSlides: [3], skipped: 0 }], en), "Couldn't read the image on slide 3 of a.pptx. Continuing with the slide text.");
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failedSlides: [3, 7], skipped: 0 }], en), "Couldn't read the images on slides 3, 7 of a.pptx. Continuing with the slide text.");
		const ja = catalogFor("ja");
		assert.equal(formatImageNotice([{ fileName: "a.pptx", failedSlides: [3, 7], skipped: 0 }], ja), "a.pptx のスライド 3, 7 の画像を読み取れませんでした。スライドのテキストで続行します。");
	});
	it("mentions pictures over the limit and joins several files", () => {
		const text = formatImageNotice([
			{ fileName: "a.pptx", failedSlides: [2], skipped: 0 },
			{ fileName: "b.pptx", failedSlides: [], skipped: 4 },
		], catalogFor("en"))!;
		assert.ok(text.includes("slide 2 of a.pptx"));
		assert.ok(text.includes("b.pptx: only the first 30 images were read."));
	});
});

describe("Composer notice", () => {
	for (const language of ["en", "ja"] as const) {
		it(`renders a dismissible, non-blocking note in ${language}`, () => {
			const copy = catalogFor(language).composer;
			const html = renderToStaticMarkup(
				<I18nProvider language={language}>
					<Composer busy={false} value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} canSend notice="Couldn't read images" onDismissNotice={() => {}} />
				</I18nProvider>,
			);
			assert.ok(html.includes('role="status"') && html.includes("Couldn&#x27;t read images"));
			assert.ok(html.includes(`aria-label="${copy.dismissNotice}"`));
			assert.ok(!html.includes('role="alert"'), "a note, not an error");
		});
	}
});

describe("prepareAttachments", () => {
	it("returns the chat text and each file's picture problems", async () => {
		const saved = globalThis.fetch;
		globalThis.fetch = (async () => Response.json({ text: "Slide 2\nSee the diagram", imageReport: { described: 0, failedSlides: [2], skipped: 0 } })) as typeof fetch;
		try {
			const result = await prepareAttachments("Explain", [{ file: new File(["x"], "lesson.pptx"), destination: "chat" }]);
			assert.match(result.text, /Attached document: lesson\.pptx\nSlide 2\nSee the diagram/u);
			assert.deepEqual(result.imageIssues, [{ fileName: "lesson.pptx", failedSlides: [2], skipped: 0 }]);
		} finally { globalThis.fetch = saved; }
	});
});

describe("Knowledge page notice", () => {
	it("shows which slides' pictures failed after an upload, and can be dismissed", async () => {
		const dom = parseHTML("<html><body><div id='host'></div></body></html>");
		const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
		Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes("/api/knowledge/audit")) return Response.json({ events: [] }, { status: 403 });
			if (init?.method === "POST") return Response.json({ document: { id: "e".repeat(64), fileName: "lesson.pptx", format: "pptx", status: "ready" }, imageReport: { described: 1, failedSlides: [4], skipped: 0 } });
			return Response.json({});
		}) as typeof fetch;
		const host = dom.document.querySelector("#host")!;
		const root = createRoot(host);
		try {
			await act(async () => { root.render(<I18nProvider language="en"><KnowledgePage initialDocuments={[]} /></I18nProvider>); });
			const input = host.querySelector('input[type="file"]')!;
			const file = new File(["deck"], "lesson.pptx");
			Object.defineProperty(input, "files", { configurable: true, get: () => [file] });
			await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
			const note = host.querySelector('[data-testid="image-notice"]');
			assert.equal(note?.textContent?.includes("Couldn't read the image on slide 4 of lesson.pptx."), true);
			await act(async () => { (note!.querySelector("button") as unknown as HTMLButtonElement).click(); });
			assert.equal(host.querySelector('[data-testid="image-notice"]'), null);
		} finally {
			await act(async () => root.unmount());
			Object.assign(globalThis, saved);
		}
	});
});
