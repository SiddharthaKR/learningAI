import en from "../../locales/en.json";
import ja from "../../locales/ja.json";

export type UiLanguage = "en" | "ja";
export type LocaleCatalog = typeof en;

const catalogs: Record<UiLanguage, LocaleCatalog> = { en, ja };

export function catalogFor(language: UiLanguage): LocaleCatalog {
  return catalogs[language] ?? catalogs.en;
}

export function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}
