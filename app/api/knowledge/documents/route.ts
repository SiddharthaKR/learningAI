import { withOfficeUser } from "@/src/server";
import { currentUserId } from "@/src/server";
import { checkedStoresForUser } from "@/src/server";
import { appendSharedKnowledgeAudit, indexKnowledgeDocument, sharedKnowledgeStore, usernameForUserId } from "@/src/server";
import { MAX_KNOWLEDGE_MULTIPART_BYTES, validateKnowledgeUpload } from "@/src/core";
import type { KnowledgeDocumentRecord } from "@/src/core";

export const runtime = "nodejs";

function publicDocument(document: KnowledgeDocumentRecord) {
  const { contentHash: _hash, error: _error, ...metadata } = document;
  return { ...metadata, ...(document.status === "ready" ? {} : { explanationCode: document.status === "no_text_layer" ? "no_text_layer" : "extraction_failed" }) };
}

export const GET = withOfficeUser(async () => {
  const snapshot = await checkedStoresForUser(currentUserId()).knowledgeStore.readSnapshot();
  const shared = await sharedKnowledgeStore.readSnapshot();
  return Response.json({ documents: snapshot.documents.map(publicDocument), sharedDocuments: shared.documents.map(publicDocument) });
});

export const POST = withOfficeUser(async (request: Request) => {
  try {
    // Bound the raw multipart body as it arrives, including dishonest/missing Content-Length.
    // The file's own exact 25 MiB limit is enforced again after multipart decoding.
    const bodyLimit = MAX_KNOWLEDGE_MULTIPART_BYTES;
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "invalid_upload" }, { status: 400 });
    const parts: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > bodyLimit) { await reader.cancel(); throw new Error("too_large"); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1) return Response.json({ error: "invalid_upload" }, { status: 400 });
    validateKnowledgeUpload(file.name, file.size, file.type);
    const data = new Uint8Array(await file.arrayBuffer());
    const destination = form.get("destination");
    if (destination !== null && destination !== "chat" && destination !== "personal" && destination !== "shared") {
      return Response.json({ error: "invalid_upload" }, { status: 400 });
    }
    if (destination === null) {
      const document = await checkedStoresForUser(currentUserId()).knowledgeStore.uploadDocument({ fileName: file.name, data, contentType: file.type });
      return Response.json({ document: publicDocument(document) });
    }
    const indexed = await indexKnowledgeDocument({ fileName: file.name, data });
    const text = indexed.chunks.map(({ citation, text }) => {
      if (citation.format === "pptx") return `Slide ${citation.slide}\n${text}`;
      if (citation.format === "pdf") return `Page ${citation.page}\n${text}`;
      return text;
    }).join("\n\n");
    if (!text.trim()) return Response.json({ error: "no_readable_text" }, { status: 422 });
    const store = destination === "shared" ? sharedKnowledgeStore : checkedStoresForUser(currentUserId()).knowledgeStore;
    const document = destination === "chat" ? indexed.document : await store.uploadDocument({ fileName: file.name, data, contentType: file.type });
    if (destination === "shared") {
      const userId = currentUserId();
      await appendSharedKnowledgeAudit({ at: new Date().toISOString(), userId, username: await usernameForUserId(userId), action: "add", fileName: document.fileName, documentId: document.id });
    }
    return Response.json({ document: publicDocument(document), text: text.slice(0, 24_000), truncated: text.length > 24_000 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "too_large") return Response.json({ error: code }, { status: 413 });
    if (["unsupported_format", "invalid_file_name"].includes(code)) return Response.json({ error: code }, { status: 400 });
    if (error instanceof TypeError) return Response.json({ error: "invalid_upload" }, { status: 400 });
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }
});
