"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Picture reading (describing pictures in PPTX/Word/PDF uploads) is opt-in per upload.
 * `available`: the server has a vision model. `enabled`: this user's remembered choice,
 * stored on their account; changing it saves it so it follows them to any device.
 */
interface PictureReading {
	available: boolean;
	enabled: boolean;
	setEnabled: (enabled: boolean) => void;
}

const PictureReadingContext = createContext<PictureReading>({ available: false, enabled: false, setEnabled: () => {} });

export function PictureReadingProvider({ available, initialEnabled, children }: { available: boolean; initialEnabled: boolean; children: ReactNode }) {
	const [enabled, setState] = useState(initialEnabled);
	const setEnabled = useCallback((next: boolean) => {
		setState(next);
		// Best-effort: the choice still applies to this upload if saving fails.
		void fetch("/api/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ readPictures: next }) }).catch(() => {});
	}, []);
	const value = useMemo(() => ({ available, enabled, setEnabled }), [available, enabled, setEnabled]);
	return <PictureReadingContext.Provider value={value}>{children}</PictureReadingContext.Provider>;
}

export function usePictureReading(): PictureReading {
	return useContext(PictureReadingContext);
}

/** File types whose pictures can be read. */
export function picturesReadable(fileName: string): boolean {
	return /\.(pptx|docx|pdf)$/iu.test(fileName);
}
