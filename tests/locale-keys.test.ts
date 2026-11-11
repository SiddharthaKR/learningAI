import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Tree = { [key: string]: Tree | string };

function load(name: string): Tree {
  return JSON.parse(readFileSync(new URL(`../locales/${name}.json`, import.meta.url), "utf8")) as Tree;
}

function paths(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [prefix + key] : paths(value, `${prefix}${key}.`),
  );
}

const en = load("en") as any;
const ja = load("ja");

test("en and ja have identical key sets", () => {
  assert.deepEqual(paths(ja).sort(), paths(en).sort());
});

test("helper copy strings", () => {
  assert.equal(en.settingsUi.subtitle, "Models, keys and app options.");
  assert.equal(en.preferences.subtitle, "How the tutor teaches you and how the app looks.");
  assert.equal(
    en.newSession.description,
    "Tell the tutor what you want to learn. It will teach, quiz you, and remember your progress.",
  );
});
