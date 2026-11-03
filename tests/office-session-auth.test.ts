import assert from "node:assert/strict";
import { it } from "node:test";
import { createSessionToken, verifySessionToken, resolveSessionAccount } from "../src/server/session-auth.ts";

it("accepts a signed unexpired session and rejects tampering and expiry", () => {
  const secret = "a-test-secret-longer-than-thirty-two-characters";
  const token = createSessionToken("user-1", secret, 1000, 60);
  assert.equal(verifySessionToken(token, secret, 1059), "user-1");
  assert.equal(verifySessionToken(token, secret, 1060), null);
  assert.equal(verifySessionToken(token + "x", secret, 1001), null);
});

it("rejects a valid cookie after its account is deleted", async () => {
  const secret = "a-test-secret-longer-than-thirty-two-characters";
  const token = createSessionToken("deleted-user", secret, 1000, 60);
  const account = await resolveSessionAccount(token, secret, async () => null, 1001);
  assert.equal(account, null);
});
