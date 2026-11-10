"use client";

import { createContext, useContext, type ReactNode } from "react";
import { catalogFor, type LocaleCatalog, type UiLanguage } from "@/src/core";

const I18nContext = createContext<LocaleCatalog>(catalogFor("en"));

export function I18nProvider({ language, children }: { language: UiLanguage; children: ReactNode }) {
  return <I18nContext value={catalogFor(language)}>{children}</I18nContext>;
}

export function useI18n(): LocaleCatalog {
  return useContext(I18nContext);
}
