import assert from "node:assert/strict";
import { it } from "node:test";
import { runAsUser, currentUserId } from "../src/server/user-scope.ts";

it("keeps owner identity across concurrent asynchronous work", async () => {
  const testUserId = process.env.LH_TEST_USER_ID;
  delete process.env.LH_TEST_USER_ID;
  try {
  const values = await Promise.all([
    runAsUser("alice", async () => { await new Promise((resolve) => setTimeout(resolve, 15)); return currentUserId(); }),
    runAsUser("bob", async () => { await new Promise((resolve) => setTimeout(resolve, 1)); return currentUserId(); }),
  ]);
  assert.deepEqual(values, ["alice", "bob"]);
  assert.throws(() => currentUserId(), /No user scope/u);
  } finally {
    if (testUserId) process.env.LH_TEST_USER_ID = testUserId;
  }
});
