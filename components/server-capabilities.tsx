"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * What the server is set up for, decided once in the root layout. `webSearch`:
 * a search provider (SearXNG) is configured, so the web switch searches the web;
 * without it the tutor can only open links the user pastes.
 */
interface ServerCapabilities {
	webSearch: boolean;
	/** The configured office models' names, model 1 first (model selection, 2026-11-27). */
	models: string[];
}

const ServerCapabilitiesContext = createContext<ServerCapabilities>({ webSearch: false, models: [] });

export function ServerCapabilitiesProvider({ webSearch = false, models = [], children }: { webSearch?: boolean; models?: string[]; children: ReactNode }) {
	return <ServerCapabilitiesContext.Provider value={{ webSearch, models }}>{children}</ServerCapabilitiesContext.Provider>;
}

export function useServerCapabilities(): ServerCapabilities {
	return useContext(ServerCapabilitiesContext);
}
