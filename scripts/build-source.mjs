import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

// Tracked files only: .env, data/, knowledge files and indexes are untracked/gitignored.
mkdirSync("dist", { recursive: true });
execFileSync("git", ["archive", "--format=tar.gz", "--prefix=learnharness/", "-o", "dist/source.tar.gz", "HEAD"], { stdio: "inherit" });
console.log("Wrote dist/source.tar.gz");
