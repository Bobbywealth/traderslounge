"""Section 9 (Candlestick Patterns) — Phase 2.

Surfaces the patterns the canonical analyzer already detects
(``analysis.indicators.patterns``) with a directional implication
(bullish / bearish / neutral) and a confidence label (high / medium /
low) based on the pattern name and its position in the prevailing
trend.

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


_BULLISH_PATTERNS = {
    "hammer", "inverted_hammer", "bullish_engulfing", "morning_star",
    "piercing", "three_white_soldiers", "bullish_harami", "dragonfly_doji",
    "bullish_marubozu",
}
_BEARISH_PATTERNS = {
    "shooting_star", "hanging_man", "bearish_engulfing", "evening_star",
    "dark_cloud_cover", "three_black_crows", "bearish_harami", "gravestone_doji",
    "bearish_marubozu",
}


def _confidence(name: str, position: str) -> str:
    """Heuristic confidence from pattern + trend alignment."""
    pos = (position or "").lower()
    if name in _BULLISH_PATTERNS and pos == "trend_up":
        return "high"
    if name in _BEARISH_PATTERNS and pos == "trend_down":
        return "high"
    if name in (_BULLISH_PATTERNS | _BEARISH_PATTERNS):
        return "low"
    return "medium"


def _implication(name: str) -> str:
    name_l = (name or "").lower()
    if name_l in _BULLISH_PATTERNS:
        return "bullish"
    if name_l in _BEARISH_PATTERNS:
        return "bearish"
    return "neutral"


def compute(analysis: Dict[str, Any], primary_timeframe: Optional[str] = None
            ) -> Dict[str, Any]:
    indicators = analysis.get("indicators") or {}
    raw_patterns = indicators.get("patterns") or []
    market_context = analysis.get("market_context") or {}
    macro_bias = str(market_context.get("macro_bias") or "").lower()
    direction = str(analysis.get("direction") or "NEUTRAL").upper()

    # Pick the position label heuristically from macro_bias + direction.
    if macro_bias == "bullish" or direction == "BUY":
        position = "trend_up"
    elif macro_bias == "bearish" or direction == "SELL":
        position = "trend_down"
    else:
        position = "trend_unknown"

    patterns: List[Dict[str, Any]] = []
    for entry in raw_patterns[:10]:
        name = entry.get("name") if isinstance(entry, dict) else str(entry)
        if not name:
            continue
        patterns.append({
            "name": name,
            "implication": _implication(name),
            "confidence": _confidence(name, position),
            "raw": entry if isinstance(entry, dict) else None,
        })

    bull_n = sum(1 for p in patterns if p["implication"] == "bullish")
    bear_n = sum(1 for p in patterns if p["implication"] == "bearish")

    return {
        "available": True,
        "kind": "measured",
        "timeframe": (primary_timeframe or "1h").upper(),
        "patterns": patterns,
        "count": len(patterns),
        "bullish_count": bull_n,
        "bearish_count": bear_n,
        "trend_position": position,
        "notes": (
            "Confidence is 'high' when a pattern aligns with the prevailing "
            "trend, 'low' when it appears against the trend. The list is "
            "report-only context; never a trade gate."
        ),
    }