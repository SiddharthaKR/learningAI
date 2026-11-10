import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { sourceArchiveResponse } from "../src/server/source-archive.ts";

it("serves the archive file as a gzip download", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "src-")), "source.tar.gz");
  writeFileSync(file, "ARCHIVE-BYTES");
  const res = await sourceArchiveResponse(file);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/gzip");
  assert.match(res.headers.get("content-disposition")!, /learnharness-source\.tar\.gz/);
  assert.equal(await res.text(), "ARCHIVE-BYTES");
});

it("returns 404 with a hint when the archive has not been built", async () => {
  const res = await sourceArchiveResponse(path.join(os.tmpdir(), "does-not-exist-source.tar.gz"));
  assert.equal(res.status, 404);
  assert.match(await res.text(), /build:source/);
});
