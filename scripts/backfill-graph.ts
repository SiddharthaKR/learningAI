/**
 * One-time backfill: wipe the legacy ledgers and re-extract every chat with
 * the redesigned pipeline (vision §1, commit b07c907). Run from the master
 * tree only — data never crosses trees:
 *
 *   npx tsx --env-file=.env scripts/backfill-graph.ts --user <username> [chat-id]
 */
import { PATHS } from "../config.ts";
import { createAccountStore } from "../src/server/accounts.ts";
import { storesForUser, effectiveSettings } from "../src/server/stores.ts";
import { runAsUser } from "../src/server/user-scope.ts";
import { createExtractionPipeline } from "../src/agent/subagents/extraction.ts";
import { getGraph } from "../src/core/graph.ts";

async function main() {
	const args = process.argv.slice(2);
	const userFlag = args.indexOf("--user");
	const username = userFlag >= 0 ? args[userFlag + 1] : undefined;
	if (!username) throw new Error("Usage: backfill-graph.ts --user <username> [chat-id]");
	const account = await createAccountStore(PATHS.data).byUsername(username);
	if (!account) throw new Error(`Unknown user: ${username}`);
	const only = args.find((arg, index) => index !== userFlag && index !== userFlag + 1 && !arg.startsWith("--"));
	return runAsUser(account.id, async () => {
	const { chatStore, graphStore } = storesForUser(account.id);
	const chats = only ? chatStore.listChats().filter((c) => c.id === only) : chatStore.listChats();
	console.log(`[backfill] ${chats.length} chats to extract`);
	const pipeline = createExtractionPipeline({
		ownerId: account.id,
		chatStore,
		graphStore,
		// Live budget: the graph section's setting, same as the app's trigger
		getChunkTokens: () => effectiveSettings().graph.extractionChunkTokens,
	});
	for (const chat of chats) {
		const t0 = Date.now();
		try {
			const stats = await pipeline.runExtraction(chat.id);
			console.log(
				`[backfill] ${chat.id} (${chat.title.slice(0, 40)}): ` +
					`${stats.nodes} nodes, ${stats.chains ?? 0} chains in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
			);
		} catch (err) {
			console.error(`[backfill] ${chat.id} FAILED:`, err);
		}
	}
	const graph = getGraph(graphStore);
	console.log(
		`[backfill] done: ${graph.nodes.length} nodes, ${graph.chains.length} chains`,
	);
	});
}

main();
