import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "learnharness-test-"));
process.env.NODE_ENV = "test";
process.env.LH_DATA_DIR = root;
process.env.LH_TEST_USER_ID = `test_${randomUUID().replaceAll("-", "")}`;
process.env.LLM_BASE_URL ??= "http://127.0.0.1:1234/v1";
process.env.LLM_MODEL ??= "test-model";
process.env.LLM_CONTEXT_WINDOW ??= "8192";
process.env.LLM_MAX_TOKENS ??= "512";
process.env.LLM_VISION ??= "false";
process.env.LLM_REASONING ??= "false";
process.env.LLM_TOOL_MODE ??= "native";
process.env.QUIZ_ANSWER_CHECK ??= "false"; // tests never call a real model
process.env.NO_PROXY ??= "127.0.0.1";
process.env.SESSION_SECRET ??= "test-secret-for-local-suite-only-0123456789";
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
