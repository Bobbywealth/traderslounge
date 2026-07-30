"""Section 4 (additional indicators) — Phase 2.

Surfaces Stochastic RSI, CCI, SuperTrend, and Ichimoku Cloud from
the canonical analyzer's ``indicators`` block. The existing
``crypto_analysis`` module computes these values inline; this
institutional module surfaces them with a consensus vote so the
renderer can show a "how many of these four agree?" summary.

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _stoch_signal(value: Optional[float]) -> str:
    v = _safe_float(value)
    if v <= 0:
        return "unavailable"
    if v >= 80:
        return "overbought"
    if v <= 20:
        return "oversold"
    return "neutral"


def _cci_signal(value: Optional[float]) -> str:
    v = _safe_float(value)
    if v == 0:
        return "unavailable"
    if v >= 100:
        return "strong_bullish"
    if v <= -100:
        return "strong_bearish"
    return "neutral"


def _supertrend_signal(st: Optional[Dict[str, Any]],
                        direction: str) -> str:
    if not isinstance(st, dict):
        return "unavailable"
    aligned = bool(st.get("aligned"))
    level = _safe_float(st.get("level"))
    if level <= 0:
        return "unavailable"
    if aligned and direction == "BUY":
        return "bullish_aligned"
    if aligned and direction == "SELL":
        return "bearish_aligned"
    return "counter_to_direction"


def _ichimoku_signal(ich: Optional[Dict[str, Any]]) -> str:
    if not isinstance(ich, dict):
        return "unavailable"
    aligned = bool(ich.get("aligned"))
    span_a = _safe_float(ich.get("span_a"))
    span_b = _safe_float(ich.get("span_b"))
    if span_a <= 0 or span_b <= 0:
        return "unavailable"
    if aligned:
        return "cloud_aligned_bullish" if span_a > span_b else "cloud_aligned_bearish"
    return "cloud_thin_or_choppy"


def compute(analysis: Dict[str, Any], primary_timeframe: Optional[str] = None
            ) -> Dict[str, Any]:
    indicators = analysis.get("indicators") or {}
    direction = str(analysis.get("direction") or "NEUTRAL").upper()

    stoch = _stoch_signal(indicators.get("stoch_rsi"))
    cci = _cci_signal(indicators.get("cci"))
    supertrend = _supertrend_signal(indicators.get("supertrend"), direction)
    ichimoku = _ichimoku_signal(indicators.get("ichimoku"))

    votes: List[str] = []
    if stoch in ("oversold",) and direction == "BUY":
        votes.append("bullish")
    elif stoch in ("overbought",) and direction == "SELL":
        votes.append("bearish")
    if cci == "strong_bullish" and direction == "BUY":
        votes.append("bullish")
    elif cci == "strong_bearish" and direction == "SELL":
        votes.append("bearish")
    if supertrend == "bullish_aligned" and direction == "BUY":
        votes.append("bullish")
    elif supertrend == "bearish_aligned" and direction == "SELL":
        votes.append("bearish")
    if ichimoku == "cloud_aligned_bullish" and direction == "BUY":
        votes.append("bullish")
    elif ichimoku == "cloud_aligned_bearish" and direction == "SELL":
        votes.append("bearish")

    bull_n = sum(1 for v in votes if v == "bullish")
    bear_n = sum(1 for v in votes if v == "bearish")

    return {
        "available": True,
        "kind": "measured",
        "timeframe": (primary_timeframe or "1h").upper(),
        "stoch_rsi": {"value": _safe_float(indicators.get("stoch_rsi")),
                      "signal": stoch},
        "cci": {"value": _safe_float(indicators.get("cci")), "signal": cci},
        "supertrend": supertrend,
        "ichimoku": ichimoku,
        "consensus_bullish_count": bull_n,
        "consensus_bearish_count": bear_n,
        "consensus": (
            "bullish" if bull_n > bear_n
            else "bearish" if bear_n > bull_n
            else "neutral"
        ),
        "notes": (
            "Each indicator votes bullish/bearish when its reading aligns "
            "with the V2 direction. The consensus is the simple majority "
            "and is report-only context — it never feeds the BWTS score."
        ),
    }