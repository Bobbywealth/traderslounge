"""Automatic trendline detection from swing pivots.

Companion to modules/harmonic.py and modules/classical.py, built on the same
`detect_swings` pivots so every overlay on the chart derives from one structural
read of the market.

A trendline here is an anchored ray: two pivots define it, later price confirms
it, and a decisive close through it retires it. Tolerances are expressed in ATR
rather than absolute price so the detector behaves identically on a 1.10 FX pair
and a $60,000 crypto pair.

Like the other pattern modules these are explanatory overlays. Nothing here
feeds the BWTS score or any trade gate.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from ..data_types import Candle, Swing
from ..indicators import atr, detect_swings

# How close a bar must come to the line to count as a touch.
_TOUCH_ATR = 0.25
# A close beyond the line by more than this breaks it.
_BREAK_ATR = 0.50
# Anchors plus at least one independent confirmation.
_MIN_TOUCHES = 3
# Bars that must separate two touches for them to count independently.
_TOUCH_SEPARATION = 3
# Touches must span at least this fraction of the line's live range.
_MIN_COVERAGE = 0.40
# Two lines whose current values sit within this are treated as duplicates.
_DUPLICATE_ATR = 0.35
_MAX_LINES = 4


def _value_at(p1: Swing, p2: Swing, index: int) -> Optional[float]:
    """Price of the line through two pivots at a given bar index."""
    span = p2.index - p1.index
    if span == 0:
        return None
    slope = (p2.price - p1.price) / span
    return p1.price + slope * (index - p1.index)


def _evaluate(candles: Sequence[Candle], p1: Swing, p2: Swing, kind: str,
              tolerance: float, break_distance: float) -> Optional[Dict[str, Any]]:
    """Count touches and detect a break, scanning from the first anchor on."""
    touch_indexes: List[int] = []
    broken_at: Optional[int] = None
    for i in range(p1.index, len(candles)):
        line = _value_at(p1, p2, i)
        if line is None:
            return None
        bar = candles[i]
        # Support is tested by lows, resistance by highs.
        probe = bar.low if kind == "support" else bar.high
        if abs(probe - line) <= tolerance:
            # A run of consecutive bars hugging the line is one touch, not
            # five. Counting each bar let random walks accumulate "touches"
            # and score as strongly as genuine structure.
            if not touch_indexes or i - touch_indexes[-1] >= _TOUCH_SEPARATION:
                touch_indexes.append(i)
        if broken_at is None:
            if kind == "support" and bar.close < line - break_distance:
                broken_at = i
            elif kind == "resistance" and bar.close > line + break_distance:
                broken_at = i
    if len(touch_indexes) < _MIN_TOUCHES:
        return None
    # Touches must be spread along the line, not bunched at one end — three
    # hits inside a handful of bars describe a cluster, not a trendline.
    coverage = (touch_indexes[-1] - touch_indexes[0]) / max(1, len(candles) - 1 - p1.index)
    if coverage < _MIN_COVERAGE:
        return None
    return {"touches": len(touch_indexes), "broken_at": broken_at,
            "touch_indexes": touch_indexes, "coverage": coverage}


def _build(candles: Sequence[Candle], p1: Swing, p2: Swing, kind: str,
           stats: Dict[str, Any], atr_value: float) -> Dict[str, Any]:
    last_index = len(candles) - 1
    current = _value_at(p1, p2, last_index)
    projected = _value_at(p1, p2, last_index + 1)
    price = float(candles[-1].close)
    span = p2.index - p1.index
    slope_per_bar = (p2.price - p1.price) / span if span else 0.0
    broken_at = stats["broken_at"]

    # Longer, more-touched, still-intact lines rank first. Expressed 0-100 so
    # the UI can sort and fade weaker lines without knowing the internals.
    # Reward independent touches and how much of the line they cover, so
    # incidental proximity on a random walk cannot reach the same score as a
    # line price has genuinely respected several times.
    # Calibrated against random-walk baselines: incidental lines on noise
    # average ~5 touches and top out near 10, while a line price genuinely
    # respects reaches 15-20. The previous curve saturated at 6 touches, which
    # scored noise identically to real structure.
    touch_component = min(60.0, max(0.0, stats["touches"] - 2) * 4.0)
    coverage_component = stats["coverage"] * 25.0
    span_component = min(15.0, span * 0.25)
    strength = touch_component + coverage_component + span_component
    if broken_at is not None:
        strength *= 0.4

    return {
        "id": f"{kind}_{p1.index}_{p2.index}",
        "type": kind,
        "direction": "rising" if slope_per_bar > 0 else "falling" if slope_per_bar < 0 else "flat",
        "points": [
            {"index": p1.index, "time": p1.time, "price": p1.price},
            {"index": p2.index, "time": p2.time, "price": p2.price},
        ],
        "slope_per_bar": slope_per_bar,
        # ATR-normalised slope is comparable across instruments; raw slope is not.
        "slope_atr_per_bar": (slope_per_bar / atr_value) if atr_value else None,
        "touches": stats["touches"],
        "strength": round(strength, 1),
        "current_price": current,
        "projected_next": projected,
        "distance": abs(price - current) if current is not None else None,
        "distance_atr": (abs(price - current) / atr_value) if (current is not None and atr_value) else None,
        "is_active": broken_at is None,
        "broken_at_index": broken_at,
        "status": "intact" if broken_at is None else "broken",
        "bars_spanned": span,
    }


def _duplicate(line: Dict[str, Any], kept: List[Dict[str, Any]], threshold: float) -> bool:
    current = line.get("current_price")
    if current is None:
        return False
    for existing in kept:
        other = existing.get("current_price")
        if other is None or existing["type"] != line["type"]:
            continue
        if abs(current - other) <= threshold:
            return True
    return False


def detect_from_swings(swings: Sequence[Swing], candles: Sequence[Candle]) -> List[Dict[str, Any]]:
    """Rank the trendlines the current swing structure supports."""
    if len(candles) < 20 or len(swings) < 3:
        return []
    atr_value = atr(list(candles)) if len(candles) >= 16 else None
    if not atr_value:
        # Without ATR there is no scale-free tolerance; fall back to a fraction
        # of price rather than a hardcoded absolute that only suits 4dp FX.
        atr_value = abs(float(candles[-1].close)) * 0.005
    if atr_value <= 0:
        return []

    tolerance = atr_value * _TOUCH_ATR
    break_distance = atr_value * _BREAK_ATR

    candidates: List[Dict[str, Any]] = []
    for kind, pivot_type in (("support", "low"), ("resistance", "high")):
        pivots = [s for s in swings if s.type == pivot_type]
        for i in range(len(pivots)):
            for j in range(i + 1, len(pivots)):
                p1, p2 = pivots[i], pivots[j]
                if p2.index - p1.index < 3:
                    continue
                stats = _evaluate(candles, p1, p2, kind, tolerance, break_distance)
                if stats is None:
                    continue
                candidates.append(_build(candles, p1, p2, kind, stats, atr_value))

    # Intact lines first, then strength, then recency of the second anchor.
    candidates.sort(key=lambda line: (line["is_active"], line["strength"], line["points"][1]["index"]),
                    reverse=True)

    kept: List[Dict[str, Any]] = []
    for line in candidates:
        if _duplicate(line, kept, atr_value * _DUPLICATE_ATR):
            continue
        kept.append(line)
        if len(kept) >= _MAX_LINES:
            break
    return kept


def detect(candles: Sequence[Candle], left_right: int = 2) -> List[Dict[str, Any]]:
    """Detect trendlines from candle swing pivots."""
    if len(candles) < 20:
        return []
    return detect_from_swings(detect_swings(list(candles), left_right=left_right), candles)
