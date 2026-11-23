#!/usr/bin/env python3
"""
gemma4_proxy.py - OpenAI-compatible /v1/chat/completions shim for Gemma 4 on LM Studio.

Why: LM Studio's minja engine fails on Gemma 4's tool-calling template
("Cannot call something that is not a function: got UndefinedValue").
This proxy renders the template with real Jinja2, sends the raw prompt to
LM Studio's /v1/completions (no template involved), and parses Gemma 4's
<|tool_call>call:name{...}<tool_call|> output back into OpenAI tool_calls.

Run:
  UPSTREAM=http://172.20.1.126:1234 TEMPLATE=./gemma4_chat_template.jinja \
  uvicorn gemma4_proxy:app --host 127.0.0.1 --port 8088

Env:
  UPSTREAM        LM Studio base URL           (default http://172.20.1.126:1234)
  TEMPLATE        .jinja file, or tokenizer_config.json containing "chat_template"
  THINKING        1 = pass enable_thinking=True to the template (default 0).
                  A request's chat_template_kwargs.enable_thinking (true/false)
                  overrides it per request; LearnHarness sends it on every call
                  from the user's Reasoning preference.
  DEBUG           1 = print rendered prompt and raw model output
  STREAM          0 = old behaviour for stream=true requests: wait for the whole
                  reply, then send it as a few SSE chunks (default 1 = real
                  token-by-token streaming)
  JSON_TOOL_CALLS 1 = also accept a tool call the model writes as a ```json block
                  ({"name","arguments"}, or an object fitting exactly one
                  tool's parameters) (default 0 = off)

stream=false requests behave exactly as before, whatever STREAM is set to.
"""
import json
import os
import re
import time
import uuid
from datetime import datetime

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from jinja2 import TemplateError
from jinja2.sandbox import ImmutableSandboxedEnvironment

UPSTREAM = os.environ.get("UPSTREAM", "http://172.20.1.126:1234").rstrip("/")
TEMPLATE_PATH = os.environ.get("TEMPLATE", "gemma4_chat_template.jinja")
THINKING = os.environ.get("THINKING", "0") == "1"
DEBUG = os.environ.get("DEBUG", "0") == "1"
STREAM = os.environ.get("STREAM", "1") != "0"
JSON_TOOL_CALLS = os.environ.get("JSON_TOOL_CALLS", "0") == "1"

# <|tool_response> is a stop sequence: the model halts after a call and waits for the result.
STOP = ["<turn|>", "<|tool_response>"]
Q = '<|"|>'  # Gemma 4 string delimiter token

# ---------------------------------------------------------------- template (HF-compatible Jinja env)
def _raise(msg):
    raise TemplateError(msg)

env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True,
                                    extensions=["jinja2.ext.loopcontrols"])
env.filters["tojson"] = lambda x, indent=None, separators=None, sort_keys=False, ensure_ascii=False: \
    json.dumps(x, indent=indent, separators=separators, sort_keys=sort_keys, ensure_ascii=ensure_ascii)
env.globals["raise_exception"] = _raise
env.globals["strftime_now"] = lambda fmt: datetime.now().strftime(fmt)

def load_template(path):
    with open(path, encoding="utf-8") as f:
        txt = f.read()
    if path.endswith(".json"):
        ct = json.loads(txt)["chat_template"]
        if isinstance(ct, list):  # [{"name": "default", "template": ...}, ...]
            ct = next(t["template"] for t in ct if t.get("name") == "default")
        txt = ct
    return env.from_string(txt)

TEMPLATE = load_template(TEMPLATE_PATH)

def normalize(messages):
    """OpenAI-style history -> what HF templates expect (dict args, tool names on tool msgs)."""
    out, id2name = [], {}
    for m in messages:
        m = json.loads(json.dumps(m))
        if isinstance(m.get("content"), list):  # content parts -> text only
            m["content"] = "".join(p.get("text", "") for p in m["content"] if p.get("type") == "text")
        if m.get("content") is None:
            m["content"] = ""
        for tc in m.get("tool_calls") or []:
            fn = tc.get("function", {})
            if isinstance(fn.get("arguments"), str):
                try:
                    fn["arguments"] = json.loads(fn["arguments"] or "{}")
                except json.JSONDecodeError:
                    pass
            id2name[tc.get("id")] = fn.get("name")
        if m.get("role") == "tool" and not m.get("name"):
            m["name"] = id2name.get(m.get("tool_call_id"), "tool")
        out.append(m)
    return out

def thinking_for(body):
    """The request's chat_template_kwargs.enable_thinking when it is a bool, else THINKING."""
    kwargs = body.get("chat_template_kwargs")
    value = kwargs.get("enable_thinking") if isinstance(kwargs, dict) else None
    return value if isinstance(value, bool) else THINKING

def render(body):
    kw = dict(messages=normalize(body["messages"]), add_generation_prompt=True,
              bos_token="", eos_token="<eos>", enable_thinking=thinking_for(body))
    if body.get("tools"):
        kw["tools"] = body["tools"]
    prompt = TEMPLATE.render(**kw)
    if prompt.startswith("<bos>"):  # LM Studio adds BOS itself (prompt_tokens test: 11 + 1)
        prompt = prompt[len("<bos>"):]
    return prompt

# ---------------------------------------------------------------- Gemma 4 argument parser
class _P:
    """Parses Gemma 4 compact args: {key:<|"|>str<|"|>,n:5,flag:true,obj:{...},arr:[...]}"""
    def __init__(s, t):
        s.t, s.i = t, 0

    def ws(s):
        while s.i < len(s.t) and s.t[s.i] in " \t\r\n":
            s.i += 1

    def value(s):
        s.ws()
        t = s.t
        if t.startswith(Q, s.i):
            j = t.index(Q, s.i + len(Q))
            v = t[s.i + len(Q):j]
            s.i = j + len(Q)
            return v
        if t[s.i] == '"':  # tolerate plain JSON strings
            v, end = json.JSONDecoder().raw_decode(t, s.i)
            s.i = end
            return v
        if t[s.i] == "{":
            return s.obj()
        if t[s.i] == "[":
            return s.arr()
        m = re.compile(r"[^,}\]]*").match(t, s.i)
        raw = m.group().strip()
        s.i = m.end()
        if raw in ("true", "false"):
            return raw == "true"
        if raw in ("null", "None"):
            return None
        for cast in (int, float):
            try:
                return cast(raw)
            except ValueError:
                pass
        return raw

    def obj(s):
        s.i += 1  # '{'
        d = {}
        while True:
            s.ws()
            if s.t[s.i] == "}":
                s.i += 1
                return d
            if s.t.startswith(Q, s.i) or s.t[s.i] == '"':
                k = s.value()
            else:
                j = s.t.index(":", s.i)
                k = s.t[s.i:j].strip()
                s.i = j
            s.ws()
            s.i += 1  # ':'
            d[k] = s.value()
            s.ws()
            if s.t[s.i] == ",":
                s.i += 1

    def arr(s):
        s.i += 1  # '['
        a = []
        while True:
            s.ws()
            if s.t[s.i] == "]":
                s.i += 1
                return a
            a.append(s.value())
            s.ws()
            if s.t[s.i] == ",":
                s.i += 1

# ':' allowed in names: Gemma 4 sometimes writes `call:default:probe{…}`; the
# client maps the namespaced name to its tool (LearnHarness does).
CALL_RE = re.compile(r"<\|tool_call>call:([\w\-.:]+?)\{(.*?)\}(?=<tool_call\|>|<turn\|>|<\|tool_response>|<\|tool_call>|\s*$)", re.S)
THOUGHT_RE = re.compile(r"<\|channel>(?:thought)?\n?(.*?)<channel\|>", re.S)

def restore_thought_opener(text):
    """Gemma sometimes emits its thinking with the opening '<|channel>' marker
    missing from the text: the reply starts 'thought\\n…' and the thinking ends
    at '<channel|>' (seen on .126, 2026-11-19). Put the opener back so the
    thinking is parsed as thinking instead of leaking into the answer."""
    stripped = text.lstrip()
    if stripped.startswith("thought\n") and "<channel|>" in stripped and "<|channel>" not in stripped.split("<channel|>", 1)[0]:
        return "<|channel>" + stripped
    return text

def parse_output(text):
    text = restore_thought_opener(text)
    reasoning = "\n".join(x.strip() for x in THOUGHT_RE.findall(text)).strip()
    text = THOUGHT_RE.sub("", text)
    calls = []
    for name, args in CALL_RE.findall(text):
        try:
            parsed = _P("{" + args + "}").obj()
        except Exception:
            parsed = {"_raw": args}
        calls.append({"id": "call_" + uuid.uuid4().hex[:24], "type": "function",
                      "function": {"name": name, "arguments": json.dumps(parsed, ensure_ascii=False)}})
    content = CALL_RE.sub("", text)
    for tok in ("<tool_call|>", "<turn|>", "<|tool_response>", "<eos>"):
        content = content.replace(tok, "")
    return content.strip(), reasoning, calls

# ---------------------------------------------------------------- optional: tool calls written as ```json (JSON_TOOL_CALLS=1)
FENCE_RE = re.compile(r"```(?:json|jsonc)?[ \t]*\n(.*?)\n?```", re.S)

def _tool_for(obj, tools):
    """The (name, arguments) this JSON object unambiguously calls, or None."""
    by_name = {}
    for t in tools or []:
        fn = t.get("function") or {}
        if fn.get("name"):
            by_name[fn["name"]] = fn.get("parameters") or {}
    args = obj.get("arguments", obj.get("parameters"))
    if isinstance(obj.get("name"), str) and isinstance(args, dict):
        return (obj["name"], args) if obj["name"] in by_name else None
    fits = []
    for name, params in by_name.items():
        props = set((params.get("properties") or {}).keys())
        required = params.get("required") or []
        if required and all(k in obj for k in required) and all(k in props for k in obj):
            fits.append(name)
    return (fits[0], obj) if len(fits) == 1 else None

def json_tool_calls(content, tools):
    """Turn ```json blocks that are unambiguous tool calls into tool_calls; other text is unchanged."""
    calls = []

    def replace(m):
        try:
            obj = json.loads(m.group(1))
        except ValueError:
            return m.group(0)
        hit = _tool_for(obj, tools) if isinstance(obj, dict) else None
        if not hit:
            return m.group(0)
        calls.append({"id": "call_" + uuid.uuid4().hex[:24], "type": "function",
                      "function": {"name": hit[0], "arguments": json.dumps(hit[1], ensure_ascii=False)}})
        return ""

    rest = FENCE_RE.sub(replace, content)
    return (rest.strip(), calls) if calls else (content, [])

# ---------------------------------------------------------------- streaming
OPENERS = ("<|channel>", "<|tool_call>")
TAGS = ("<|channel>", "<channel|>", "<|tool_call>", "<tool_call|>", "<turn|>", "<|tool_response>", "<eos>")

def _hold_partial_tag(seg):
    """Cut a trailing piece that may be the start of a special tag (e.g. '<|tool_c')."""
    k = seg.rfind("<")
    if k != -1 and any(tag.startswith(seg[k:]) for tag in TAGS):
        return seg[:k]
    return seg

class StreamSplitter:
    """Turns the raw completion text, as it grows, into reasoning and content
    that are safe to show now. A tool call is never shown: content stops at
    `<|tool_call>` and whatever follows is settled by parse_output at the end,
    so the final content is exactly what the non-streaming path returns."""

    def __init__(self, hold_fences=False):
        self.raw = ""
        self.sent_content = ""
        self.sent_reasoning = ""
        self.hold_fences = hold_fences

    def _view(self):
        raw = self.raw
        stripped = raw.lstrip()
        if "<|channel>" not in raw:
            if "thought\n".startswith(stripped):
                return "", ""  # could still become 'thought\n…' — wait for more
            if stripped.startswith("thought\n"):
                # Opener missing (see restore_thought_opener): stream it as
                # thinking; if no '<channel|>' ever comes, finish() still
                # sends the full text as the answer.
                raw = "<|channel>" + stripped
        reasoning, content, i = [], [], 0
        while True:
            hits = [p for p in (raw.find(o, i) for o in OPENERS) if p != -1]
            if not hits:
                content.append(_hold_partial_tag(raw[i:]))
                break
            nxt = min(hits)
            content.append(raw[i:nxt])
            if not raw.startswith("<|channel>", nxt):
                break  # a tool call: show nothing after it until the end
            end = raw.find("<channel|>", nxt)
            inner = raw[nxt + len("<|channel>"):end if end != -1 else len(raw)]
            if end == -1:
                inner = _hold_partial_tag(inner)
                if len(inner) < len("thought\n") and "thought\n".startswith(inner):
                    inner = ""  # not sure yet whether this is the "thought" label
            inner = re.sub(r"^(?:thought)?\n?", "", inner)
            reasoning.append(inner.strip() if end != -1 else inner.lstrip())
            if end == -1:
                break
            i = end + len("<channel|>")
        text = "".join(content)
        for tok in ("<tool_call|>", "<turn|>", "<|tool_response>", "<eos>"):
            text = text.replace(tok, "")
        if self.hold_fences:
            if "```" in text:
                text = text[:text.index("```")]
            text = text.rstrip("`")  # a fence may be arriving one backtick at a time
        # parse_output strips the final content: never send leading spaces,
        # and hold trailing ones until more text follows.
        return "\n".join(r for r in reasoning if r), text.strip()

    def _deltas(self, reasoning, content):
        out = []
        if reasoning.startswith(self.sent_reasoning) and len(reasoning) > len(self.sent_reasoning):
            out.append(("reasoning_content", reasoning[len(self.sent_reasoning):]))
            self.sent_reasoning = reasoning
        if content.startswith(self.sent_content) and len(content) > len(self.sent_content):
            out.append(("content", content[len(self.sent_content):]))
            self.sent_content = content
        return out

    def feed(self, text):
        self.raw += text
        return self._deltas(*self._view())

    def finish(self, content, reasoning):
        """content/reasoning: the final values from parse_output (+ JSON fallback)."""
        return self._deltas(reasoning, content)

# ---------------------------------------------------------------- server
app = FastAPI()
client = httpx.AsyncClient(base_url=UPSTREAM, timeout=600, trust_env=False)  # trust_env=False = --noproxy

PASSTHRU = ("temperature", "top_p", "top_k", "seed", "presence_penalty", "frequency_penalty", "repeat_penalty")

@app.get("/v1/models")
async def models():
    r = await client.get("/v1/models")
    return JSONResponse(r.json(), status_code=r.status_code)

@app.post("/v1/chat/completions")
async def chat(req: Request):
    body = await req.json()
    try:
        prompt = render(body)
    except TemplateError as e:
        return JSONResponse({"error": {"message": f"template render failed: {e}"}}, status_code=400)
    if DEBUG:
        print("=== PROMPT ===\n" + prompt)

    payload = {"model": body.get("model"), "prompt": prompt,
               "max_tokens": body.get("max_tokens") or body.get("max_completion_tokens") or 4096,
               "stop": STOP + list(body.get("stop") or [])}
    payload.update({k: body[k] for k in PASSTHRU if k in body})
    if body.get("stream") and STREAM:
        return await stream_chat(body, payload)
    try:
        r = await client.post("/v1/completions", json=payload)
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        return JSONResponse({"error": {"message": e.response.text}}, status_code=502)
    except httpx.HTTPError as e:
        return JSONResponse({"error": {"message": f"upstream unreachable: {e}"}}, status_code=502)
    up = r.json()

    raw = up["choices"][0]["text"]
    if DEBUG:
        print("=== RAW OUTPUT ===\n" + raw)
    content, reasoning, calls = parse_output(raw)
    if JSON_TOOL_CALLS and not calls and body.get("tools"):
        content, calls = json_tool_calls(content, body["tools"])
    finish = "tool_calls" if calls else up["choices"][0].get("finish_reason") or "stop"
    cid, created, model = "chatcmpl-" + uuid.uuid4().hex[:24], int(time.time()), body.get("model")

    msg = {"role": "assistant", "content": content if (content or not calls) else None}
    if reasoning:
        msg["reasoning_content"] = reasoning
    if calls:
        msg["tool_calls"] = calls

    if not body.get("stream"):
        return {"id": cid, "object": "chat.completion", "created": created, "model": model,
                "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                "usage": up.get("usage", {})}

    # stream=true: emit the finished result as SSE chunks (no token-by-token streaming)
    def sse():
        base = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model}

        def chunk(delta, fr=None):
            return "data: " + json.dumps({**base, "choices": [{"index": 0, "delta": delta, "finish_reason": fr}]},
                                         ensure_ascii=False) + "\n\n"

        yield chunk({"role": "assistant"})
        if reasoning:
            yield chunk({"reasoning_content": reasoning})
        if content:
            yield chunk({"content": content})
        if calls:
            yield chunk({"tool_calls": [{"index": i, **c} for i, c in enumerate(calls)]})
        yield chunk({}, finish)
        if (body.get("stream_options") or {}).get("include_usage"):
            yield "data: " + json.dumps({**base, "choices": [], "usage": up.get("usage", {})}) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


async def stream_chat(body, payload):
    """stream=true: forward text and thinking as LM Studio writes them.
    Tool calls are sent once complete, parsed exactly as in the non-streaming path."""
    include_usage = bool((body.get("stream_options") or {}).get("include_usage"))
    upstream_payload = {**payload, "stream": True}
    if include_usage:
        upstream_payload["stream_options"] = {"include_usage": True}
    try:
        resp = await client.send(client.build_request("POST", "/v1/completions", json=upstream_payload), stream=True)
    except httpx.HTTPError as e:
        return JSONResponse({"error": {"message": f"upstream unreachable: {e}"}}, status_code=502)
    if resp.status_code >= 400:
        text = (await resp.aread()).decode("utf-8", "replace")
        await resp.aclose()
        return JSONResponse({"error": {"message": text}}, status_code=502)

    cid, created, model = "chatcmpl-" + uuid.uuid4().hex[:24], int(time.time()), body.get("model")
    base = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model}
    tools = body.get("tools")
    json_calls = JSON_TOOL_CALLS and bool(tools)

    def chunk(delta, fr=None):
        return "data: " + json.dumps({**base, "choices": [{"index": 0, "delta": delta, "finish_reason": fr}]},
                                     ensure_ascii=False) + "\n\n"

    async def sse():
        splitter = StreamSplitter(hold_fences=json_calls)
        finish, usage = None, None
        try:
            yield chunk({"role": "assistant"})
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except ValueError:
                    continue
                if event.get("usage"):
                    usage = event["usage"]
                for choice in event.get("choices") or []:
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
                    for key, delta in splitter.feed(choice.get("text") or ""):
                        yield chunk({key: delta})
        except httpx.HTTPError as e:
            # Connection lost mid-reply: say so instead of ending silently.
            yield "data: " + json.dumps({"error": {"message": f"upstream stream failed: {e}"}}) + "\n\n"
            yield "data: [DONE]\n\n"
            return
        finally:
            await resp.aclose()

        if DEBUG:
            print("=== RAW OUTPUT ===\n" + splitter.raw)
        content, reasoning, calls = parse_output(splitter.raw)
        if json_calls and not calls:
            content, calls = json_tool_calls(content, tools)
        for key, delta in splitter.finish(content, reasoning):
            yield chunk({key: delta})
        if calls:
            yield chunk({"tool_calls": [{"index": i, **c} for i, c in enumerate(calls)]})
        yield chunk({}, "tool_calls" if calls else finish or "stop")
        if include_usage:
            yield "data: " + json.dumps({**base, "choices": [], "usage": usage or {}}) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")
