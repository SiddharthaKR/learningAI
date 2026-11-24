/** Runs once when the Next.js server starts, before it takes requests.
 *  Node-only work lives in instrumentation-node.ts so the edge build never
 *  bundles it (the docs' NEXT_RUNTIME branch pattern). */
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		await import("./instrumentation-node.ts");
	}
}
