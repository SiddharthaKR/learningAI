import { AsyncLocalStorage } from "node:async_hooks";

// globalThis-backed (like the event bus in src/core/events.ts): Next.js
// bundles each route separately, so a module-level store would give every
// route its own copy — the events route's owner resolver would then never
// see the scope /api/chat runs under, and every event would drop as unowned.
type UserScope = AsyncLocalStorage<{ userId: string; background: boolean }>;
const g = globalThis as typeof globalThis & { __lhUserScope?: UserScope };
const scope: UserScope = (g.__lhUserScope ??= new AsyncLocalStorage());

export function runAsUser<T>(userId: string, work: () => T): T {
  if (!/^[A-Za-z0-9_-]+$/u.test(userId)) throw new Error("Invalid user ID");
  return scope.run({ userId, background: false }, work);
}

export function runAsBackgroundOwner<T>(userId: string, work: () => T): T {
  if (!/^[A-Za-z0-9_-]+$/u.test(userId)) throw new Error("Invalid user ID");
  return scope.run({ userId, background: true }, work);
}

export function currentUserId(): string {
	const userId = scope.getStore()?.userId ?? (process.env.NODE_ENV === "test" ? process.env.LH_TEST_USER_ID : undefined);
  if (!userId) throw new Error("No user scope for personal data access");
  return userId;
}

export function isBackgroundOwnerScope(): boolean {
  return scope.getStore()?.background === true;
}
