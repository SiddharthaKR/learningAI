import type { LhMessage } from "../core/native-messages.ts";

/** Extract only URLs actually typed in user messages. Tool output and documents do not count. */
export function userMessageUrls(messages: readonly LhMessage[]): Set<string> {
  const urls = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type !== "text") continue;
      for (const match of part.text.matchAll(/https?:\/\/[^\s<>"']+/gu)) {
        const url = match[0].replace(/[.,!?;:)\]}]+$/u, "");
        if (url) urls.add(url);
      }
    }
  }
  return urls;
}
