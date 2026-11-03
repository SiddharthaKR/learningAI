import assert from "node:assert/strict";
import { it } from "node:test";
import { withOfficeUser } from "../src/server/route-scope.ts";
import { currentUserId } from "../src/server/user-scope.ts";

it("denies direct unauthenticated API calls and scopes authenticated work", async () => {
  const testUserId = process.env.LH_TEST_USER_ID;
  delete process.env.LH_TEST_USER_ID;
  try {
  const handler = withOfficeUser(async () => {
    await Promise.resolve();
    return Response.json({ owner: currentUserId() });
  }, async (request) => request.headers.get("x-test-user") ? { id: request.headers.get("x-test-user")! } as any : null);
  assert.equal((await handler(new Request("http://office.test/api/chats"))).status, 401);
  const response = await handler(new Request("http://office.test/api/chats", { headers: { "x-test-user": "alice" } }));
  assert.deepEqual(await response.json(), { owner: "alice" });
  assert.throws(() => currentUserId(), /No user scope/u);
  } finally {
    if (testUserId) process.env.LH_TEST_USER_ID = testUserId;
  }
});
