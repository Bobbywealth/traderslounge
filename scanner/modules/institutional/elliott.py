"""Section 7 (Elliott Wave candidate) — Phase 1.

Counts a candidate Elliott structure from labeled swings on a single
timeframe. Outputs are always tagged ``"kind": "estimate"`` and must
not be presented as provider-backed or statistically validated counts.

Two counts are produced:
  - ``primary``  — most recent 5 labeled swings interpreted as a
                   5-wave impulse (1-2-3-4-5) or 3-wave corrective (A-B-C).
  - ``alternative`` — same window shifted by one swing, so the renderer
                      can offer a second-best interpretation.

Elliott rules we enforce (loosely — these are heuristics, not theorems):
  - Wave 2 never retraces 100% of wave 1.
  - Wave 3 is never the shortest among waves 1, 3, 5.
  - Wave 4 never enters wave 1 territory.
  - Corrective A and C tend to be of similar magnitude.

Confidence is a heuristic:
  - "high" if all 3 rules pass and swings are clean.
  - "medium" if 2 rules pass.
  - "low" otherwise or if the structure doesn't fit either template.

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from scanner.data_types import Candle, MarketSnapshot, Swing
from scanner.indicators import detect_swings, label_swings


def _select_candles(snapshot: MarketSnapshot, primary_tf: str) -> List[Candle]:
    tf = (primary_tf or "4h").upper()
    return {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
    }.get(tf) or snapshot.h4 or snapshot.h1 or snapshot.ltf()


def _leg_sizes(swings: List[Swing]) -> List[float]:
    """Absolute price change per leg between consecutive swings."""
    out: List[float] = []
    for i in range(1, len(swings)):
        out.append(abs(swings[i].price - swings[i - 1].price))
    return out


def _alt_alternates(swings: List[Swing]) -> List[Swing]:
    """Drop the oldest swing so the alternative count starts one earlier."""
    return swings[1:] if len(swings) > 1 else swings


def _classify(swings: List[Swing]) -> Dict[str, Any]:
    """Try to label the most recent 5 swings as 1-2-3-4-5 (impulse) or A-B-C (corrective)."""
    if len(swings) < 5:
        return {
            "structure": "unclear",
            "current_wave": "Unclear",
            "next_expected": "Need at least 5 labeled swings.",
            "rules_passed": [],
            "rules_failed": ["insufficient_swings"],
        }

    last5 = swings[-5:]
    types = [s.type for s in last5]
    # 5-swing impulse alternates high/low.
    if types == ["low", "high", "low", "high", "low"]:
        return _impulse(last5)
    if types == ["high", "low", "high", "low", "high"]:
        return _impulse(last5, direction="down")

    # 3-swing corrective A-B-C uses last 3 swings.
    if len(swings) >= 3:
        last3 = swings[-3:]
        t3 = [s.type for s in last3]
        if t3 in (["low", "high", "low"], ["high", "low", "high"]):
            return _corrective(last3)

    return {
        "structure": "unclear",
        "current_wave": "Unclear",
        "next_expected": (
            "Recent swing sequence does not fit a 5-wave impulse or "
            "3-wave corrective template."
        ),
        "rules_passed": [],
        "rules_failed": ["sequence_mismatch"],
    }


def _impulse(swings: List[Swing], direction: str = "up") -> Dict[str, Any]:
    """5-wave impulse validation. Direction defaults to up (low-high-low-high-low)."""
    p = [s.price for s in swings]
    leg = _leg_sizes(swings)  # [L1, L2, L3, L4, L5? — actually 4 legs from 5 swings]
    # legs[0] = swing1->swing2, legs[3] = swing4->swing5
    rules_passed: List[str] = []
    rules_failed: List[str] = []

    # Rule: wave 2 does not retrace 100% of wave 1
    if len(leg) >= 4:
        if leg[1] < leg[0]:
            rules_passed.append("wave2_not_100pct_retrace")
        else:
            rules_failed.append("wave2_100pct_retrace")
        # Rule: wave 3 is not the shortest of 1, 3, 5
        if len(leg) >= 4:
            w1, w3, w5 = leg[0], leg[2], leg[4] if len(leg) >= 5 else leg[3]
            if w3 > 0 and w3 >= max(w1, w5) * 0.95:
                rules_passed.append("wave3_not_shortest")
            else:
                rules_failed.append("wave3_shortest")
        # Rule: wave 4 does not overlap wave 1
        if direction == "up":
            overlap = min(p[1], p[3]) <= p[2]  # wave1 high vs wave4 low
        else:
            overlap = max(p[1], p[3]) >= p[2]
        if not overlap:
            rules_passed.append("wave4_no_wave1_overlap")
        else:
            rules_failed.append("wave4_wave1_overlap")

    n_pass = len(rules_passed)
    if n_pass >= 3:
        confidence = "high"
    elif n_pass == 2:
        confidence = "medium"
    else:
        confidence = "low"

    if direction == "up":
        current_wave = "Wave 5 of (3)"
        next_expected = "Expect Wave 5 exhaustion → Wave A corrective."
    else:
        current_wave = "Wave 5 of (3) down"
        next_expected = "Expect Wave 5 capitulation → Wave A corrective up."

    return {
        "structure": "impulse",
        "direction": direction,
        "current_wave": current_wave,
        "next_expected": next_expected,
        "rules_passed": rules_passed,
        "rules_failed": rules_failed,
        "confidence": confidence,
        "pivots": [
            {"index": s.index, "time": s.time, "price": s.price, "type": s.type}
            for s in swings
        ],
    }


def _corrective(swings: List[Swing]) -> Dict[str, Any]:
    """3-wave corrective A-B-C validation."""
    p = [s.price for s in swings]
    leg = _leg_sizes(swings)  # [A, B] — two legs from three swings
    rules_passed: List[str] = []
    rules_failed: List[str] = []

    if len(leg) >= 2:
        # A and C magnitude similarity (within 50%)
        a, c = leg[0], leg[1]
        if c > 0 and a > 0 and max(a, c) / max(min(a, c), 1e-9) < 2.0:
            rules_passed.append("ac_magnitude_similar")
        else:
            rules_failed.append("ac_magnitude_divergent")
        # B retraces between 38.2% and 78.6% of A
        if a > 0 and 0.382 <= (leg[1] / a) <= 0.786:
            rules_passed.append("b_retracement_in_range")
        else:
            rules_failed.append("b_retracement_out_of_range")

    n_pass = len(rules_passed)
    if n_pass >= 2:
        confidence = "high"
    elif n_pass == 1:
        confidence = "medium"
    else:
        confidence = "low"

    direction = "up" if swings[0].type == "low" else "down"
    if direction == "up":
        current_wave = "Wave C of (2) up"
        next_expected = "Expect Wave C completion → Wave 3 thrust."
    else:
        current_wave = "Wave C of (2) down"
        next_expected = "Expect Wave C completion → Wave 3 decline."

    return {
        "structure": "corrective",
        "direction": direction,
        "current_wave": current_wave,
        "next_expected": next_expected,
        "rules_passed": rules_passed,
        "rules_failed": rules_failed,
        "confidence": confidence,
        "pivots": [
            {"index": s.index, "time": s.time, "price": s.price, "type": s.type}
            for s in swings
        ],
    }


def compute(
    snapshot: MarketSnapshot,
    primary_timeframe: Optional[str] = None,
) -> Dict[str, Any]:
    candles = _select_candles(snapshot, primary_timeframe or "4h")
    if len(candles) < 12:
        return {
            "available": False,
            "kind": "estimate",
            "reason": "insufficient_data",
            "min_required": 12,
            "got": len(candles),
        }

    swings = label_swings(detect_swings(candles, left_right=2))
    if len(swings) < 5:
        return {
            "available": True,
            "kind": "estimate",
            "primary": {
                "structure": "unclear",
                "current_wave": "Unclear",
                "next_expected": "Need at least 5 labeled swings.",
                "confidence": "low",
            },
            "alternative": None,
            "swing_count": len(swings),
            "disclaimer": (
                "Elliott counts are swing-sequence heuristic estimates, "
                "not statistically validated. Use as scenario context only."
            ),
        }

    primary = _classify(swings)
    alt_swings = _alt_alternates(swings)
    alternative = _classify(alt_swings) if alt_swings is not swings else None

    return {
        "available": True,
        "kind": "estimate",
        "primary": primary,
        "alternative": alternative,
        "swing_count": len(swings),
        "timeframe": (primary_timeframe or "4h").upper(),
        "disclaimer": (
            "Elliott counts are swing-sequence heuristic estimates, "
            "not statistically validated. Use as scenario context only; "
            "never as a trade gate."
        ),
    }