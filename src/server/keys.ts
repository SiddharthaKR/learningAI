/** Office credentials are supplied by the server process environment only. */
import { AUTH_KEYS, maskKey, type AuthKeyStatus } from "../core/auth-keys.ts";

/** Legacy API compatibility; office deployments never accept key writes. */
export function isWritableAuthKey(_id: string): boolean {
	return false;
}

export function providerKeyList(): [] {
	return [];
}

export function envKeysIgnored(): boolean {
	return false;
}

export function initAuthEnv(): void {
	// There is no auth.json reflection in an office deployment.
}

/** Pure compatibility projection for historical tests; no disk access. */
export function resolveKeyStatuses(
	fileVars: Record<string, string>,
	env: Record<string, string | undefined>,
	realEnv: ReadonlySet<string>,
	providerEnvVars: ReadonlySet<string> = new Set(),
): AuthKeyStatus[] {
	const ids = new Set<string>([...AUTH_KEYS.map((key) => key.id), ...Object.keys(fileVars)]);
	for (const id of providerEnvVars) {
		if (env[id] !== undefined || fileVars[id] !== undefined) ids.add(id);
	}
	return [...ids].map((id) => {
		const live = env[id] ?? fileVars[id];
		const isRealEnv = realEnv.has(id);
		return {
			id,
			info: AUTH_KEYS.find((key) => key.id === id) ?? null,
			present: live !== undefined,
			masked: live !== undefined ? maskKey(live) + " (" + live.trim().length + " chars)" : null,
			source: isRealEnv ? "env" : live !== undefined ? "file" : "none",
			shadowedByEnv: isRealEnv && fileVars[id] !== undefined && env[id] !== fileVars[id],
		};
	});
}
export function keyStatuses(): AuthKeyStatus[] {
	return [];
}

export function keyValue(id: string): string | undefined {
	return process.env[id];
}

/** Only the fixed office provider is available for model calls. */
export function providerKeyPresent(provider: string): boolean {
	return provider === "office";
}

export function saveKey(_id: string, _value: string): { ok: true; status: AuthKeyStatus } | { ok: false; error: string } {
	return { ok: false, error: "API keys are managed by the server environment" };
}

export function deleteKey(_id: string): AuthKeyStatus {
	throw new Error("API keys are managed by the server environment");
}


