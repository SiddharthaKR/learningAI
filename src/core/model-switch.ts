/**
 * Model selection (owner, 2026-11-27): a session keeps the model it was
 * started with. When that model is no longer configured, the session moves
 * to model 1 and the chat shows one line naming both (UI-only — the model
 * never sees it).
 */
import type { LhMarkerMessage } from "./native-messages.ts";

export interface ModelSwitchedDetails {
	from: string;
	to: string;
}

export function newModelSwitchedMessage(chatId: string, from: string, to: string): LhMarkerMessage {
	return {
		id: `steer_modelswitch_${chatId}_${Date.now()}`,
		role: "custom",
		customType: "model-switched",
		content: "",
		display: true,
		details: { from, to } satisfies ModelSwitchedDetails,
		timestamp: Date.now(),
	};
}
