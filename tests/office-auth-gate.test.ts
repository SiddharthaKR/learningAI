import assert from "node:assert/strict";
import { it } from "node:test";
import { authGate } from "../src/server/auth-gate.ts";

it("gates every API and page except the public entry points", () => {
  for (const path of ["/api/chat", "/api/chats/a", "/api/graph", "/api/jobs", "/api/events", "/api/settings/prompts/x", "/api/auth/logout", "/", "/chat/new", "/settings"]) {
    assert.notEqual(authGate(path, false), "allow", path);
    assert.equal(authGate(path, true), "allow", path);
  }
  for (const path of ["/login", "/signup", "/source", "/api/auth/login", "/api/auth/signup"]) {
    assert.equal(authGate(path, false), "allow", path);
  }
});
