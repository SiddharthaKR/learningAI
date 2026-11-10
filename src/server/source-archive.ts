import { readFile } from "node:fs/promises";
import path from "node:path";

/** Where `npm run build:source` writes the archive. */
export const SOURCE_ARCHIVE_PATH = path.resolve("dist", "source.tar.gz");

/** AGPL source download: serves the prebuilt `git archive` (tracked files only). */
export async function sourceArchiveResponse(file: string = SOURCE_ARCHIVE_PATH): Promise<Response> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return new Response("Source archive not built. Run `npm run build:source` on the host.", { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": 'attachment; filename="learnharness-source.tar.gz"',
      "content-length": String(bytes.length),
    },
  });
}
