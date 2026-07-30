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

CHART_SYSTEM_PROMPT = """You are ConfluenceX Chart AI, analyzing a trading chart image together with deterministic market context.
Inspect the visible candles, trend, structure, support/resistance, volume if visible, chart overlays, and the supplied technical context.
Do not invent a price that is not visible or present in the supplied context. If the image and structured data disagree, call out the conflict.
Calendar BLOCKED and POST_NEWS statuses are deterministic no-trade conditions and cannot be overridden.
Do not create execution rules, promise outcomes, or execute trades. Return valid JSON only with:
summary, visual_bias, confidence, visible_patterns, key_levels, confirmations, conflicts, risk_factors, wait_for, invalidation, educational_note.
key_levels must be an array of objects with label, price, and reason. Use an empty array when a level cannot be grounded."""


def _extract_json(content: str) -> dict[str, Any]:
    content = (content or "").strip()
    if "</think>" in content:
        content = content.rsplit("</think>", 1)[1].strip()
    content = content.removeprefix("```json").removesuffix("```").strip()
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("MiniMax returned invalid structured output")
    try:
        return json.loads(content[start:end + 1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("MiniMax returned invalid structured output") from exc


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
        "max_tokens": 1200,
        "thinking": {"type": "disabled"},
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
    content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    return {"configured": True, "model": MODEL, "analysis": _extract_json(content)}


def analyze_chart(context: dict[str, Any], image_data_url: str) -> dict[str, Any]:
    """Analyze a chart screenshot with grounded structured market context."""
    key = os.environ.get("MINIMAX_API_KEY")
    if not key:
        raise RuntimeError("MINIMAX_API_KEY is not configured")
    if not isinstance(image_data_url, str) or not image_data_url.startswith("data:image/"):
        raise RuntimeError("chart image must be a data URL")
    if len(image_data_url) > 10 * 1024 * 1024:
        raise RuntimeError("chart image exceeds the 10 MB limit")

    user_text = json.dumps({
        "instruction": "Analyze the supplied chart image and reconcile it with this deterministic context.",
        "chart_context": context,
    }, separators=(",", ":"))
    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": CHART_SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}},
            ]},
        ],
        "temperature": 0.2,
        "max_tokens": 1400,
        "thinking": {"type": "disabled"},
        "stream": False,
    }).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT, data=payload, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"MiniMax chart request failed ({exc.code})") from exc
    content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    try:
        result = _extract_json(content)
    except RuntimeError:
        # Vision models can occasionally ignore JSON-only output. Preserve the
        # useful visual response instead of turning a successful AI call into
        # a UI error; deterministic context remains the authority.
        visual_bias = str((context.get("v2_analysis") or {}).get("direction") or "NEUTRAL")
        score = int((context.get("v2_analysis") or {}).get("total_score") or 0)
        overlays = context.get("overlays") or {}
        patterns = overlays.get("harmonics") if isinstance(overlays, dict) else []
        result = {
            "summary": str(content or "MiniMax returned no chart explanation")[:4000],
            "visual_bias": visual_bias,
            "confidence": score,
            "visible_patterns": [str(item.get("type")) for item in patterns if isinstance(item, dict) and item.get("type")],
            "key_levels": [], "confirmations": [], "conflicts": [], "risk_factors": [],
            "wait_for": "Use deterministic scanner confirmation and calendar clearance",
            "invalidation": "Use the deterministic V2 invalidation when available",
            "educational_note": "The model response was returned as narrative text. AI is advisory; deterministic scanner and calendar gates remain authoritative.",
        }
    return {"configured": True, "model": MODEL, "analysis": result}
