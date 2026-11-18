/**
 * In-session strings that used to be hard-coded English: the active-session
 * composer placeholder, the quiz confidence label, and the tool-retry line.
 * Each must come from the locale catalog in both languages.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { Composer } from "../components/composer.tsx";
import { QuestionDock } from "../components/question-dock.tsx";
import { catalogFor } from "../src/i18n/catalog.ts";

const quizInput = {
	question: "Which planet is closest to the sun?",
	options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
	correctAnswer: "Mercury",
	explanation: "Mercury is the innermost planet.",
};

describe("in-session strings follow the UI language", () => {
	for (const language of ["en", "ja"] as const) {
		const copy = catalogFor(language);

		it(`composer default placeholder in ${language}`, () => {
			const html = renderToStaticMarkup(
				<I18nProvider language={language}>
					<Composer busy={false} value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} canSend />
				</I18nProvider>,
			);
			assert.ok(html.includes(`placeholder="${copy.composer.sessionPlaceholder}"`), copy.composer.sessionPlaceholder);
		});

		it(`quiz confidence label in ${language}`, () => {
			const html = renderToStaticMarkup(
				<I18nProvider language={language}>
					<QuestionDock toolName="quiz" toolCallId="q1" input={quizInput as never} expanded={true} onExpand={() => {}} onSubmit={() => {}} />
				</I18nProvider>,
			);
			assert.ok(html.includes(`>${copy.learning.confidenceShort}<`), copy.learning.confidenceShort);
		});
	}

	it("Japanese wording is the approved set", () => {
		const ja = catalogFor("ja");
		assert.equal(ja.composer.sessionPlaceholder, "質問・回答・指示を入力…");
		assert.equal(ja.learning.confidenceShort, "確信度");
		assert.equal(ja.chat.retryingTool, "再試行中…");
		assert.equal(catalogFor("en").chat.retryingTool, "Retrying…");
	});

	it("the tool-retry line reads from the catalog, not a literal", () => {
		const source = readFileSync(new URL("../components/chat.tsx", import.meta.url), "utf8");
		assert.ok(!/>\s*Retrying…\s*</u.test(source), "no hard-coded Retrying… in chat.tsx");
		assert.match(source, /copy\.chat\.retryingTool/u);
	});

	it("the error line and the thinking label read from the catalog (owner, 2026-11-19)", () => {
		assert.equal(catalogFor("ja").chat.errorPrefix, "エラーが発生しました：");
		assert.equal(catalogFor("en").chat.errorPrefix, "Something went wrong:");
		const source = readFileSync(new URL("../components/chat.tsx", import.meta.url), "utf8");
		assert.ok(!source.includes("Something went wrong:"), "no hard-coded English error prefix");
		assert.ok(!source.includes("THINKING…"), "no hard-coded English thinking label");
		assert.match(source, /copy\.chat\.errorPrefix/u);
	});
});
