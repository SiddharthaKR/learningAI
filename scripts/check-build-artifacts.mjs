import fs from "node:fs";
import path from "node:path";

const buildRoot = path.resolve(".next");
const forbiddenDirs = new Set(["data", "knowledge", "index", "indexes"]);
const routeTree = path.join("server", "app");
const violations = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    const relative = path.relative(buildRoot, file);
    if (entry.isDirectory()) {
      const inRouteTree = relative.startsWith(routeTree + path.sep) || relative === routeTree;
      if (!inRouteTree && forbiddenDirs.has(entry.name.toLowerCase())) violations.push(relative);
      walk(file);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
      violations.push(relative);
    }
  }
}

walk(buildRoot);
if (violations.length) {
  console.error("Build output includes user data or index files:");
  for (const file of violations) console.error(`  ${file}`);
  process.exitCode = 1;
} else {
  console.log("Build artifact check passed: no data/, knowledge/, index/ or JSONL files in .next.");
}
