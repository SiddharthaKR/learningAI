import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const files = ["chats", "jobs", "graph", "settings"];

it("constructs personal stores only through storesForUser", () => {
  const composition = fs.readFileSync(path.join(root, "src/server/stores.ts"), "utf8");
  assert.match(composition, /path\.join\(PATHS\.data, "users", userId\)/u);
  for (const name of files) {
    const source = fs.readFileSync(path.join(root, `src/store/${name}.ts`), "utf8");
    assert.doesNotMatch(source, /create(?:Chat|Job|Graph|Settings)Store\(PATHS\.data/u);
  }
  for (const dir of ["app", "src/server", "src/agent"]) {
    const walk = (base: string): string[] => fs.readdirSync(base, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(base, entry.name)) : /\.tsx?$/u.test(entry.name) ? [path.join(base, entry.name)] : []);
    for (const file of walk(path.join(root, dir))) {
      if (file.endsWith(path.join("src", "server", "stores.ts"))) continue;
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /create(?:Chat|Job|Graph|Settings)Store\(/u, file);
      assert.doesNotMatch(source, /from ["'][^"']*\/store\/(?:chats|jobs|graph|settings)\.ts["']/u, file);
    }
  }
});
