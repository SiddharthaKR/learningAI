import type { ChatRecord } from "../core/contracts/chat.ts";

export function webNeedsApproval(chat: Pick<ChatRecord, "settings" | "knowledgeUsed">): boolean {
  return chat.settings?.webResearchEnabled === true &&
    (chat.settings.officeKnowledgeEnabled === true || chat.knowledgeUsed === true);
}
