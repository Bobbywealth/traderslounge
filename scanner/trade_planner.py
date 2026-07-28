"""Deterministic V2 crypto trade planner.

Turns a full-spectrum analysis plus its source snapshot into a guarded plan.
It never creates a trade when score, calendar, data quality, or available
movement fail the configured requirements.
"""
from __future__ import annotations

from statistics import mean
from typing import Any, Optional

from .data_types import MarketSnapshot
from .indicators import atr


def _levels(values, side, entry):
    clean = []
    for value in values or []:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if (side == "above" and number > entry) or (side == "below" and number < entry):
            clean.append(number)
    return sorted(set(clean))


def _daily_range(snapshot: MarketSnapshot, entry: float) -> dict:
    daily = snapshot.d1
    if len(daily) < 15:
        return {"average_range": None, "used": None, "remaining_up": None, "remaining_down": None}
    completed = [c.high - c.low for c in daily[-15:-1]]
    average = mean(completed) if completed else 0.0
    today = daily[-1]
    used = today.high - today.low
    projected_high = today.open + average / 2
    projected_low = today.open - average / 2
    return {
        "average_range": average,
        "used": used,
        "percent_used": (used / average * 100) if average else None,
        "projected_high": projected_high,
        "projected_low": projected_low,
        "remaining_up": max(0.0, projected_high - entry),
        "remaining_down": max(0.0, entry - projected_low),
    }


def build_trade_plan(
    snapshot: MarketSnapshot,
    analysis: dict[str, Any],
    calendar: Optional[dict[str, Any]] = None,
    minimum_score: int = 60,
    minimum_rr: float = 2.0,
) -> dict[str, Any]:
    direction = str(analysis.get("direction") or "NEUTRAL")
    score = int(analysis.get("total_score") or 0)
    quality = str((analysis.get("data_quality") or {}).get("status") or "insufficient")
    bars = snapshot.ltf() or snapshot.h1 or snapshot.h4 or snapshot.d1
    entry = float(bars[-1].close) if bars else 0.0
    atr_value = atr(bars) if len(bars) >= 16 else None
    calendar_status = str((calendar or {}).get("status") or "UNAVAILABLE")
    timing = analysis.get("trade_timing") or {}
    timing_status = str(timing.get("status") or "WAIT")
    reasons = []

    if not bars or entry <= 0:
        reasons.append("No usable entry-timeframe candles")
    if direction == "NEUTRAL":
        reasons.append("V2 has no confirmed direction")
    if score < minimum_score:
        reasons.append(f"V2 score {score}/100 is below the {minimum_score} setup threshold")
    if timing_status != "READY":
        missing = ", ".join(str(item).replace("_", " ") for item in (timing.get("wait_for") or [])[:3])
        reasons.append(f"Trade timing is {timing_status}{': waiting for ' + missing if missing else ''}")
    if quality not in ("good", "limited"):
        reasons.append(f"Data quality is {quality}")
    if calendar_status in ("BLOCKED", "POST_NEWS", "UNAVAILABLE"):
        reasons.append(f"Economic calendar status is {calendar_status}")

    if not atr_value or not entry:
        return _empty_plan(direction, score, calendar_status, reasons)

    zones = analysis.get("zones") or {}
    support = list(zones.get("support") or [])
    resistance = list(zones.get("resistance") or [])
    order_blocks = zones.get("order_blocks") or []
    gaps = zones.get("fair_value_gaps") or []
    profile = zones.get("volume_profile_summary") or {}
    poc = profile.get("poc")

    above = _levels(resistance + [block.get("high") for block in order_blocks] + [gap.get("high") for gap in gaps] + [poc], "above", entry)
    below = _levels(support + [block.get("low") for block in order_blocks] + [gap.get("low") for gap in gaps] + [poc], "below", entry)
    buffer = atr_value * 0.25

    if direction == "BUY":
        invalidation = max(below) if below else entry - atr_value * 1.5
        stop = invalidation - buffer
        structural_targets = above
        movement_direction = 1
    elif direction == "SELL":
        invalidation = min(above) if above else entry + atr_value * 1.5
        stop = invalidation + buffer
        structural_targets = list(reversed(below))
        movement_direction = -1
    else:
        return _empty_plan(direction, score, calendar_status, reasons)

    risk_distance = abs(entry - stop)
    if risk_distance <= 0:
        reasons.append("Could not calculate a valid structural stop")
        return _empty_plan(direction, score, calendar_status, reasons)

    daily = _daily_range(snapshot, entry)
    remaining_adr = daily.get("remaining_up") if direction == "BUY" else daily.get("remaining_down")
    volatility_ceiling = atr_value * 3.0
    structural_ceiling = abs(structural_targets[-1] - entry) if structural_targets else volatility_ceiling
    candidates = [volatility_ceiling, structural_ceiling]
    if remaining_adr is not None and remaining_adr > 0:
        candidates.append(remaining_adr)
    expected_movement = min(candidates)
    available_rr = expected_movement / risk_distance

    if available_rr < minimum_rr:
        reasons.append(f"Only {available_rr:.2f}R of realistic movement is available; minimum is {minimum_rr:.1f}R")

    targets = []
    for multiple in (1.0, 2.0, 3.0):
        raw = entry + movement_direction * risk_distance * multiple
        reachable = multiple <= available_rr + 1e-9
        targets.append({"label": f"TP{int(multiple)}", "price": raw, "r_multiple": multiple, "reachable": reachable})

    eligible = not reasons
    if eligible and score >= 70 and available_rr >= 3:
        status = "STRONG"
    elif eligible and available_rr >= 2:
        status = "VALID"
    elif eligible:
        status = "WATCHLIST"
    else:
        status = "BLOCKED" if calendar_status in ("BLOCKED", "POST_NEWS", "UNAVAILABLE") else "WAIT"

    risk_percent = 0.0 if not eligible else 1.0 if status == "STRONG" else 0.5 if status == "VALID" else 0.25
    if (timing.get("regime") or {}).get("monthly_weekly_conflict") or not (timing.get("session") or {}).get("preferred", False):
        risk_percent = min(risk_percent, 0.25)
    return {
        "version": "1.0.0",
        "status": status,
        "eligible": eligible,
        "direction": direction,
        "score": score,
        "entry": entry,
        "invalidation": invalidation,
        "stop": stop,
        "atr": atr_value,
        "atr_buffer": buffer,
        "risk_distance": risk_distance,
        "risk_percent_of_price": risk_distance / entry * 100,
        "expected_movement": expected_movement,
        "expected_move_percent": expected_movement / entry * 100,
        "available_rr": available_rr,
        "minimum_rr": minimum_rr,
        "targets": targets,
        "daily_range": daily,
        "structural_targets": structural_targets[:5],
        "account_risk_percent": risk_percent,
        "calendar_status": calendar_status,
        "timing_status": timing_status,
        "timing": timing,
        "reasons": reasons,
        "position_size_formula": "account_equity * account_risk_percent / 100 / risk_distance",
    }


def _empty_plan(direction, score, calendar_status, reasons):
    return {
        "version": "1.0.0", "status": "WAIT", "eligible": False,
        "direction": direction, "score": score, "entry": None,
        "invalidation": None, "stop": None, "atr": None,
        "atr_buffer": None, "risk_distance": None,
        "risk_percent_of_price": None, "expected_movement": None,
        "expected_move_percent": None, "available_rr": 0,
        "minimum_rr": 2.0, "targets": [], "daily_range": {},
        "structural_targets": [], "account_risk_percent": 0,
        "calendar_status": calendar_status, "timing_status": "WAIT", "timing": {}, "reasons": reasons,
        "position_size_formula": "account_equity * account_risk_percent / 100 / risk_distance",
    }
