import type { KnowledgeFormat } from "./contracts.ts";

export const MAX_KNOWLEDGE_UPLOAD_BYTES = 26_214_400;
export const MAX_KNOWLEDGE_MULTIPART_BYTES = MAX_KNOWLEDGE_UPLOAD_BYTES + 65_536;
const mimeTypes: Record<KnowledgeFormat, string[]> = {
  pdf: ["application/pdf"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  md: ["text/markdown", "text/plain"],
  txt: ["text/plain"],
};

export function validateKnowledgeUpload(fileName: string, byteLength: number, contentType = ""): KnowledgeFormat {
  if (byteLength > MAX_KNOWLEDGE_UPLOAD_BYTES) throw new Error("too_large");
  // Metadata must meet the existing citation contract; it never constructs a source path.
  if (!fileName || /[\\/\u0000]/u.test(fileName) || /^[A-Za-z]:/u.test(fileName) || fileName === "." || fileName === "..") throw new Error("invalid_file_name");
  const format = fileName.split(".").at(-1)?.toLowerCase() as KnowledgeFormat;
  if (!fileName.includes(".") || !Object.hasOwn(mimeTypes, format)) throw new Error("unsupported_format");
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime && mime !== "application/octet-stream" && !mimeTypes[format].includes(mime)) throw new Error("unsupported_format");
  return format;
}
