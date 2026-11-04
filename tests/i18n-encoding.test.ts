import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_ROOTS = ["src", "app", "components", "locales", "prompts"];
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".txt"]);
const MOJIBAKE = /\u00e3|\u00e2\u20ac|\u00c3|\uFFFD/u;

function textFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root).map((entry) => path.join(root, entry));
  return entries.flatMap((entry) => statSync(entry).isDirectory()
    ? textFiles(entry)
    : TEXT_EXTENSIONS.has(path.extname(entry)) ? [entry] : []);
}

describe("UTF-8 source and locale integrity", () => {
  it("contains no common mojibake or replacement characters", () => {
    const failures = SCAN_ROOTS
      .flatMap((root) => textFiles(path.join(ROOT, root)))
      .filter((file) => MOJIBAKE.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    assert.deepEqual(failures, []);
  });

  it("round-trips a known Japanese catalog string unchanged", () => {
    const file = path.join(ROOT, "locales", "ja.json");
    const bytes = readFileSync(file);
    const decoded = bytes.toString("utf8");
    const catalog = JSON.parse(decoded) as { preferences: { title: string } };
    assert.equal(catalog.preferences.title, "設定");
    assert.equal(Buffer.from(decoded, "utf8").toString("utf8"), decoded);
  });

  it("keeps the English and Japanese catalog key sets identical", () => {
    const flatten = (value: unknown, prefix = ""): string[] => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
      return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
    };
    const read = (language: "en" | "ja") => JSON.parse(readFileSync(path.join(ROOT, "locales", `${language}.json`), "utf8")) as unknown;
    assert.deepEqual(flatten(read("ja")).sort(), flatten(read("en")).sort());
  });

  it("serves authentication copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as { auth?: { loginTitle?: string } };
    assert.equal(catalog.auth?.loginTitle, "ログイン");
  });

  it("serves navigation copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as { sidebar?: { sessions?: string } };
    assert.equal(catalog.sidebar?.sessions, "セッション");
  });

  it("serves active-session chrome from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as { chat?: { teachingLanguage?: string } };
    assert.equal(catalog.chat?.teachingLanguage, "授業言語");
  });

  it("serves web approval copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as { webApproval?: { title?: string } };
    assert.equal(catalog.webApproval?.title, "ウェブアクセスの確認");
  });

  it("serves learning interaction copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as {
      learning?: { checkUnderstanding?: string };
    };
    assert.equal(catalog.learning?.checkUnderstanding, "理解度を確認");
  });

  it("serves dialog and overlay copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as {
      dialogs?: { deleteSession?: string };
    };
    assert.equal(catalog.dialogs?.deleteSession, "セッションを削除しますか？");
  });

  it("serves settings copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as {
      settingsUi?: { title?: string };
    };
    assert.equal(catalog.settingsUi?.title, "設定");
  });

  it("serves plan and activity copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as {
      planUi?: { title?: string };
      activityUi?: { backgroundAgents?: string };
    };
    assert.equal(catalog.planUi?.title, "学習計画");
    assert.equal(catalog.activityUi?.backgroundAgents, "バックグラウンド処理");
  });

  it("serves graph copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as {
      graphUi?: { title?: string };
    };
    assert.equal(catalog.graphUi?.title, "ナレッジグラフ");
  });

  it("serves artifact and markdown copy from the Japanese catalog", () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "locales", "ja.json"), "utf8")) as {
      artifactUi?: { figure?: string };
      markdownUi?: { retry?: string };
    };
    assert.equal(catalog.artifactUi?.figure, "図");
    assert.equal(catalog.markdownUi?.retry, "再試行");
  });
});
