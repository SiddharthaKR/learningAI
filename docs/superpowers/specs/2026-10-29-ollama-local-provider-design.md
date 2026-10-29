# Local and custom AI provider design

## Intent

Let LearnHarness use Ollama models installed on the user's PC and one configurable OpenAI-compatible endpoint (such as vLLM) for every model-driven feature, including chat and teaching, practice, graph work, and background agents. This keeps the existing provider-neutral model slots and per-role overrides as the selection mechanism.

Gemma 4 is the primary compatibility case because it is the model family the user expects to use most. Ollama's catalog currently reports Gemma 4 variants with image input, tool, and thinking capabilities; those capabilities must come from runtime metadata rather than a hard-coded Gemma-specific entry.

## Goals and boundaries

- Add Ollama and one user-configured OpenAI-compatible endpoint as first-class providers in the existing model catalog and agent engine.
- Use Ollama's default local endpoint `http://localhost:11434` without requiring an API key.
- Let the user configure one custom endpoint URL entered as the OpenAI API base including `/v1` (for example, `http://host:8000/v1`). It has no API-key field.
- Discover Ollama's installed models and custom endpoint models through their respective APIs; allow manually entered custom model IDs when endpoint discovery is unavailable.
- Make these models selectable in the existing Strong, Cheap, and Vision slots and background-agent settings.
- Make local Ollama requests from the server-side app process. Custom endpoint requests go to that configured endpoint.
- Report unavailable Ollama and unsupported model capabilities clearly; do not silently switch providers.
- Keep existing cloud providers, stored chat data, and settings format compatible.

## Approaches

1. **Ollama-only provider.** Add a provider adapter/catalog path to pi-ai's existing engine integration and expose local models in the current picker. This covers local Ollama use but cannot connect to other hosted/local OpenAI-compatible servers.
2. **Configurable OpenAI-compatible endpoint only.** Reuse the app's existing OpenAI-compatible streaming API with a user-provided base URL. This can serve vLLM and similar servers but does not directly discover Ollama's installed models or capabilities.
3. **Both provider paths (chosen).** Add native Ollama discovery and one configurable OpenAI-compatible endpoint, each flowing through the same catalog, slots, and background-agent routing. This supports the requested local Ollama and hosted vLLM cases, with additional setup and capability-handling work.

The combined approach was selected to cover both installed local models and the requested custom hosted endpoint without adding per-feature routing.

## Constraints and builder calls

- Installed pi-ai has no built-in Ollama provider. Its mutable model collection can register a provider, and the app already centralizes provider lookup and streaming in `src/agent/models.ts`.
- The model picker currently federates providers only when an API key exists. Ollama and the custom endpoint must enter that flow through separate configured/available signals, including the first-run setup stage and no-key send guard.
- Ollama runtime discovery should list installed models and obtain model details/capabilities. The custom endpoint should query its OpenAI-compatible model-list API and permit manually entered model IDs if discovery fails or is unsupported. Catalog results must refresh so changed model lists can be seen without restarting the app.
- Persist one custom endpoint URL in app settings. Do not add an API-key field or multiple endpoint profiles.
- The provider must support streaming, tool calls, aborts, usage reporting where Ollama provides it, and image inputs only for models identified as vision-capable. Unsupported capabilities must not be advertised as supported.
- Ollama uses the fixed default address for this change; no address editor or remote Ollama support.
- The custom OpenAI-compatible endpoint can be local or hosted and is configured by URL. It has no authentication field in this scope.
- The app can only connect when Ollama or the configured endpoint is reachable from its process. Discovery/connection failures leave other providers usable and return an actionable status.

## Approval

This is the revised design for approval before implementation planning.
