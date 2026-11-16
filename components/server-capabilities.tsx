"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * What the server is set up for, decided once in the root layout. `webSearch`:
 * a search provider (SearXNG) is configured, so the web switch searches the web;
 * without it the tutor can only open links the user pastes.
 */
interface ServerCapabilities {
	webSearch: boolean;
}

const ServerCapabilitiesContext = createContext<ServerCapabilities>({ webSearch: false });

export function ServerCapabilitiesProvider({ webSearch = false, children }: { webSearch?: boolean; children: ReactNode }) {
	return <ServerCapabilitiesContext.Provider value={{ webSearch }}>{children}</ServerCapabilitiesContext.Provider>;
}

export function useServerCapabilities(): ServerCapabilities {
	return useContext(ServerCapabilitiesContext);
}
