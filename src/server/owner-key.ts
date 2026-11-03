import { currentUserId } from "./user-scope.ts";

/** Process-wide registries use an owner-qualified key for personal IDs. */
export function ownerKey(id: string): string {
  return `${currentUserId()}:${id}`;
}
