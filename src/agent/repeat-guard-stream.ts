import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type StreamFunction,
} from "@earendil-works/pi-ai";

/**
 * Repeated tool-call guard (owner, 2026-11-27 — all models).
 *
 * GLM-4.6V-Flash on LM Studio never stops after a tool call: LM Studio's
 * tool-call rules for it allow another call where the reply should end, so
 * one reply held 64 identical `calc(expr="7*6")` calls and ran to the output
 * cap (60 s at 1,024 tokens; minutes at the office cap). Neither
 * `parallel_tool_calls: false` nor stop sequences changed it.
 *
 * This wrapper ends a reply the moment the model finishes a tool call
 * identical to one it already made in the same reply (same tool, same
 * arguments): the request is aborted and the reply ends as a normal tool-use
 * reply holding the calls made before the repeat. A model that never repeats
 * a call is unaffected.
 */
export function repeatGuardStream(upstream: StreamFunction): StreamFunction {
	return (model, context, options) => {
		const output = createAssistantMessageEventStream();
		const stop = new AbortController();
		const outer = options?.signal;
		if (outer) {
			if (outer.aborted) stop.abort(outer.reason);
			else outer.addEventListener("abort", () => stop.abort(outer.reason), { once: true });
		}
		void (async () => {
			const seen = new Set<string>();
			let partial: AssistantMessage | undefined;
			try {
				for await (const event of upstream(model, context, { ...options, signal: stop.signal })) {
					if ("partial" in event && event.partial) partial = event.partial;
					if (event.type === "toolcall_end") {
						const key = `${event.toolCall.name}\u0000${JSON.stringify(event.toolCall.arguments ?? {})}`;
						if (seen.has(key) && partial) {
							// The repeat and anything after it are dropped; the calls
							// made before it are the reply.
							const message: AssistantMessage = {
								...partial,
								content: partial.content.slice(0, event.contentIndex),
								stopReason: "toolUse",
							};
							stop.abort(new Error("repeated tool call"));
							output.push({ type: "done", reason: "toolUse", message });
							output.end(message);
							return;
						}
						seen.add(key);
					}
					output.push(event);
					if (event.type === "done") {
						output.end(event.message);
						return;
					}
					if (event.type === "error") {
						output.end(event.error);
						return;
					}
				}
				throw new Error("Model stream ended without a final response");
			} catch (error) {
				const failed = partial ?? ({ role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "error", timestamp: Date.now() } as AssistantMessage);
				failed.stopReason = outer?.aborted ? "aborted" : "error";
				failed.errorMessage = error instanceof Error ? error.message : String(error);
				output.push({ type: "error", reason: failed.stopReason === "aborted" ? "aborted" : "error", error: failed });
				output.end(failed);
			}
		})();
		return output;
	};
}
