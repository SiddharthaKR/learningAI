"use client";
import { useSyncExternalStore } from "react";

/**
 * Is the page dark right now — and re-render when it changes (owner,
 * 2026-11-19: light mode). Watches <html class="dark">, which the pre-paint
 * script and AppearanceProvider set. Diagrams use it to redraw in the
 * matching theme when the mode switches. Dark on the server (SSR).
 */
function subscribe(onChange: () => void): () => void {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
	return () => observer.disconnect();
}

export function usePageDark(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => document.documentElement.classList.contains("dark"),
		() => true,
	);
}
