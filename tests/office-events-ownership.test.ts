import assert from "node:assert/strict";
import { it } from "node:test";
import { emit, setEventOwnerResolver, subscribeForOwner } from "../src/core/events.ts";
import { currentUserId, runAsUser } from "../src/server/user-scope.ts";

it("delivers event notifications only to their owner", () => {
  setEventOwnerResolver(() => { try { return currentUserId(); } catch { return null; } });
  const alice: string[] = [];
  const bob: string[] = [];
  const stopAlice = subscribeForOwner("alice", (event) => alice.push(event.type));
  const stopBob = subscribeForOwner("bob", (event) => bob.push(event.type));
  try {
    runAsUser("alice", () => emit("chats-changed", {}));
    runAsUser("bob", () => emit("jobs-changed", { chatId: "job-b" }));
    emit("activity-changed", {});
    assert.deepEqual(alice, ["chats-changed"]);
    assert.deepEqual(bob, ["jobs-changed"]);
  } finally { stopAlice(); stopBob(); setEventOwnerResolver(() => null); }
});
