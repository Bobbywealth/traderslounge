"""Section 17 (Bull/Base/Bear scenarios) — Phase 1.

Produces rule-based scenarios with *estimated* probability weights.
Every probability here is a deterministic function of the current
analysis inputs (score, MTF agreement, calendar state, ADR). None
of these probabilities are statistically calibrated or backtest-derived.

Always tagged ``"kind": "estimate"`` so renderers and downstream
audits can distinguish them from measured numbers. The function is
deliberately conservative: probabilities cap at [10, 70] so no
single scenario is presented as a strong claim.

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f else default  # NaN guard
    except (TypeError, ValueError):
        return default


def _direction(analysis: Dict[str, Any]) -> str:
    d = str(analysis.get("direction") or "NEUTRAL").upper()
    if d not in ("BUY", "SELL"):
        return "NEUTRAL"
    return d


def _entry(analysis: Dict[str, Any], snapshot: Any = None) -> float:
    plan = analysis.get("trade_plan") or {}
    e = _safe_float(plan.get("entry"), 0.0)
    if e <= 0:
        e = _safe_float(analysis.get("current_price"), 0.0)
    if e <= 0 and snapshot is not None:
        ltf = getattr(snapshot, "ltf", lambda: [])()
        if ltf:
            e = _safe_float(getattr(ltf[-1], "close", 0.0), 0.0)
    return e


def _entry_source(analysis: Dict[str, Any], snapshot: Any = None) -> str:
    """Record whether the entry came from the canonical plan, current_price, or last close."""
    plan = analysis.get("trade_plan") or {}
    if _safe_float(plan.get("entry"), 0.0) > 0:
        return "canonical_plan"
    if _safe_float(analysis.get("current_price"), 0.0) > 0:
        return "current_price"
    if snapshot is not None:
        ltf = getattr(snapshot, "ltf", lambda: [])()
        if ltf and _safe_float(getattr(ltf[-1], "close", 0.0), 0.0) > 0:
            return "snapshot_last_close"
    return "unavailable"


def _targets(analysis: Dict[str, Any], entry: float, direction: str) -> Dict[str, float]:
    """Derive bull / base / bear price targets from fib + swings + ADR."""
    fib = (analysis.get("indicators") or {}).get("fibonacci") or {}
    levels = fib.get("levels") if isinstance(fib, dict) else None
    fib_1272 = _safe_float((levels or {}).get("1.272"), 0.0)
    fib_1618 = _safe_float((levels or {}).get("1.618"), 0.0)
    fib_m100 = _safe_float((levels or {}).get("-1.0"), 0.0)

    sr = (analysis.get("setup_zones") or {}).get("support_resistance") or {}
    swing_high = _safe_float(sr.get("resistance"), 0.0)
    swing_low = _safe_float(sr.get("support"), 0.0)

    adr_value = _safe_float(
        ((analysis.get("indicators") or {}).get("adr")),
        0.0,
    )
    if adr_value <= 0:
        # Try the categorical location used elsewhere.
        adr_value = _safe_float(
            ((analysis.get("market_context") or {}).get("adr")),
            0.0,
        )

    if direction == "BUY":
        bull = max(filter(lambda x: x > 0, [fib_1618, fib_1272, swing_high, entry * 1.02]), default=entry * 1.02)
        bear = min(filter(lambda x: x > 0, [fib_m100, swing_low, entry * 0.97]), default=entry * 0.97)
    elif direction == "SELL":
        bull = min(filter(lambda x: x > 0, [fib_1618, fib_1272, swing_high, entry * 0.98]), default=entry * 0.98)
        bear = max(filter(lambda x: x > 0, [fib_m100, swing_low, entry * 1.03]), default=entry * 1.03)
    else:
        bull = entry * 1.01
        bear = entry * 0.99

    base = entry + (bull - bear) * 0.25  # 25% from bear toward bull = "base"

    return {"bull": bull, "base": base, "bear": bear}


def _score_contrib(score: float) -> float:
    # +1% per BWTS point above 50, capped at +15
    if score <= 50:
        return 0.0
    return min(15.0, (score - 50) * 1.0)


def _htf_contrib(htf_composite: Dict[str, Any], direction: str) -> float:
    trend = (htf_composite or {}).get("trend")
    if trend in ("bullish", "bearish"):
        aligned = (trend == "bullish" and direction == "BUY") or (
            trend == "bearish" and direction == "SELL"
        )
        if aligned:
            return 10.0
        return -10.0
    if trend in ("lean_bullish", "lean_bearish"):
        aligned = ("lean_bullish" == trend and direction == "BUY") or (
            "lean_bearish" == trend and direction == "SELL"
        )
        if aligned:
            return 5.0
        return -5.0
    if trend == "conflict":
        return -10.0
    return 0.0


def _calendar_contrib(calendar_state: Optional[str]) -> float:
    state = (calendar_state or "CLEAR").upper()
    if state == "BLOCKED":
        return -15.0
    if state == "CAUTION":
        return -5.0
    return 0.0


def _clamp_pct(p: float) -> float:
    return max(10.0, min(70.0, p))


def _split(aligned_pct: float) -> Dict[str, float]:
    """Split the remainder between base and bear."""
    aligned_pct = _clamp_pct(aligned_pct)
    base = (100.0 - aligned_pct) * 0.4
    bear = 100.0 - aligned_pct - base
    return {
        "aligned": round(aligned_pct, 1),
        "base": round(base, 1),
        "opposite": round(bear, 1),
    }


def compute(
    analysis: Dict[str, Any],
    snapshot: Any,
    *,
    calendar_state: Optional[str] = None,
) -> Dict[str, Any]:
    direction = _direction(analysis)
    if direction == "NEUTRAL":
        return {
            "available": True,
            "kind": "estimate",
            "direction": "neutral",
            "scenarios": {},
            "disclaimer": (
                "No directional setup; scenario probabilities only make "
                "sense when V2 direction is BUY or SELL."
            ),
        }

    entry = _entry(analysis, snapshot)
    if entry <= 0:
        return {
            "available": False,
            "kind": "estimate",
            "reason": "missing_entry",
        }

    entry_source = _entry_source(analysis, snapshot)
    targets = _targets(analysis, entry, direction)
    score = _safe_float(analysis.get("total_score"), 50.0)
    htf_composite = ((analysis.get("institutional") or {}).get("market_structure_mtf") or {}).get("composite") or {}
    aligned_pct = 35.0 + _score_contrib(score) + _htf_contrib(htf_composite, direction) + _calendar_contrib(calendar_state)
    split = _split(aligned_pct)

    primary_label = "bull" if direction == "BUY" else "bear"
    opposite_label = "bear" if direction == "BUY" else "bull"

    return {
        "available": True,
        "kind": "estimate",
        "direction": direction,
        "entry_reference": round(entry, 6),
        "entry_source": entry_source,
        "eligible": entry_source == "canonical_plan",
        "scenarios": {
            primary_label: {
                "probability_pct": split["aligned"],
                "target": round(targets[primary_label], 6),
                "rr_estimate": round(
                    abs(targets[primary_label] - entry) / max(abs(entry - _safe_float((analysis.get("trade_plan") or {}).get("stop"), entry * 0.99)), 1e-9),
                    2,
                ),
            },
            "base": {
                "probability_pct": split["base"],
                "target": round(targets["base"], 6),
                "rr_estimate": round(
                    abs(targets["base"] - entry) / max(abs(entry - _safe_float((analysis.get("trade_plan") or {}).get("stop"), entry * 0.99)), 1e-9),
                    2,
                ),
            },
            opposite_label: {
                "probability_pct": split["opposite"],
                "target": round(targets[opposite_label], 6),
                "rr_estimate": round(
                    abs(targets[opposite_label] - entry) / max(abs(entry - _safe_float((analysis.get("trade_plan") or {}).get("stop"), entry * 0.99)), 1e-9),
                    2,
                ),
            },
        },
        "disclaimer": (
            "Scenario probabilities are rule-based estimates derived "
            "from BWTS score, MTF agreement, and calendar state. They "
            "are not statistically calibrated; treat as scenario "
            "context, not as a forecast."
        ),
    }