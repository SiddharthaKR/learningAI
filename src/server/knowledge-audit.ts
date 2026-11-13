import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { createAccountStore } from "./accounts.ts";

/** One line of the shared-knowledge audit log (data/shared/knowledge/audit.jsonl). */
export interface SharedKnowledgeAuditEvent {
  at: string;
  userId: string;
  username: string;
  action: "add" | "delete";
  fileName: string;
  documentId: string;
}

/** Same root the shared knowledge store uses (data/shared), under its knowledge/ directory. */
function auditFile(): string {
  return path.join(PATHS.data, "shared", "knowledge", "audit.jsonl");
}

/** Appends one event. Failures are logged and swallowed so the upload/delete itself never fails. */
export async function appendSharedKnowledgeAudit(event: SharedKnowledgeAuditEvent): Promise<void> {
  try {
    const file = auditFile();
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    console.error("Failed to append shared knowledge audit event", error);
  }
}

/** Returns all events, newest first. A missing file yields []; malformed lines are skipped. */
export async function readSharedKnowledgeAudit(): Promise<SharedKnowledgeAuditEvent[]> {
  let text: string;
  try {
    text = await readFile(auditFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: SharedKnowledgeAuditEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) events.push(parsed as SharedKnowledgeAuditEvent);
    } catch {
      // Skip malformed lines.
    }
  }
  return events.reverse();
}

/** Resolves a user id to its username, falling back to the id when the account is not found. */
export async function usernameForUserId(userId: string): Promise<string> {
  const account = await createAccountStore(PATHS.data).byId(userId);
  return account?.username ?? userId;
}

/** True iff the account's username exactly equals LH_ADMIN_USERNAME (trimmed). Unset or empty means no admin. */
export async function isAdminUser(userId: string): Promise<boolean> {
  const adminUsername = (process.env.LH_ADMIN_USERNAME ?? "").trim();
  if (!adminUsername) return false;
  const account = await createAccountStore(PATHS.data).byId(userId);
  return account !== null && account.username === adminUsername;
}
