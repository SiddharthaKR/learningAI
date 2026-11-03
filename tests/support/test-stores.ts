import path from "node:path";
import fs from "node:fs";

const testRoot = process.env.LH_DATA_DIR;
const testUserId = process.env.LH_TEST_USER_ID;
if (!testRoot || !testUserId) throw new Error("Tests must run with tests/bootstrap.mjs");

// Import config only after the isolated root is set, then point its legacy
// path constants at the same user's folder for tests that inspect files.
const config = await import("../../config.ts");
// Legacy route tests use LH_TEST_USER_ID as their authenticated owner. Seed a
// matching account so the account lookup in session creation remains real.
fs.mkdirSync(testRoot, { recursive: true });
const accountFile = path.join(testRoot, "accounts.json");
if (!fs.existsSync(accountFile)) {
  fs.writeFileSync(accountFile, JSON.stringify({ version: 1, accounts: [{
    id: testUserId, username: "test-owner", uiLanguage: "en", teachingLanguage: "en",
    createdAt: new Date().toISOString(), passwordSalt: "", passwordHash: "",
  }] }));
}
export const TEST_USER_ROOT = path.join(testRoot, "users", testUserId);
Object.assign(config.PATHS, {
  data: testRoot,
  chats: path.join(TEST_USER_ROOT, "chats"),
  graph: path.join(TEST_USER_ROOT, "graph"),
  debug: path.join(TEST_USER_ROOT, "debug"),
});
export const TEST_SETTINGS_FILE = path.join(TEST_USER_ROOT, "settings.json");
export const TEST_GRAPH_FORMAT_FILE = path.join(TEST_USER_ROOT, "graph", "format.json");
export const TEST_SOURCES_FILE = path.join(TEST_USER_ROOT, "graph", "sources.json");
export const TEST_LEDGER_FILES = {
  nodes: path.join(TEST_USER_ROOT, "graph", "nodes.jsonl"),
  chains: path.join(TEST_USER_ROOT, "graph", "chains.jsonl"),
  sessions: path.join(TEST_USER_ROOT, "graph", "sessions.jsonl"),
  coverage: path.join(TEST_USER_ROOT, "graph", "coverage.jsonl"),
};
export const TEST_PATHS = {
  ...config.PATHS,
  data: TEST_USER_ROOT,
  chats: path.join(TEST_USER_ROOT, "chats"),
  graph: path.join(TEST_USER_ROOT, "graph"),
  debug: path.join(TEST_USER_ROOT, "debug"),
};

const { storesForUser } = await import("../../src/server/stores.ts");
export const testStores = storesForUser(testUserId);
export const chatStore = testStores.chatStore;
export const graphStore = testStores.graphStore;
export const jobStore = testStores.jobStore;
export const settingsStore = testStores.settingsStore;
export const readRenderSettings = () => testStores.renderSettingsStore.readRenderSettings();
export const writeRenderSettings = (value: unknown) => testStores.renderSettingsStore.writeRenderSettings(value);
export const readSettings = () => settingsStore.readSettings();
export const writeSettings = (value: Parameters<typeof settingsStore.writeSettings>[0]) => settingsStore.writeSettings(value);

