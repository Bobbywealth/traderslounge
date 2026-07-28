"""Server-only MiniMax client for calendar-aware signal explanations."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

ENDPOINT = os.environ.get("MINIMAX_API_URL", "https://api.minimax.io/v1/chat/completions")
MODEL = os.environ.get("MINIMAX_MODEL", "MiniMax-M3")

SYSTEM_PROMPT = """You are ConfluenceX AI, a concise trading-analysis explainer.
Use only the structured scanner and economic-calendar facts supplied. Never invent prices or events.
Calendar BLOCKED and POST_NEWS statuses are deterministic no-trade conditions and cannot be overridden.
Return valid JSON only with: summary, setup_quality, confirmations, conflicts, calendar_risk, invalidation, wait_for, educational_note.
Do not provide guaranteed outcomes or execute trades."""


def configured() -> bool:
    return bool(os.environ.get("MINIMAX_API_KEY"))


def analyze(context: dict[str, Any]) -> dict[str, Any]:
    key = os.environ.get("MINIMAX_API_KEY")
    if not key:
        raise RuntimeError("MINIMAX_API_KEY is not configured")
    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(context, separators=(",", ":"))},
        ],
        "temperature": 0.2,
        "max_tokens": 2000,
        "stream": False,
    }).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT, data=payload, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:  # noqa: S310
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"MiniMax request failed ({exc.code})") from exc
    content = body.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    # MiniMax reasoning models may prefix a <think>...</think> block even
    # when JSON-only output is requested. Remove it before extracting JSON.
    if "</think>" in content:
        content = content.rsplit("</think>", 1)[1].strip()
    content = content.removeprefix("```json").removesuffix("```").strip()
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("MiniMax returned invalid structured output")
    try:
        result = json.loads(content[start:end + 1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("MiniMax returned invalid structured output") from exc
    return {"configured": True, "model": MODEL, "analysis": result}
