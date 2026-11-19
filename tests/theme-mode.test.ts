/**
 * Appearance Mode: System / Light / Dark (owner, 2026-11-19). Saved on the
 * account; System (the default) follows the computer, which is what the app
 * did before this setting existed. The custom background colour is a dark
 * curve, so it applies in dark mode only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FACTORY_SETTINGS } from "../src/core/settings.ts";
import { parseAppearanceSettingsBody } from "../src/server/settings-body.ts";
import { appearanceVars, effectiveDark, resolveAppearance, themeStorageValue } from "../components/settings/appearance.tsx";

describe("the mode setting", () => {
	it("defaults to System — today's behaviour, nobody's screen changes", () => {
		assert.equal(FACTORY_SETTINGS.appearance.mode, "system");
		assert.equal(resolveAppearance(undefined).mode, "system");
	});

	it("accepts system, light and dark; rejects anything else", () => {
		for (const mode of ["system", "light", "dark"] as const) {
			const parsed = parseAppearanceSettingsBody({ mode });
			assert.equal(parsed.ok, true, mode);
			assert.equal(parsed.ok && parsed.settings.mode, mode);
		}
		assert.equal(parseAppearanceSettingsBody({ mode: "blue" }).ok, false);
	});
});

describe("effectiveDark", () => {
	it("System follows the computer; Light and Dark ignore it", () => {
		assert.equal(effectiveDark("system", true), true);
		assert.equal(effectiveDark("system", false), false);
		assert.equal(effectiveDark("light", true), false);
		assert.equal(effectiveDark("dark", false), true);
	});
});

describe("themeStorageValue (what the pre-paint script reads next load)", () => {
	it("light and dark are stored; System clears it so the computer decides", () => {
		assert.equal(themeStorageValue("light"), "light");
		assert.equal(themeStorageValue("dark"), "dark");
		assert.equal(themeStorageValue("system"), null);
	});
});

describe("appearanceVars and the custom background", () => {
	const custom = resolveAppearance({ background: "#202030" });
	it("dark: the custom background and its derived surfaces apply", () => {
		const vars = appearanceVars(custom, true);
		assert.equal(vars["--background"], "#202030");
		assert.ok(vars["--card"]);
	});

	it("light: the dark-curve background is not applied (the light palette stays)", () => {
		const vars = appearanceVars(custom, false);
		assert.equal(vars["--background"], undefined);
		assert.equal(vars["--card"], undefined);
		assert.ok(vars["--lh-prose-size"], "the other appearance settings still apply");
	});
});
