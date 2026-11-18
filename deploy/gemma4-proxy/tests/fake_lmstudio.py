"""A slow fake LM Studio for live proxy checks: /v1/completions writes a fixed
Gemma-format reply (thinking, text, optional tool call) one piece every DELAY seconds.

  RAW_FILE=reply.txt DELAY=0.1 uvicorn fake_lmstudio:app --port 1299
"""
import asyncio
import json
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

DELAY = float(os.environ.get("DELAY", "0.1"))
PIECE = int(os.environ.get("PIECE", "6"))
RAW = open(os.environ["RAW_FILE"], encoding="utf-8").read() if os.environ.get("RAW_FILE") else (
    "<|channel>thought\nThe learner wants an intuitive picture.<channel|>"
    "Gravity is not a pull. Mass curves spacetime, and objects follow the straightest path through that curve. "
    "A black hole is where the curve is so steep that no path leads back out.")

app = FastAPI()


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": "gemma-4-26b", "object": "model"}]}


@app.post("/v1/completions")
async def completions(req: Request):
    body = await req.json()
    if not body.get("stream"):
        await asyncio.sleep(DELAY * (len(RAW) // PIECE + 1))
        return JSONResponse({"choices": [{"text": RAW, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 50}})

    async def events():
        for i in range(0, len(RAW), PIECE):
            await asyncio.sleep(DELAY)
            yield "data: " + json.dumps({"choices": [{"index": 0, "text": RAW[i:i + PIECE], "finish_reason": None}]}) + "\n\n"
        yield "data: " + json.dumps({"choices": [{"index": 0, "text": "", "finish_reason": "stop"}]}) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
