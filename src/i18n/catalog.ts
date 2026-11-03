import en from "../../locales/en.json";
import ja from "../../locales/ja.json";
import type { KeyAction } from "@/src/core";

export type UiLanguage = "en" | "ja";
export type LocaleCatalog = typeof en;

const catalogs: Record<UiLanguage, LocaleCatalog> = { en, ja };

export function catalogFor(language: UiLanguage): LocaleCatalog {
  return catalogs[language] ?? catalogs.en;
}

export function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export function keyboardActionLabel(catalog: LocaleCatalog, action: KeyAction): string {
  const copy = catalog.settingsUi;
  const labels: Record<KeyAction, string> = {
    "toggle-dictation": copy.actionToggleDictation,
    "open-settings": copy.actionOpenSettings,
    "open-model-picker": copy.actionModelSelector,
    "cycle-thinking": copy.actionCycleThinking,
    "toggle-sidebar": copy.actionToggleSidebar,
    "sessions-search": copy.actionSearchSessions,
    "jump-graph": copy.actionGraphView,
    "new-session": copy.actionNewSession,
    "rename-session": copy.actionRenameSession,
    "toggle-user-thinking": copy.actionToggleThinking,
    find: copy.actionFind,
    "cheat-sheet": copy.actionCheatSheet,
    "question-focus": copy.actionQuestionFocus,
    "question-next-row": copy.actionQuestionNext,
    "question-prev-row": copy.actionQuestionPrevious,
    "question-pick-row": copy.actionQuestionPick,
    "question-submit": copy.actionQuestionSubmit,
  };
  return labels[action];
}
