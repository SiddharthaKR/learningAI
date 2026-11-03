import assert from "node:assert/strict";
import { it } from "node:test";
import { createAuthRateLimiter } from "../src/server/auth-rate-limit.ts";

it("limits login attempts per address and resets after the window", () => {
  const limiter = createAuthRateLimiter(2, 60_000);
  assert.equal(limiter.allow("192.0.2.1", 0), true);
  assert.equal(limiter.allow("192.0.2.1", 1), true);
  assert.equal(limiter.allow("192.0.2.1", 2), false);
  assert.equal(limiter.allow("192.0.2.2", 2), true);
  assert.equal(limiter.allow("192.0.2.1", 60_000), true);
});
