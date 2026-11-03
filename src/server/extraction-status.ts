import {
  abortExtraction as abortRawExtraction,
  extractionStatuses as rawExtractionStatuses,
  type RunningExtraction,
  type ExtractionPhase,
} from "../agent/subagents/extraction.ts";
import { currentUserId } from "./user-scope.ts";

export type { RunningExtraction, ExtractionPhase };

export function extractionStatuses(): RunningExtraction[] {
  const ownerId = currentUserId();
  return rawExtractionStatuses().filter((run) => run.ownerId === ownerId);
}

export function abortExtraction(chatId: string): boolean {
  if (!extractionStatuses().some((run) => run.chatId === chatId)) return false;
  return abortRawExtraction(chatId, currentUserId());
}
