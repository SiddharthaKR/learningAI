import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<{ userId: string; background: boolean }>();

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
