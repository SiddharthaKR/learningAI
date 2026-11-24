import {
	clampThinkingLevel,
	createModels,
	createProvider,
	getSupportedThinkingLevels,
	type Api,
	type Model,
	type Models,
	type ProviderStreams,
	type SimpleStreamOptions,
	type StreamOptions,
	type StreamFunction,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { MutableModels } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type ModelRole } from "../../config.ts";
import { DEFAULT_THINKING_ORDER, type UserSettings } from "../core/settings.ts";
import type { LocalProviderSnapshot } from "./local-providers.ts";
import packageMetadata from "../../package.json" with { type: "json" };
import { officeConfig } from "../core/office-config.ts";
import { createLlmLimiter } from "./llm-concurrency.ts";
import { promptToolStream } from "./prompt-tool-stream.ts";
import { toolSalvageStream } from "./tool-salvage-stream.ts";

/** App identity is immutable and shared by Models and every native Agent.
 * Agent's default Pi attribution otherwise overrides the Models identity. */
export const APP_IDENTITY = Object.freeze({
	userAgent: Object.freeze({ custom: `learnharness/${packageMetadata.version}` }),
	attribution: Object.freeze({ name: packageMetadata.name, url: packageMetadata.homepage }),
});

/**
 * The one engine factory every agent's model comes from (the pi-ai swap,
 * docs/pi-engine-swap.md). BYOK ALL THE WAY DOWN (owner, 2026-09-22):
 * there are no factory pins — every engine resolves from a RESOLVED SPEC
 * (the settings chain's output) and the one builder here wires it to
 * pi-ai's federated catalogs.
 *
 * An "engine" is the model + the stream function the agent loop runs on —
 * the two things a test fake replaces. Production engines resolve the model
 * from pi-ai's static catalogs and stream through the same Models
 * collection.
 */

export interface PiEngine {
	model: Model<Api>;
	streamFn: StreamFunction;
	/** The resolved (config-or-settings, CLAMPED) thinking level —
	 *  observability + tests; the streamFn pins it anyway. */
	level?: ThinkingLevel;
}

export type { ThinkingLevel };

/** The office reasoning switch on the wire (owner, 2026-11-23). pi-ai
 * sends reasoning_effort "medium" when thinking is on and nothing when
 * off; Gemma servers differ in what they obey, so both signals ride
 * every request. Ollama obeys only reasoning_effort "none" to switch
 * thinking off; the Gemma 4 proxy (deploy/gemma4-proxy) reads
 * chat_template_kwargs.enable_thinking. Pure: returns a new payload. */
export function withOfficeThinking(payload: unknown): unknown {
	if (typeof payload !== "object" || payload === null) return payload;
	const params = payload as Record<string, unknown>;
	const effort = params.reasoning_effort;
	const on = typeof effort === "string" && effort !== "none";
	const kwargs = typeof params.chat_template_kwargs === "object" && params.chat_template_kwargs !== null
		? params.chat_template_kwargs as Record<string, unknown>
		: {};
	return {
		...params,
		...(on ? {} : { reasoning_effort: "none" }),
		chat_template_kwargs: { ...kwargs, enable_thinking: on },
	};
}

let collection: ReturnType<typeof createModels> | undefined;
let limitLlmStream: ReturnType<typeof createLlmLimiter> | undefined;

function officeStreams(): ProviderStreams {
	const upstream = openAICompletionsApi();
	const optionsFor = <T extends StreamOptions | SimpleStreamOptions>(options: T | undefined): T => {
		const config = officeConfig();
		const upstreamFetch = options?.fetch ?? globalThis.fetch;
		const upstreamPayload = options?.onPayload;
		return {
			...options,
			// Reasoning-capable office models carry both thinking signals.
			...(config.llmReasoning ? {
				onPayload: async (payload: unknown, model: Model<Api>) => {
					const next = upstreamPayload ? await upstreamPayload(payload, model) : undefined;
					return withOfficeThinking(next ?? payload);
				},
			} : {}),
			apiKey: config.llmApiKey ?? "office-no-key-placeholder",
			...(config.llmApiKey ? {} : {
				fetch: (input: RequestInfo | URL, init?: RequestInit) => {
					const headers = new Headers(init?.headers);
					headers.delete("authorization");
					return upstreamFetch(input, { ...init, headers });
				},
			}),
		} as T;
	};
	// Native mode: the salvage wrapper turns a tool call the model TYPED into
	// its reply (a ```json quiz, a ```mermaid plan) into the real call — see
	// tool-salvage-stream.ts. Prompt mode has its own text-call parser.
	return {
		stream: (model, context, options) => officeConfig().llmToolMode === "prompt"
			? promptToolStream((m, c, o) => upstream.stream(m, c, optionsFor(o)))(model, context, options)
			: toolSalvageStream((m, c, o) => upstream.stream(m, c, optionsFor(o)))(model, context, options),
		streamSimple: (model, context, options) => officeConfig().llmToolMode === "prompt"
			? promptToolStream((m, c, o) => upstream.streamSimple(m, c, optionsFor(o)))(model, context, options)
			: toolSalvageStream((m, c, o) => upstream.streamSimple(m, c, optionsFor(o)))(model, context, options),
	};
}

/** Exactly one server-owned OpenAI-compatible provider and model. */
export function piModels() {
	if (!collection) {
		const config = officeConfig();
		const model: Model<"openai-completions"> = {
			id: config.llmModel,
			name: config.llmModel,
			provider: "office",
			api: "openai-completions",
			baseUrl: config.llmBaseUrl,
			input: config.llmVision ? ["text", "image"] : ["text"],
			reasoning: config.llmReasoning,
			...(config.llmReasoning ? {
				// Exactly two levels: off (the Preferences switch) and medium.
				// null marks a level unsupported in pi-ai, so off stays unset —
				// a null off clamped "off" up to "minimal" and thinking ran on.
				// Off/on reach the wire through withOfficeThinking (onPayload).
				thinkingLevelMap: { minimal: null, low: null, medium: "medium", high: null },
			} : {}),
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: config.llmContextWindow,
			maxTokens: config.llmMaxTokens,
			// LLM_MAX_TOKENS goes out as `max_tokens` (2026-11-24): pi-ai's
			// default for a custom endpoint is `max_completion_tokens`, which
			// Ollama ignores — a local 12B turn thought for 19k tokens (13 min)
			// past the 4,096 cap. Ollama, LM Studio and the Gemma 4 proxy all
			// read `max_tokens`.
			compat: { maxTokensField: "max_tokens" },
		};
		collection = createModels({ identity: APP_IDENTITY });
		collection.setProvider(createProvider({
			id: "office",
			name: "Office vLLM",
			baseUrl: config.llmBaseUrl,
			auth: { apiKey: { name: "Office environment", resolve: async () => ({
				auth: { apiKey: config.llmApiKey ?? "office-no-key-placeholder" },
				source: "server environment",
			}) } },
			models: [model],
			api: officeStreams(),
		}));
	}
	return collection;
}

/** Legacy discovery hook kept for callers; user endpoints are disabled. */
export function configureLocalProviders(_settings: UserSettings | undefined, _snapshot?: LocalProviderSnapshot): void {
	// The office provider is fixed at process startup.
}

export function openRouterApiKey(): string | undefined {
	return undefined;
}
/** A fully-resolved model pin — the shape every engine now comes from:
 *  the settings-resolution chain's output (role override → slot, or the
 *  chat's conversation chain). thinkingLevel is OPTIONAL: unset means
 *  the baked default resolves here (owner 2026-09-22) — the first entry
 *  of DEFAULT_THINKING_ORDER the model supports. */
export interface ResolvedModelSpec {
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

/** The first entry of the baked default order the model supports (owner,
 *  2026-09-22). A non-reasoning model reports exactly ["off"], so the
 *  order walk lands there naturally. */
function defaultThinkingLevel(model: Model<Api>): ThinkingLevel {
	const supported = getSupportedThinkingLevels(model);
	for (const level of DEFAULT_THINKING_ORDER) {
		if (supported.includes(level)) return level;
	}
	return supported[0] ?? "off";
}

/** The production engine for a RESOLVED spec (model slots wave,
 *  2026-09-20): provider-aware catalog lookup + thinking clamp. The API
 *  key is resolved by pi-ai itself from the environment per request (the
 *  keys seam reflects file-saved keys into env), so the engine never
 *  hardcodes OpenRouter's. */
export function piEngineForSpec(spec: ResolvedModelSpec): PiEngine {
	const models: Models = piModels();
	limitLlmStream ??= createLlmLimiter(officeConfig().maxConcurrentLlm);
	const model = models.getModel(spec.provider, spec.id);
	if (!model) {
		throw new Error(`${spec.provider} catalog has no model ${spec.id}`);
	}
	// UNSET level → the baked default order (first entry the model
	// supports); SET level → pi's native nearest-clamp (model swaps keep
	// the user's intent and adapt honestly).
	const level = spec.thinkingLevel
		? clampThinkingLevel(model, spec.thinkingLevel)
		: defaultThinkingLevel(model);
	return {
		model,
		level,
		// bound streamSimple: the agent loop forwards state.thinkingLevel as
		// `reasoning` (undefined = off on pi-ai's scale); the clamp above keeps
		// the pin honest even when config or settings drift off the map.
		streamFn: (requestModel, context, options) =>
			limitLlmStream!(requestModel, () =>
				models.streamSimple(requestModel, context, {
					...options,
					reasoning: level === "off" ? undefined : level,
				}), options?.signal),	};
}

/** The LEGACY role entry point — BYOK made it an honest THROWER (owner,
 *  2026-09-22): no factory pins exist to fall back to, and this module
 *  cannot read settings (architecture law — the agent layer never
 *  imports the server layer). Production resolves the chain in
 *  chat-handler and ALWAYS injects engines; reaching this means a
 *  wiring bug, so it fails loudly instead of guessing a model. */
export function piEngineFor(role: ModelRole): PiEngine {
	throw new Error(
		`no configured model for role "${role}" — set your model slots (settings → models)`,
	);
}
