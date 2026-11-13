/**
 * THE COMPOSITION ROOT for storage — the single place concrete store
 * adapters are wired. Everything else (core, services, agents) codes against
 * the port types in core/ports.ts and receives instances through this
 * module. Swapping the fs adapter for SQLite later changes exactly this
 * file (and the adapter implementations in src/store/).
 */

import { createChatStore } from "../store/chats.ts";
import { createGraphStore } from "../store/graph.ts";
import { createJobStore } from "../store/jobs.ts";
import { createSettingsStore } from "../store/settings.ts";
import { createRenderSettingsStore } from "../store/render-settings.ts";
import { createKnowledgeStore } from "../store/knowledge.ts";
import { PATHS } from "../../config.ts";
import path from "node:path";
import { currentUserId, isBackgroundOwnerScope } from "./user-scope.ts";
import { accountExistsSync } from "./accounts.ts";
import { setEventOwnerResolver } from "../core/events.ts";

setEventOwnerResolver(() => { try { return currentUserId(); } catch { return null; } });
import { resolveSettings, type EffectiveSettings } from "../core/settings-resolution.ts";
import { fixedOfficeModelSpec } from "./office-config.ts";
/** The only path constructor for personal stores. */
const cache = new Map<string, ReturnType<typeof constructUserStores>>();
export const sharedKnowledgeStore = createKnowledgeStore(path.join(PATHS.data, "shared"), () => {});
function assertOwnerExists(userId: string): void {
	if (!accountExistsSync(PATHS.data, userId)) throw new Error("Owner account no longer exists");
}
function constructUserStores(userId: string) {
	if (!/^[A-Za-z0-9_-]+$/u.test(userId)) throw new Error("Invalid user ID");
	const root = path.join(PATHS.data, "users", userId);
	return {
		root,
		chatStore: createChatStore(root),
		jobStore: createJobStore(root, userId),
		graphStore: createGraphStore(root),
		settingsStore: createSettingsStore(root),
		renderSettingsStore: createRenderSettingsStore(root),
		knowledgeStore: createKnowledgeStore(root, () => assertOwnerExists(userId)),
	};
}
export function storesForUser(userId: string): ReturnType<typeof constructUserStores> {
	if (!/^[A-Za-z0-9_-]+$/u.test(userId)) throw new Error("Invalid user ID");
	let value = cache.get(userId);
	if (!value) { value = constructUserStores(userId); cache.set(userId, value); }
	return value;
}

/** Background tasks hold an owner ID and recheck account existence at each store operation. */
export function checkedStoresForUser(userId: string): ReturnType<typeof storesForUser> {
	const base = storesForUser(userId);
	function checked<T extends object>(store: T): T {
		return new Proxy(store, {
			get(target, property) {
				const value = Reflect.get(target, property);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					assertOwnerExists(userId);
					return Reflect.apply(value, target, args);
				};
			},
		});
	}
	return {
		root: base.root,
		chatStore: checked(base.chatStore),
		graphStore: checked(base.graphStore),
		jobStore: checked(base.jobStore),
		settingsStore: checked(base.settingsStore),
		renderSettingsStore: checked(base.renderSettingsStore),
		knowledgeStore: checked(base.knowledgeStore),
	};
}

/** Existing services resolve their stores from the authenticated request scope. */
export const stores = new Proxy({} as Omit<ReturnType<typeof storesForUser>, "root">, {
	get(_target, property) {
		const ownerId = currentUserId();
		return Reflect.get(isBackgroundOwnerScope() ? checkedStoresForUser(ownerId) : storesForUser(ownerId), property);
	},
});
export type Stores = typeof stores;
export const settingsStore = {
	readSettings: () => stores.settingsStore.readSettings(),
	writeSettings: (record: Parameters<typeof stores.settingsStore.writeSettings>[0]) => stores.settingsStore.writeSettings(record),
};
export const readSettingsRecord = () => settingsStore.readSettings();
export const writeSettingsRecord = (record: Parameters<typeof settingsStore.writeSettings>[0]) => settingsStore.writeSettings(record);
export const readRenderSettings = () => stores.renderSettingsStore.readRenderSettings();
export const writeRenderSettings = (value: unknown) => stores.renderSettingsStore.writeRenderSettings(value);

/**
 * The resolved view of the settings record (core/settings-resolution.ts):
 * every knob concrete over its factory default — EXCEPT MODELS (BYOK all
 * the way down, owner 2026-09-22): no factory pins exist, so unset model
 * slots resolve to null and per-need refusal gates fire downstream. Read
 * fresh on every call — the record is a small file and turns are rare, so
 * no caching layer (stale toggles after a settings PUT would be worse).
 */
export function effectiveSettings(): EffectiveSettings {
	const record = stores.settingsStore.readSettings();
	const effective = resolveSettings(record);
	const fixed = fixedOfficeModelSpec();
	for (const role of Object.keys(effective.agent.models) as Array<keyof typeof effective.agent.models>) {
		effective.agent.models[role] = fixed;
	}
	effective.models = { strong: fixed, cheap: fixed, vision: fixed };
	return effective;
}

