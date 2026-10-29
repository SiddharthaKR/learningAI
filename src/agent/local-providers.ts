import { createProvider, type Model, type Provider, type ProviderStreams, type SimpleStreamOptions, type StreamOptions } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { CustomEndpointSettings, ModelsSettings, UserSettings } from "../core/settings.ts";

export const OLLAMA_PROVIDER_ID = "ollama";
export const CUSTOM_OPENAI_PROVIDER_ID = "custom-openai";
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

export interface DiscoveredLocalModel {
	id: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
	vision?: boolean;
	reasoning?: boolean;
	tools?: boolean;
}

export interface LocalProviderSnapshot {
	ollama?: DiscoveredLocalModel[];
	customEndpoint?: DiscoveredLocalModel[];
	customEndpointBaseUrl?: string;
}

function noKeyAuth(name: string) {
	return {
		apiKey: {
			name,
			resolve: async () => ({ auth: {}, source: "no API key required" }),
		},
	};
}

function noAuthorizationHeader(apiKey: string | undefined, headers: StreamOptions["headers"]): boolean {
	return !apiKey && !Object.entries(headers ?? {}).some(([name, value]) => name.toLowerCase() === "authorization" && !!value);
}

function noKeyOpenAICompletions(): ProviderStreams {
	const openAI = openAICompletionsApi();
	const noKeyOptions = <T extends StreamOptions | SimpleStreamOptions>(options: T | undefined): T => {
		const requiresPlaceholder = noAuthorizationHeader(options?.apiKey, options?.headers);
		const originalFetch = options?.fetch ?? globalThis.fetch;
		return {
			...options,
			...(requiresPlaceholder ? { apiKey: "local-endpoint-no-key" } : {}),
			fetch: (input, init) => {
				const requestHeaders = new Headers(init?.headers);
				requestHeaders.delete("authorization");
				return originalFetch(input, { ...init, headers: requestHeaders });
			},
		} as T;
	};
	return {
		stream: (model, context, options) => openAI.stream(model, context, noKeyOptions(options)),
		streamSimple: (model, context, options) => openAI.streamSimple(model, context, noKeyOptions(options)),
	};
}

function makeModel(
	provider: string,
	baseUrl: string,
	model: DiscoveredLocalModel,
	manual?: NonNullable<CustomEndpointSettings["manualModels"]>[number],
): Model<"openai-completions"> {
	const reasoning = model.reasoning === true;
	const vision = manual?.vision ?? model.vision === true;
	return {
		id: model.id,
		name: model.name || model.id,
		provider,
		api: "openai-completions",
		baseUrl,
		input: vision ? ["text", "image"] : ["text"],
		reasoning,
		...(reasoning
			? {
					thinkingLevelMap: { off: null, medium: "medium" },
					compat: {
						chatTemplateKwargs: {
							think: { $var: "thinking.enabled", omitWhenOff: true },
						},
					},
				}
			: {}),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.contextWindow && model.contextWindow > 0 ? model.contextWindow : 8192,
		maxTokens: model.maxTokens && model.maxTokens > 0 ? model.maxTokens : 2048,
	};
}

function unionModels(
	provider: string,
	baseUrl: string,
	discovered: readonly DiscoveredLocalModel[],
	manual: readonly NonNullable<CustomEndpointSettings["manualModels"]>[number][] = [],
): Model<"openai-completions">[] {
	const byId = new Map(discovered.map((model) => [model.id, model]));
	for (const model of manual) {
		const prior = byId.get(model.id);
		byId.set(model.id, {
			...prior,
			id: model.id,
			...(prior?.name ? {} : { name: model.id }),
			...(typeof model.vision === "boolean" ? { vision: model.vision } : {}),
		});
	}
	return [...byId.values()].map((model) => {
		const manualModel = manual.find((entry) => entry.id === model.id);
		return makeModel(provider, baseUrl, model, manualModel);
	});
}

function pinnedModels(settings: UserSettings | undefined, provider: string): DiscoveredLocalModel[] {
	const pins: Array<{ provider?: string; id?: string }> = [];
	for (const slot of ["strong", "cheap", "vision"] as const) pins.push(settings?.models?.[slot]?.model ?? {});
	for (const override of Object.values(settings?.agent?.models ?? {})) pins.push(override?.model ?? {});
	return pins.filter((pin) => pin.provider === provider && pin.id).map((pin) => ({ id: pin.id! }));
}

/** Build fresh provider instances from the installed/discovered catalog plus
 * saved pins, so a selected model remains resolvable when an endpoint is
 * temporarily offline. */
export function localProviders(settings: UserSettings | undefined, snapshot?: LocalProviderSnapshot): Provider[] {
	const customEndpoint = settings?.models?.customEndpoint;
	const cachedCustom = snapshot && snapshot.customEndpointBaseUrl === customEndpoint?.baseUrl ? snapshot.customEndpoint ?? [] : [];
	const ollamaModels = snapshot?.ollama ?? pinnedModels(settings, OLLAMA_PROVIDER_ID);
	const customModels = [...cachedCustom, ...pinnedModels(settings, CUSTOM_OPENAI_PROVIDER_ID)];
	const providers: Provider[] = [
		createProvider({
			id: OLLAMA_PROVIDER_ID,
			name: "Ollama (local)",
			baseUrl: OLLAMA_BASE_URL,
			auth: noKeyAuth("Ollama"),
			models: unionModels(OLLAMA_PROVIDER_ID, OLLAMA_BASE_URL, ollamaModels),
			api: noKeyOpenAICompletions(),
		}),
	];
	if (customEndpoint?.baseUrl) {
		providers.push(
			createProvider({
				id: CUSTOM_OPENAI_PROVIDER_ID,
				name: "Custom endpoint",
				baseUrl: customEndpoint.baseUrl,
				auth: noKeyAuth("Custom endpoint"),
				models: unionModels(
					CUSTOM_OPENAI_PROVIDER_ID,
					customEndpoint.baseUrl,
					customModels,
					customEndpoint.manualModels,
				),
				api: noKeyOpenAICompletions(),
			}),
		);
	}
	return providers;
}

export function localProviderIds(settings: ModelsSettings | undefined): string[] {
	return [OLLAMA_PROVIDER_ID, ...(settings?.customEndpoint?.baseUrl ? [CUSTOM_OPENAI_PROVIDER_ID] : [])];
}
