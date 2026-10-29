const base = process.env.LLM_BASE_URL?.trim();
const model = process.env.LLM_MODEL?.trim();
const key = process.env.LLM_API_KEY?.trim();
const contextWindow = Number(process.env.LLM_CONTEXT_WINDOW);
const maxTokens = Number(process.env.LLM_MAX_TOKENS);

function fail(message) {
  console.error(`smoke:llm: ${message}`);
  process.exitCode = 1;
}

if (!base || !model) {
  fail('Set LLM_BASE_URL and LLM_MODEL in .env or the process environment.');
} else if (!Number.isSafeInteger(contextWindow) || contextWindow < 1 || !Number.isSafeInteger(maxTokens) || maxTokens < 1) {
  fail('Set positive integer LLM_CONTEXT_WINDOW and LLM_MAX_TOKENS in .env or the process environment.');
} else if (maxTokens >= contextWindow) {
  fail('LLM_MAX_TOKENS must be smaller than LLM_CONTEXT_WINDOW.');
} else {
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.replace(/\/$/u, '').endsWith('/v1')) {
      throw new Error('LLM_BASE_URL must be an HTTP(S) API base ending in /v1');
    }
    const endpoint = new URL(`${url.pathname.replace(/\/$/u, '')}/chat/completions`, url.origin);
    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;

    async function complete(label, body) {
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, stream: false, ...body }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        throw new Error(`${label}: cannot reach ${endpoint}: ${error.message}`);
      }
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`${label}: HTTP ${response.status} from ${endpoint}: ${raw.slice(0, 500)}`);
      }
      try {
        return JSON.parse(raw).choices?.[0]?.message;
      } catch {
        throw new Error(`${label}: server returned invalid JSON: ${raw.slice(0, 500)}`);
      }
    }

    try {
      const modelsEndpoint = new URL(`${url.pathname.replace(/\/$/u, '')}/models`, url.origin);
      const modelsResponse = await fetch(modelsEndpoint, { headers, signal: AbortSignal.timeout(10_000) });
      if (!modelsResponse.ok) throw new Error(`HTTP ${modelsResponse.status}`);
      const models = await modelsResponse.json();
      const selected = models?.data?.find((entry) => entry?.id === model);
      if (!selected) {
        console.warn(`smoke:llm: warning: ${model} is absent from /models; context limit could not be verified`);
      } else if (selected.max_model_len === undefined || selected.max_model_len === null) {
        console.warn('smoke:llm: warning: /models has no max_model_len for this model; context limit could not be verified');
      } else {
        const capacity = Number(selected.max_model_len);
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('invalid max_model_len in /models');
        if (capacity < contextWindow) throw new Error(`model max_model_len ${capacity} is below LLM_CONTEXT_WINDOW ${contextWindow}`);
        console.log(`smoke:llm: context window OK (${contextWindow} <= ${capacity})`);
      }
    } catch (error) {
      if (error.message.startsWith('model max_model_len') || error.message === 'invalid max_model_len in /models') throw error;
      console.warn(`smoke:llm: warning: /models unavailable (${error.message}); context limit could not be verified`);
    }

    const plain = await complete('plain chat', {
      messages: [{ role: 'user', content: 'Reply with a short greeting.' }],
    });
    if (typeof plain?.content !== 'string' || !plain.content.trim()) {
      throw new Error('plain chat: response lacks nonempty choices[0].message.content');
    }
    console.log(`smoke:llm: plain chat OK (${model})`);

    const toolName = 'report_smoke_result';
    const tool = await complete('tool call', {
      messages: [{ role: 'user', content: `Call the ${toolName} tool with value "ready". Do not answer in text.` }],
      tools: [{ type: 'function', function: {
        name: toolName,
        description: 'Report the smoke check result.',
        parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      } }],
      tool_choice: 'auto',
    });
    if (!Array.isArray(tool?.tool_calls) || !tool.tool_calls.some((call) => call?.type === 'function' && call.function?.name === toolName)) {
      throw new Error('tool call: response lacks choices[0].message.tool_calls with report_smoke_result; check model tool support');
    }
    console.log(`smoke:llm: tool_calls OK (${model})`);
  } catch (error) {
    fail(error.message);
  }
}
