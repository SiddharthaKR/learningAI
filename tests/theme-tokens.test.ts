import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
const mediaBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("\n.dark {"));
const darkBlock = css.slice(css.indexOf("\n.dark {"), css.indexOf("/* CMU Serif"));

describe("indigo theme tokens", () => {
	it("light :root is indigo", () => {
		assert.equal(rootBlock.split("--primary: #4f46e5;").length - 1, 1);
		assert.match(rootBlock, /--radius: 10px;/);
	});
	it("both dark paths are indigo", () => {
		assert.match(mediaBlock, /--primary: #818cf8;/);
		assert.match(darkBlock, /--primary: #818cf8;/);
	});
	it("UI font chains Inter first", () => {
		const line = css.split("\n").find((l) => l.includes("--font-ui:")) ?? "";
		assert.ok(line.includes("var(--font-inter)"));
	});
	it("soft focus ring exists", () => {
		assert.match(css, /:focus-visible/);
		assert.ok(css.includes("box-shadow: 0 0 0 3px var(--ring)"));
	});
});
