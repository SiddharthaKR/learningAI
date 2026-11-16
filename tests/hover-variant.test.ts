import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

it("hover: applies whenever the pointer is over an element, not only on (hover: hover) devices", () => {
	// Tailwind v4 wraps hover: in @media (hover: hover); some touch laptops and
	// remote-desktop sessions report no hover, which removed every hover effect.
	assert.match(css, /@custom-variant hover \(&:hover\);/u);
});

it("the dark-theme hover/selection tint is visible against the dark background", () => {
	const darkAccents = [...css.matchAll(/--accent:\s*(#[0-9a-f]{6});/giu)].map((m) => m[1]!.toLowerCase()).slice(1);
	assert.equal(darkAccents.length, 2, "both dark blocks define --accent");
	for (const accent of darkAccents) assert.equal(accent, "#2a2a4f");
});
