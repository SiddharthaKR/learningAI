import { lazyStream } from "@earendil-works/pi-ai/api/lazy";
import type { Api, AssistantMessageEvent, Model, StreamFunction } from "@earendil-works/pi-ai";

/** One FIFO cap shared by all office model requests in this server process. */
export function createLlmLimiter(maxConcurrent: number) {
	let active = 0;
	const waiting: Array<{
		resolve: (release: () => void) => void;
		reject: (reason: unknown) => void;
		signal?: AbortSignal;
		onAbort: () => void;
	}> = [];

	function release(): void {
		const next = waiting.shift();
		if (next) {
			next.signal?.removeEventListener("abort", next.onAbort);
			next.resolve(release);
		} else {
			active -= 1;
		}
	}

	function acquire(signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (active < maxConcurrent && waiting.length === 0) {
			active += 1;
			return Promise.resolve(release);
		}
		return new Promise((resolve, reject) => {
			const entry = {
				resolve,
				reject,
				signal,
				onAbort: () => {
					const index = waiting.indexOf(entry);
					if (index >= 0) waiting.splice(index, 1);
					reject(signal?.reason);
				},
			};
			waiting.push(entry);
			signal?.addEventListener("abort", entry.onAbort, { once: true });
			if (signal?.aborted) entry.onAbort();
		});
	}

	return function limitedStream(
		model: Model<Api>,
		start: () => ReturnType<StreamFunction>,
		signal?: AbortSignal,
	): ReturnType<StreamFunction> {
		return lazyStream(model, async () => {
			const releaseSlot = await acquire(signal);
			let upstream: ReturnType<StreamFunction>;
			try {
				upstream = start();
			} catch (error) {
				releaseSlot();
				throw error;
			}
			async function* events(): AsyncIterable<AssistantMessageEvent> {
				try {
					yield* upstream;
				} finally {
					releaseSlot();
				}
			}
			return events();
		});
	};
}
