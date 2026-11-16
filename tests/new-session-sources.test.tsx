/**
 * Web and knowledge switches on the new-session screen: both start off, and
 * whatever the user ticks is saved to the session before its first reply runs.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { StatsBar } from "../components/stats-bar.tsx";
import { DraftShell, applyDraftSources, DRAFT_SOURCES_OFF } from "../components/new-session.tsx";
import { ServerCapabilitiesProvider } from "../components/server-capabilities.tsx";
import { catalogFor } from "../src/i18n/catalog.ts";

const copy = catalogFor("en").activityUi;
const checked = (html: string) => (html.match(/<input[^>]*type="checkbox"[^>]*checked=""/gu) ?? []).length;

describe("new-session switches", () => {
	it("start off: both boxes shown, neither ticked", () => {
		assert.deepEqual(DRAFT_SOURCES_OFF, { webResearchEnabled: false, officeKnowledgeEnabled: false, knowledgeScope: "all" });
		const html = renderToStaticMarkup(<I18nProvider language="en"><DraftShell busy={false} text="" onChange={() => {}} onSend={() => {}} sources={DRAFT_SOURCES_OFF} onSourcesChange={() => {}} /></I18nProvider>);
		assert.ok(html.includes('data-testid="session-source-controls"'));
		assert.ok(html.includes(copy.readLinkedPages) && html.includes(copy.officeKnowledge));
		assert.equal(checked(html), 0);
	});

	it("reflect what the user ticked, and show the knowledge scope once knowledge is on", () => {
		const html = renderToStaticMarkup(<StatsBar turns={[]} draftSources={{ settings: { webResearchEnabled: false, officeKnowledgeEnabled: true, knowledgeScope: "shared" }, onChange: () => {} }} />);
		assert.equal(checked(html), 1);
		assert.ok(html.includes(copy.knowledgeScope), "scope picker appears with knowledge on");
	});

	it("are not shown on a running session's draft path without a handler (old behaviour unchanged)", () => {
		const html = renderToStaticMarkup(<StatsBar turns={[]} />);
		assert.ok(!html.includes('data-testid="session-source-controls"'));
	});
});

describe("web switch label follows the server's search setup", () => {
	const draft = { settings: DRAFT_SOURCES_OFF, onChange: () => {} };
	it("says 'Enable web search' when web search is set up", () => {
		const en = renderToStaticMarkup(<I18nProvider language="en"><ServerCapabilitiesProvider webSearch><StatsBar turns={[]} draftSources={draft} /></ServerCapabilitiesProvider></I18nProvider>);
		assert.ok(en.includes("Enable web search") && !en.includes(copy.readLinkedPages));
		const ja = renderToStaticMarkup(<I18nProvider language="ja"><ServerCapabilitiesProvider webSearch><StatsBar turns={[]} draftSources={draft} /></ServerCapabilitiesProvider></I18nProvider>);
		assert.ok(ja.includes("ウェブ検索を有効にする"));
	});
	it("keeps 'Read linked pages' when only pasted links can be opened", () => {
		const html = renderToStaticMarkup(<I18nProvider language="en"><ServerCapabilitiesProvider webSearch={false}><StatsBar turns={[]} draftSources={draft} /></ServerCapabilitiesProvider></I18nProvider>);
		assert.ok(html.includes(copy.readLinkedPages) && !html.includes("Enable web search"));
	});
});

describe("applyDraftSources", () => {
	function recorder(ok = true) {
		const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
		const fetchLike = (async (url: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(url), ...(init?.method ? { method: init.method } : {}), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
			return ok ? Response.json({ settings: {} }) : Response.json({ error: "nope" }, { status: 500 });
		}) as typeof fetch;
		return { calls, fetchLike };
	}

	it("does nothing when both are off (no extra request on the common path)", async () => {
		const { calls, fetchLike } = recorder();
		await applyDraftSources("chat_1", DRAFT_SOURCES_OFF, fetchLike);
		assert.equal(calls.length, 0);
	});

	it("saves the ticked switches to the new session", async () => {
		const { calls, fetchLike } = recorder();
		await applyDraftSources("chat_1", { webResearchEnabled: true, officeKnowledgeEnabled: true, knowledgeScope: "shared" }, fetchLike);
		assert.deepEqual(calls, [{ url: "/api/chats/chat_1/settings", method: "PUT", body: { webResearchEnabled: true, officeKnowledgeEnabled: true, knowledgeScope: "shared" } }]);
	});

	it("fails loudly so the first reply never silently runs without them", async () => {
		const { fetchLike } = recorder(false);
		await assert.rejects(applyDraftSources("chat_1", { ...DRAFT_SOURCES_OFF, webResearchEnabled: true }, fetchLike));
	});
});
