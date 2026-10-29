"use client";

/** Office deployment has no browser microphone or transcription transport. */
export type DictationPhase = "idle";
export type Dictation = {
 phase: DictationPhase;
 error: string | null;
 levelRef: { current: number };
 active: boolean;
 toggle: () => void;
 stop: () => void;
 finish: () => Promise<void>;
 cancel: () => void;
 clearError: () => void;
};
const noop = () => {};
const finish = () => Promise.resolve();
export function isDictationActive(): boolean { return false; }
export function finishDictation(): Promise<void> { return finish(); }
export function joinDictation(current: string, final: string): string {
 return [current.trimEnd(), final.trim()].filter(Boolean).join(" ");
}
export function useDictationTarget(_append: (text: string) => void, _claimed: boolean): void {}
export function useDictation(_options: { append: (text: string) => void }): Dictation {
 return { phase: "idle", error: null, levelRef: { current: 0 }, active: false, toggle: noop, stop: noop, finish, cancel: noop, clearError: noop };
}
export function DictationBar(_props: { dictation: Dictation }): null { return null; }

/** Retained pure cache contract for existing tests; no mint is invoked by office UI. */
export const DICTATION_KEYLESS = "Dictation needs a Deepgram key";
export const DEEPGRAM_KEY_ID = "DEEPGRAM_API_KEY";
export const WARM_TOKEN_TTL_MS = 3 * 60_000;
export type WarmMinter = { mint: () => Promise<string>; refresh: () => void };
export function createWarmMinter(mint: () => Promise<string>, now: () => number = Date.now, ttlMs: number = WARM_TOKEN_TTL_MS): WarmMinter {
 let warm: { p: Promise<string>; at: number } | null = null;
 const m: WarmMinter = {
  mint: () => {
   if (!warm || now() - warm.at > ttlMs) {
    const p = mint().catch((error: unknown) => { warm = null; throw error; });
    warm = { p, at: now() };
   }
   return warm.p;
  },
  refresh: () => { warm = null; m.mint().catch(() => {}); },
 };
 return m;
}
