"""Section 8 (AB=CD harmonic pattern) — Phase 1.

Adds AB=CD detection to the harmonic library. AB=CD is the simplest
harmonic: a 4-swing pattern where the CD leg equals (or a fixed
multiple of) the AB leg, and BC is a retracement of AB.

Standard AB=CD ratios used:
  - 1.0    — exact equality
  - 1.272  — extension
  - 1.618  — extension

BC retracement is allowed within [0.382, 0.886] of AB to mirror the
range used by the existing Gartley/Bat/Butterfly detectors.

Every output is tagged ``"kind": "estimate"``. The existing harmonic
detector labels "XABCD" patterns including AB=CD implicitly via the
BC/AB + CD/AB ranges, but does not emit a dedicated AB=CD candidate
with completion zone. This module does.

Report-only — never feeds the BWTS score.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from scanner.data_types import Candle, MarketSnapshot, Swing
from scanner.indicators import detect_swings, label_swings


def _select_candles(snapshot: MarketSnapshot, primary_tf: str) -> List[Candle]:
    tf = (primary_tf or "1h").upper()
    return {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
    }.get(tf) or snapshot.h1 or snapshot.ltf()


def _cd_target(a: Swing, b: Swing, c: Swing, ratio: float) -> float:
    """Project the D price from A, B, C and the AB=CD ratio."""
    ab = b.price - a.price
    bc = c.price - b.price
    # Mirror BC from C by the same magnitude as AB * ratio, preserving direction.
    sign = 1 if ab > 0 else -1
    return c.price + sign * abs(ab) * ratio


def _retrace_pct(a: Swing, b: Swing, c: Swing) -> float:
    ab = abs(b.price - a.price)
    bc = abs(c.price - b.price)
    if ab <= 0:
        return 0.0
    return bc / ab


def _validate_window(swings: List[Swing]) -> Optional[Dict[str, Any]]:
    """If the 4 most recent swings form an AB=CD candidate, return it.

    Bullish AB=CD: low(A) - high(B) - low(C) - high(D)
    Bearish AB=CD: high(A) - low(B) - high(C) - low(D)
    """
    if len(swings) < 4:
        return None
    last4 = swings[-4:]
    types = [s.type for s in last4]
    direction = None
    if types == ["low", "high", "low", "high"]:
        direction = "bullish"
    elif types == ["high", "low", "high", "low"]:
        direction = "bearish"
    if direction is None:
        return None

    a, b, c, d = last4
    ab = abs(b.price - a.price)
    cd = abs(d.price - c.price)
    if ab <= 0:
        return None
    cd_ratio = cd / ab
    retrace = _retrace_pct(a, b, c)
    if not (0.382 <= retrace <= 0.886):
        return None
    # Accept the candidate if CD/AB is close to 1.0, 1.272, or 1.618.
    targets = [(1.0, 0.10), (1.272, 0.12), (1.618, 0.14)]
    matched = None
    for base, tol in targets:
        if abs(cd_ratio - base) <= tol:
            matched = base
            break
    if matched is None:
        return None

    # Completion: where D actually landed vs the projected D target.
    projected_d = _cd_target(a, b, c, matched)
    if direction == "bullish":
        completion_pct = (
            min(1.0, d.price / projected_d) if projected_d > 0 else 0.0
        )
    else:
        completion_pct = (
            min(1.0, projected_d / d.price) if d.price > 0 else 0.0
        )

    return {
        "available": True,
        "kind": "estimate",
        "pattern": "AB=CD",
        "direction": direction,
        "ratio": round(matched, 3),
        "actual_ratio": round(cd_ratio, 3),
        "bc_retrace_pct": round(retrace, 3),
        "completion_pct": round(completion_pct, 2),
        "pivots": [
            {"name": n, "index": s.index, "time": s.time, "price": s.price, "type": s.type}
            for n, s in (("A", a), ("B", b), ("C", c), ("D", d))
        ],
        "projected_d": round(projected_d, 6),
        "notes": (
            "Completion < 1.0 means D has not fully reached the projected "
            "AB=CD target; treat as a potential reversal zone when "
            "combined with structure + volume confirmation."
        ),
    }


def compute(
    snapshot: MarketSnapshot,
    primary_timeframe: Optional[str] = None,
) -> Dict[str, Any]:
    candles = _select_candles(snapshot, primary_timeframe or "1h")
    if len(candles) < 10:
        return {
            "available": False,
            "kind": "estimate",
            "reason": "insufficient_data",
            "min_required": 10,
            "got": len(candles),
        }

    swings = label_swings(detect_swings(candles, left_right=2))
    if len(swings) < 4:
        return {
            "available": True,
            "kind": "estimate",
            "candidates": [],
            "swing_count": len(swings),
            "disclaimer": (
                "AB=CD needs at least 4 labeled swings; none available "
                "on this timeframe. Candidate labels are geometric "
                "estimates, not statistically validated."
            ),
        }

    candidates: List[Dict[str, Any]] = []
    # Search from most-recent 4-swing windows first.
    for start in range(len(swings) - 4, -1, -1):
        cand = _validate_window(swings[start:start + 4])
        if cand is not None:
            candidates.append(cand)
        if len(candidates) >= 3:
            break

    return {
        "available": True,
        "kind": "estimate",
        "candidates": candidates,
        "swing_count": len(swings),
        "timeframe": (primary_timeframe or "1h").upper(),
        "disclaimer": (
            "AB=CD ratios are geometric heuristic estimates; pair with "
            "structure, Fibonacci context, and volume confirmation "
            "before treating the projected D level as a hard reversal "
            "zone."
        ),
    }