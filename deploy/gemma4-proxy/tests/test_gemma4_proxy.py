"""Tests for gemma4_proxy.py.

The original proxy (tests/legacy_proxy.py, as it ran on .126 before streaming)
is the baseline: every request that the old proxy answered must get the same
answer from the new one, so opencode and other clients keep working.

Run from deploy/gemma4-proxy:
  uv run --with fastapi --with httpx --with jinja2 python -m unittest discover -s tests -v
"""
import importlib.util
import json
import os
import pathlib
import unittest

import httpx
from fastapi.testclient import TestClient

HERE = pathlib.Path(__file__).parent
os.environ["TEMPLATE"] = str(HERE / "test_template.jinja")
os.environ["UPSTREAM"] = "http://lmstudio.test"


def load(name, path, **env):
    saved = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


NEW = HERE.parent / "gemma4_proxy.py"
OLD = HERE / "legacy_proxy.py"

Q = '<|"|>'
SAMPLES = {
    "plain": "Hello world, this is a plain answer.",
    "thought": "<|channel>thought\nLet me think about 2+2.<channel|>The answer is 4.",
    "call": f"Sure, checking.<|tool_call>call:research{{question:{Q}Latest Vivado?{Q},count:3}}<tool_call|>",
    "thought_and_call": f"<|channel>thought\nNeed a quiz.<channel|><|tool_call>call:quiz{{question:{Q}What is 2+2?{Q},options:[{Q}3{Q},{Q}4{Q}],strict:true}}<tool_call|>",
    "two_calls": f"<|tool_call>call:a{{x:1}}<tool_call|><|tool_call>call:b{{y:{Q}z{Q}}}<tool_call|>",
    "whitespace": "\n\n  Spaced answer with trailing space.  \n<eos>",
    "japanese": "<|channel>thought\n日本語で答える。<channel|>重力は時空の曲がりです。",
    "angle_brackets": "Use a < b and x <| y in code: `a<b`.",
    "multi_thought": "<|channel>thought\nFirst.<channel|>Middle text. <|channel>thought\nSecond.<channel|>End.",
}
QUIZ_JSON = 'Check:\n```json\n{"question": "What is gravity?", "options": ["force", "curvature"]}\n```'
TOOLS = [
    {"type": "function", "function": {"name": "quiz", "parameters": {"type": "object", "properties": {"question": {}, "options": {}}, "required": ["question", "options"]}}},
    {"type": "function", "function": {"name": "research", "parameters": {"type": "object", "properties": {"question": {}, "context": {}}, "required": ["question"]}}},
]


def upstream_handler(raw, *, piece=3, finish="stop", usage=None, fail_status=None):
    """A fake LM Studio /v1/completions: plain JSON or SSE, depending on the request."""
    def handler(request: httpx.Request):
        if fail_status:
            return httpx.Response(fail_status, text="model not loaded")
        body = json.loads(request.content)
        if not body.get("stream"):
            return httpx.Response(200, json={"choices": [{"text": raw, "finish_reason": finish}], "usage": usage or {"prompt_tokens": 5, "completion_tokens": 7}})
        lines = []
        for i in range(0, len(raw), piece):
            lines.append("data: " + json.dumps({"choices": [{"index": 0, "text": raw[i:i + piece], "finish_reason": None}]}))
        lines.append("data: " + json.dumps({"choices": [{"index": 0, "text": "", "finish_reason": finish}]}))
        if (body.get("stream_options") or {}).get("include_usage"):
            lines.append("data: " + json.dumps({"choices": [], "usage": usage or {"prompt_tokens": 5, "completion_tokens": 7}}))
        lines.append("data: [DONE]")
        return httpx.Response(200, text="\n\n".join(lines) + "\n\n", headers={"content-type": "text/event-stream"})
    return handler


def client_for(module, handler):
    module.client = httpx.AsyncClient(base_url="http://lmstudio.test", transport=httpx.MockTransport(handler))
    return TestClient(module.app)


def request_body(stream, **extra):
    return {"model": "gemma-4-26b", "messages": [{"role": "user", "content": "hi"}], "stream": stream, **extra}


def strip_ids(obj):
    """id/created differ per call; everything else must match."""
    obj = json.loads(json.dumps(obj))
    obj.pop("id", None)
    obj.pop("created", None)
    for choice in obj.get("choices", []):
        for part in (choice.get("message"), choice.get("delta")):
            for call in (part or {}).get("tool_calls") or []:
                call.pop("id", None)
    return obj


def sse_events(text):
    events = []
    for line in text.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            events.append(json.loads(line[len("data: "):]))
    return events


def assemble(events):
    """What an OpenAI-style client ends up with after reading the stream."""
    content, reasoning, calls, finish, usage = "", "", [], None, None
    for e in events:
        if "usage" in e and not e.get("choices"):
            usage = e["usage"]
        for c in e.get("choices", []):
            d = c.get("delta") or {}
            content += d.get("content") or ""
            reasoning += d.get("reasoning_content") or ""
            for t in d.get("tool_calls") or []:
                calls.append({"name": t["function"]["name"], "arguments": json.loads(t["function"]["arguments"])})
            finish = c.get("finish_reason") or finish
    return {"content": content, "reasoning": reasoning, "calls": calls, "finish": finish, "usage": usage}


class NonStreamingUnchanged(unittest.TestCase):
    """stream=false: byte-for-byte the old answer (apart from random ids)."""

    def test_every_sample_matches_the_old_proxy(self):
        old, new = load("legacy_a", OLD), load("new_a", NEW)
        for name, raw in {**SAMPLES, "quiz_json": QUIZ_JSON}.items():
            with self.subTest(sample=name):
                a = client_for(old, upstream_handler(raw)).post("/v1/chat/completions", json=request_body(False, tools=TOOLS)).json()
                b = client_for(new, upstream_handler(raw)).post("/v1/chat/completions", json=request_body(False, tools=TOOLS)).json()
                self.assertEqual(strip_ids(a), strip_ids(b))

    def test_upstream_error_is_the_same_502(self):
        old, new = load("legacy_b", OLD), load("new_b", NEW)
        for stream in (False, True):
            with self.subTest(stream=stream):
                a = client_for(old, upstream_handler("", fail_status=500)).post("/v1/chat/completions", json=request_body(stream))
                b = client_for(new, upstream_handler("", fail_status=500)).post("/v1/chat/completions", json=request_body(stream))
                self.assertEqual((a.status_code, a.json()), (b.status_code, b.json()))
                self.assertEqual(b.status_code, 502)


class Streaming(unittest.TestCase):
    def test_streamed_result_equals_the_old_streamed_result(self):
        """Whatever the chunking, a client ends up with exactly what the old proxy sent."""
        old, new = load("legacy_c", OLD), load("new_c", NEW)
        for name, raw in SAMPLES.items():
            for piece in (1, 2, 5, 64):
                with self.subTest(sample=name, piece=piece):
                    body = request_body(True, stream_options={"include_usage": True})
                    a = assemble(sse_events(client_for(old, upstream_handler(raw, piece=piece)).post("/v1/chat/completions", json=body).text))
                    b = assemble(sse_events(client_for(new, upstream_handler(raw, piece=piece)).post("/v1/chat/completions", json=body).text))
                    self.assertEqual(a, b)

    def test_text_arrives_in_many_pieces(self):
        new = load("new_d", NEW)
        raw = "Gravity is not a force; it is the shape of spacetime around mass. " * 4
        events = sse_events(client_for(new, upstream_handler(raw, piece=4)).post("/v1/chat/completions", json=request_body(True)).text)
        pieces = [e for e in events if (e["choices"] and (e["choices"][0]["delta"].get("content")))]
        self.assertGreater(len(pieces), 20, "content is forwarded as it is written, not in one block")

    def test_tool_call_text_never_leaks_into_content(self):
        new = load("new_e", NEW)
        for name in ("call", "thought_and_call", "two_calls"):
            for piece in (1, 3):
                with self.subTest(sample=name, piece=piece):
                    events = sse_events(client_for(new, upstream_handler(SAMPLES[name], piece=piece)).post("/v1/chat/completions", json=request_body(True)).text)
                    content = "".join((e["choices"][0]["delta"].get("content") or "") for e in events if e["choices"])
                    self.assertNotIn("<|", content)
                    self.assertNotIn("call:", content)

    def test_stream_off_switch_gives_the_old_stream_exactly(self):
        old, new = load("legacy_f", OLD), load("new_f", NEW, STREAM="0")
        raw = SAMPLES["thought_and_call"]
        a = sse_events(client_for(old, upstream_handler(raw)).post("/v1/chat/completions", json=request_body(True)).text)
        b = sse_events(client_for(new, upstream_handler(raw)).post("/v1/chat/completions", json=request_body(True)).text)
        self.assertEqual([strip_ids(e) for e in a], [strip_ids(e) for e in b])

    def test_splitter_never_shows_a_partial_tag(self):
        new = load("new_g", NEW)
        raw = SAMPLES["thought_and_call"] + " trailing"
        splitter = new.StreamSplitter()
        shown = ""
        for ch in raw:
            for key, delta in splitter.feed(ch):
                if key == "content":
                    shown += delta
                    self.assertNotIn("<", shown)
        self.assertEqual(shown, "")


class NamespacedToolNames(unittest.TestCase):
    """Gemma 4 26B wrote `call:default:probe{…}` (2026-11-19). The old pattern
    allowed no ':' in names, so the call leaked into the chat as text."""

    RAW = f"Next question.<|tool_call>call:default:probe{{question:{Q}Why?{Q}}}<tool_call|>"

    def test_old_proxy_leaked_it(self):
        old = load("legacy_k", OLD)
        msg = client_for(old, upstream_handler(self.RAW)).post("/v1/chat/completions", json=request_body(False)).json()["choices"][0]["message"]
        self.assertNotIn("tool_calls", msg)
        self.assertIn("call:default:probe", msg["content"])

    def test_new_proxy_returns_it_as_a_call(self):
        new = load("new_k", NEW)
        for stream in (False, True):
            with self.subTest(stream=stream):
                r = client_for(new, upstream_handler(self.RAW)).post("/v1/chat/completions", json=request_body(stream))
                if stream:
                    got = assemble(sse_events(r.text))
                else:
                    m = r.json()["choices"][0]["message"]
                    got = {"content": m["content"], "calls": [{"name": c["function"]["name"], "arguments": json.loads(c["function"]["arguments"])} for c in m["tool_calls"]]}
                self.assertEqual(got["calls"], [{"name": "default:probe", "arguments": {"question": "Why?"}}])
                self.assertEqual(got["content"], "Next question.")


class ThoughtWithoutOpener(unittest.TestCase):
    """Owner report (2026-11-19, Gemma 4 26B on .126): replies began with the
    literal 'thought' and '<channel|>' — the opening '<|channel>' marker never
    reached the text, so the thinking leaked into the answer and the thinking
    panel stayed empty."""

    RAW = "thought\nThe learner picked Interference; correct is Entanglement.<channel|>That was a miss. The answer is Entanglement."

    def test_old_proxy_leaked_it(self):
        old = load("legacy_t", OLD)
        msg = client_for(old, upstream_handler(self.RAW)).post("/v1/chat/completions", json=request_body(False)).json()["choices"][0]["message"]
        self.assertIn("<channel|>", msg["content"])

    def test_new_proxy_splits_thinking_from_the_answer(self):
        new = load("new_t", NEW)
        for stream in (False, True):
            for piece in (1, 3, 64):
                with self.subTest(stream=stream, piece=piece):
                    r = client_for(new, upstream_handler(self.RAW, piece=piece)).post("/v1/chat/completions", json=request_body(stream))
                    if stream:
                        got = assemble(sse_events(r.text))
                        content, reasoning = got["content"], got["reasoning"]
                    else:
                        m = r.json()["choices"][0]["message"]
                        content, reasoning = m["content"], m.get("reasoning_content", "")
                    self.assertEqual(content, "That was a miss. The answer is Entanglement.")
                    self.assertEqual(reasoning, "The learner picked Interference; correct is Entanglement.")

    def test_a_normal_answer_starting_with_the_word_thought_is_untouched(self):
        new = load("new_t2", NEW)
        raw = "thought experiments help here: imagine a train moving at near light speed."
        for stream in (False, True):
            with self.subTest(stream=stream):
                r = client_for(new, upstream_handler(raw, piece=2)).post("/v1/chat/completions", json=request_body(stream))
                content = assemble(sse_events(r.text))["content"] if stream else r.json()["choices"][0]["message"]["content"]
                self.assertEqual(content, raw)


class JsonToolCalls(unittest.TestCase):
    def test_off_by_default(self):
        new = load("new_h", NEW)
        msg = client_for(new, upstream_handler(QUIZ_JSON)).post("/v1/chat/completions", json=request_body(False, tools=TOOLS)).json()["choices"][0]["message"]
        self.assertNotIn("tool_calls", msg)
        self.assertEqual(msg["content"], QUIZ_JSON)

    def test_on_turns_an_unambiguous_block_into_a_call(self):
        new = load("new_i", NEW, JSON_TOOL_CALLS="1")
        for stream in (False, True):
            with self.subTest(stream=stream):
                r = client_for(new, upstream_handler(QUIZ_JSON, piece=3)).post("/v1/chat/completions", json=request_body(stream, tools=TOOLS))
                if stream:
                    got = assemble(sse_events(r.text))
                    content, calls, finish = got["content"], got["calls"], got["finish"]
                else:
                    choice = r.json()["choices"][0]
                    content, finish = choice["message"]["content"], choice["finish_reason"]
                    calls = [{"name": c["function"]["name"], "arguments": json.loads(c["function"]["arguments"])} for c in choice["message"]["tool_calls"]]
                self.assertEqual(calls, [{"name": "quiz", "arguments": {"question": "What is gravity?", "options": ["force", "curvature"]}}])
                self.assertEqual(finish, "tool_calls")
                self.assertEqual(content, "Check:")

    def test_on_leaves_ordinary_json_alone(self):
        new = load("new_j", NEW, JSON_TOOL_CALLS="1")
        for raw in ('Config:\n```json\n{"port": 3000}\n```', 'Ambiguous:\n```json\n{"question": "x"}\n```'):
            with self.subTest(raw=raw):
                tools = TOOLS + [{"type": "function", "function": {"name": "ask", "parameters": {"properties": {"question": {}}, "required": ["question"]}}}]
                msg = client_for(new, upstream_handler(raw)).post("/v1/chat/completions", json=request_body(False, tools=tools)).json()["choices"][0]["message"]
                self.assertNotIn("tool_calls", msg)
                self.assertEqual(msg["content"], raw)


if __name__ == "__main__":
    unittest.main()
