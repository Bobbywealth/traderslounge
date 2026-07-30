"""Section 1 (MTF Market Structure) — Phase 1.

Produces per-timeframe HH/HL/LH/LL + BOS/CHOCH labels and a composite
trend rollup. Sourced from the same :func:`detect_swings` /
:func:`label_swings` primitives used by the LTF scoring module, so the
labels are guaranteed consistent with the live V2 path.

Report-only — never feeds the BWTS score, never affects direction.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from scanner.data_types import Candle, MarketSnapshot, Swing
from scanner.indicators import detect_swings, label_swings

DEFAULT_TIMEFRAMES = ["D1", "H4", "H1"]

# Per-TF swing pivot window. Daily needs a wider pivot than hourly to
# avoid noise; weekly would be wider still. The exact values are not
# sacred — they're chosen to mirror the legacy TypeScript swingDetector.
_LEFT_RIGHT = {
    "D1": 3,
    "H4": 2,
    "H1": 2,
    "M15": 2,
    "M5": 2,
}

# How many of the most recent labeled swings we inspect when deciding
# trend direction. Mirrors the LTF scoring module's "last 4" rule.
_TREND_WINDOW = 4


def _tf_candles(snapshot: MarketSnapshot, tf: str) -> List[Candle]:
    return {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
        "M1": snapshot.m1,
    }.get(tf, []) or []


def _last_break(swings: List[Swing]) -> Dict[str, Optional[Any]]:
    """Return the most recent BOS / CHOCH (or both None)."""
    bos: Optional[Swing] = None
    bos_kind: Optional[str] = None
    choch: Optional[Swing] = None
    choch_kind: Optional[str] = None
    trend = "neutral"
    for s in swings:
        if s.label is None:
            continue
        if s.label == "HH" and trend != "bearish":
            bos, bos_kind = s, "bullish"
            trend = "bullish"
        elif s.label == "LL" and trend != "bullish":
            bos, bos_kind = s, "bearish"
            trend = "bearish"
        elif s.label == "LH" and trend == "bullish":
            choch, choch_kind = s, "bearish"
            trend = "bearish"
        elif s.label == "HL" and trend == "bearish":
            choch, choch_kind = s, "bullish"
            trend = "bullish"
    return {
        "last_bos": {
            "label": bos.label if bos else None,
            "kind": bos_kind,
            "index": bos.index if bos else None,
            "price": bos.price if bos else None,
        },
        "last_choch": {
            "label": choch.label if choch else None,
            "kind": choch_kind,
            "index": choch.index if choch else None,
            "price": choch.price if choch else None,
        },
    }


def _tf_trend(swings: List[Swing]) -> str:
    last = [s for s in swings[-_TREND_WINDOW:] if s.label]
    bulls = sum(1 for s in last if s.label in ("HH", "HL"))
    bears = sum(1 for s in last if s.label in ("LL", "LH"))
    if bulls >= 3:
        return "bullish"
    if bears >= 3:
        return "bearish"
    return "neutral"


def _per_tf(tf: str, candles: List[Candle]) -> Dict[str, Any]:
    if len(candles) < 10:
        return {
            "trend": "neutral",
            "last_swing_label": None,
            "swing_count": 0,
            "last_bos": None,
            "last_choch": None,
            "reason": "insufficient_data",
        }
    lr = _LEFT_RIGHT.get(tf, 2)
    swings = label_swings(detect_swings(candles, left_right=lr))
    trend = _tf_trend(swings)
    labeled = [s for s in swings if s.label]
    breaks = _last_break(swings)
    return {
        "trend": trend,
        "last_swing_label": labeled[-1].label if labeled else None,
        "swing_count": len(labeled),
        "last_bos": breaks["last_bos"],
        "last_choch": breaks["last_choch"],
    }


def _composite(per_tf: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    trends = {tf: data["trend"] for tf, data in per_tf.items()}
    bullish_n = sum(1 for v in trends.values() if v == "bullish")
    bearish_n = sum(1 for v in trends.values() if v == "bearish")
    total = max(len(trends), 1)
    if bullish_n == total:
        composite = "bullish"
    elif bearish_n == total:
        composite = "bearish"
    elif bullish_n >= 2:
        composite = "lean_bullish"
    elif bearish_n >= 2:
        composite = "lean_bearish"
    else:
        composite = "conflict"

    conflicting = [
        tf
        for tf, t in trends.items()
        if t != "neutral"
        and (
            (composite in ("bullish", "lean_bullish") and t == "bearish")
            or (composite in ("bearish", "lean_bearish") and t == "bullish")
        )
    ]
    summary = (
        f"{bullish_n}/{total} bullish, {bearish_n}/{total} bearish"
        + (f"; conflict on {','.join(conflicting)}" if conflicting else "")
    )
    return {
        "trend": composite,
        "agreement_pct": round(max(bullish_n, bearish_n) / total, 2),
        "conflicting_tfs": conflicting,
        "summary": summary,
    }


def compute(
    snapshot: MarketSnapshot,
    *,
    timeframes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    tfs = timeframes or DEFAULT_TIMEFRAMES
    per_tf: Dict[str, Dict[str, Any]] = {}
    for tf in tfs:
        per_tf[tf] = _per_tf(tf, _tf_candles(snapshot, tf))

    # If every TF returned insufficient_data, the whole block is
    # unavailable rather than a misleading "all neutral".
    if all(v.get("reason") == "insufficient_data" for v in per_tf.values()):
        return {"available": False, "reason": "insufficient_data"}

    return {
        "available": True,
        "kind": "measured",
        "per_timeframe": per_tf,
        "composite": _composite(per_tf),
        "notes": (
            "HH/HL/LH/LL labels use the same detect_swings + "
            "label_swings primitives as the LTF scoring module, so "
            "these labels are consistent with the live V2 path."
        ),
    }