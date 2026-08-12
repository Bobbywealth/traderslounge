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
from .reason_codes import (
    ReasonCode,
    build_blocking_reason,
    build_wait_reason,
)
from .multi_source import get_asset_class
from .risk_manager import RiskManager


def _generate_plan_triggers(snapshot: MarketSnapshot, analysis: dict, entry: float, direction: str) -> list:
    triggers = []
    score = int(analysis.get("total_score", 0))
    if score == 0:
        score = int(analysis.get("forming_score", 0))
    timing = analysis.get("trade_timing") or {}
    market_context = analysis.get("market_context") or {}
    bars = list(snapshot.m15 or []) if hasattr(snapshot, 'm15') else []

    if score < 70:
        triggers.append({
            "type": "score_crosses_above",
            "symbol": getattr(snapshot, "pair", ""),
            "threshold": 70,
            "current_value": score,
            "completed": score >= 70,
            "human_readable": f"Confluence score rises above 70 (currently {score})"
        })

    if bars and entry > 0:
        last_bar = bars[-1] if bars else None
        if last_bar:
            price = float(getattr(last_bar, 'close', 0))
            triggers.append({
                "type": "candle_close_above",
                "symbol": getattr(snapshot, "pair", ""),
                "timeframe": "M15",
                "price": entry,
                "required_candle_state": "bullish engulfing",
                "current_progress": 0,
                "completed": price > entry,
                "human_readable": f"M15 candle closes above {entry:.2f} with bullish engulfing pattern"
            })

    opposing = market_context.get("opposing_frames", [])
    if opposing and direction in ("BUY", "SELL"):
        triggers.append({
            "type": "direction_conflict_resolves",
            "symbol": getattr(snapshot, "pair", ""),
            "current_value": len(opposing),
            "completed": len(opposing) == 0,
            "human_readable": f"Direction conflict resolves ({', '.join(opposing)} timeframe conflict)"
        })

    adr_percent = timing.get("adr_percent_used", 0)
    if adr_percent is None or adr_percent == 0:
        adr_percent = timing.get("regime", {}).get("adr_percent_used", 0)
    if adr_percent and adr_percent > 80:
        triggers.append({
            "type": "adr_resets",
            "symbol": getattr(snapshot, "pair", ""),
            "current_value": adr_percent,
            "completed": adr_percent < 50,
            "human_readable": "ADR utilization falls below 50%"
        })

    return triggers


def _generate_blocking_reasons(analysis: dict, direction: str, timing_status: str) -> list:
    blocking = []
    market_context = analysis.get("market_context") or {}
    timing = analysis.get("trade_timing") or {}
    regime = timing.get("regime") or {}

    opposing = market_context.get("opposing_frames", [])
    if opposing and direction in ("BUY", "SELL"):
        blocking.append({
            "code": "DIRECTION_CONFLICT",
            "message": f"{', '.join(opposing)} bullish but M15 momentum bearish",
            "severity": "medium"
        })

    if regime.get("monthly_weekly_conflict"):
        blocking.append({
            "code": "HTF_CONFLICT",
            "message": "Monthly and weekly trend disagree",
            "severity": "medium"
        })

    if timing_status == "AVOID":
        avoid_reasons = timing.get("avoid_reasons") or []
        for reason in avoid_reasons:
            blocking.append({
                "code": "TIMING_AVOID",
                "message": str(reason).replace("_", " ").title(),
                "severity": "high"
            })

    if timing_status == "WAIT":
        # Surface technical-check failures from the analysis engine.
        # crypto_analysis.py already computes wait_for / blocking_reasons
        # for exactly this case — fold them in so the trade plan explains
        # WHY timing is WAIT rather than silently returning [].
        wait_for = timing.get("wait_for") or timing.get("blocking_reasons") or []
        for reason in wait_for:
            blocking.append({
                "code": "TIMING_WAIT",
                "message": str(reason).replace("_", " ").title(),
                "severity": "low"
            })

    return blocking


TRANSACTION_COSTS_BPS = {
    'forex': 12,
    'forex_jpy': 15,
    'metals': 20,
    'cryptocurrency': 25,
    'indices': 15,
}


def calculate_net_rr(entry: float, stop: float, target: float, direction: int, asset_class: str, entry_type: str = 'market') -> dict:
    risk_distance = abs(entry - stop)
    reward_distance = abs(target - entry)

    gross_rr = reward_distance / risk_distance if risk_distance > 0 else 0

    cost_bps = TRANSACTION_COSTS_BPS.get(asset_class, 12)

    if entry_type == 'limit':
        cost_bps = cost_bps * 0.8

    cost_r = (entry * (cost_bps / 10000)) / risk_distance if risk_distance > 0 else float('inf')

    net_rr = gross_rr - cost_r

    return {
        'gross_rr': round(gross_rr, 2),
        'net_rr': round(net_rr, 2),
        'cost_bps': cost_bps,
        'cost_r': round(cost_r, 3),
        'asset_class': asset_class,
        'entry_type': entry_type,
    }


from .multi_source import get_asset_class
from .risk_manager import RiskManager


class TradePlanner:
    def __init__(self, risk_manager: Optional[RiskManager] = None):
        self.risk_manager = risk_manager

    def _get_asset_class(self, pair: str) -> str:
        return get_asset_class(pair)

    def calculate_position_size(
        self,
        account_balance_usd: float,
        entry: float,
        stop: float,
        symbol: str,
        direction: str,
        asset_class: str,
    ) -> dict:
        if self.risk_manager:
            return self.risk_manager.calculate_position_size(
                account_balance_usd=account_balance_usd,
                entry=entry,
                stop=stop,
                symbol=symbol,
                direction=direction,
                asset_class=asset_class,
            )
        return {
            'lot_size': 0.0,
            'risk_amount_usd': 0.0,
            'stop_distance': abs(entry - stop),
            'stop_distance_pips': 0.0,
            'pip_value_per_lot': 10.0,
            'asset_class': asset_class,
        }

    def build_trade_plan(
        self,
        snapshot: MarketSnapshot,
        analysis: dict[str, Any],
        calendar: Optional[dict[str, Any]] = None,
        minimum_score: int = 60,
        minimum_rr: float = 2.0,
        primary_candles=None,
        estimated_round_trip_cost_bps: float = 24.0,
        account_balance_usd: float = 10000.0,
    ) -> dict[str, Any]:
        direction = str(analysis.get("direction") or "NEUTRAL")
        score = int(analysis.get("total_score") or 0)
        if score == 0:
            score = int(analysis.get("forming_score") or 0)
        quality = str((analysis.get("data_quality") or {}).get("status") or "insufficient")
        bars = list(primary_candles or []) or snapshot.ltf() or snapshot.h1 or snapshot.h4 or snapshot.d1
        entry = float(bars[-1].close) if bars else 0.0
        atr_value = atr(bars) if len(bars) >= 16 else None
        calendar_status = str((calendar or {}).get("status") or "UNAVAILABLE")
        timing = analysis.get("trade_timing") or {}
        timing_status = str(timing.get("status") or "WAIT")
        reasons = []
        pair = snapshot.pair

        if not bars or entry <= 0:
            reasons.append("No usable entry-timeframe candles")
        if direction == "NEUTRAL":
            reasons.append("V2 has no confirmed direction")
        if score < minimum_score:
            reasons.append(f"V2 score {score}/100 is below the {minimum_score} setup threshold")
        if timing_status != "READY":
            timing_reasons = timing.get("avoid_reasons") if timing_status == "AVOID" else timing.get("wait_for")
            missing = ", ".join(str(item).replace("_", " ") for item in (timing_reasons or [])[:3])
            reasons.append(f"Trade timing is {timing_status}{': waiting for ' + missing if missing else ''}")
        if quality not in ("good", "limited"):
            reasons.append(f"Data quality is {quality}")
        if calendar_status in ("BLOCKED", "POST_NEWS", "UNAVAILABLE"):
            reasons.append(f"Economic calendar status is {calendar_status}")

        if not atr_value or not entry:
            return self._empty_plan(direction, score, calendar_status, reasons)

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
            return self._empty_plan(direction, score, calendar_status, reasons)

        risk_distance = abs(entry - stop)
        if risk_distance <= 0:
            reasons.append("Could not calculate a valid structural stop")
            return self._empty_plan(direction, score, calendar_status, reasons)

        asset_class = self._get_asset_class(pair)
        position = self.calculate_position_size(
            account_balance_usd=account_balance_usd,
            entry=entry,
            stop=stop,
            symbol=pair,
            direction=direction,
            asset_class=asset_class,
        )

        daily = _daily_range(snapshot, entry)
        remaining_adr = daily.get("remaining_up") if direction == "BUY" else daily.get("remaining_down")
        volatility_ceiling = atr_value * 3.0
        structural_ceiling = abs(structural_targets[0] - entry) if structural_targets else volatility_ceiling
        candidates = [volatility_ceiling, structural_ceiling]
        if remaining_adr is not None and remaining_adr > 0:
            candidates.append(remaining_adr)
        expected_movement = min(candidates)
        available_rr = expected_movement / risk_distance
        estimated_cost = entry*(estimated_round_trip_cost_bps/10000.0)
        cost_r = estimated_cost/risk_distance
        net_available_rr = max(0.0, available_rr-cost_r)

        if net_available_rr < minimum_rr:
            reasons.append(f"Only {net_available_rr:.2f}R remains after estimated costs; minimum is {minimum_rr:.1f}R")

        targets = []
        for multiple in (1.0, 2.0, 3.0):
            raw = entry + movement_direction * risk_distance * multiple
            reachable = multiple <= available_rr + 1e-9
            targets.append({"label": f"TP{int(multiple)}", "price": raw, "r_multiple": multiple, "reachable": reachable})

        eligible = not reasons
        if eligible and score >= 70 and net_available_rr >= 3:
            status = "STRONG"
        elif eligible and net_available_rr >= 2:
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
            "net_available_rr": net_available_rr,
            "estimated_cost_r": cost_r,
            "estimated_round_trip_cost_bps": estimated_round_trip_cost_bps,
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
            "position_size": position,
            "asset_class": asset_class,
        }

    def _empty_plan(self, direction, score, calendar_status, reasons):
        return {
            "version": "1.0.0", "status": "WAIT", "eligible": False,
            "direction": direction, "score": score, "entry": None,
            "invalidation": None, "stop": None, "atr": None,
            "atr_buffer": None, "risk_distance": None,
            "risk_percent_of_price": None, "expected_movement": None,
            "expected_move_percent": None, "available_rr": 0,
            "net_available_rr": 0, "estimated_cost_r": None, "estimated_round_trip_cost_bps": 24.0,
            "minimum_rr": 2.0, "targets": [], "daily_range": {},
            "structural_targets": [], "account_risk_percent": 0,
            "calendar_status": calendar_status, "timing_status": "WAIT", "timing": {}, "reasons": reasons,
            "blocking_reasons": [r for r in reasons if isinstance(r, dict)],
            "position_size_formula": "account_equity * account_risk_percent / 100 / risk_distance",
            "position_size": {
                'lot_size': 0.0,
                'risk_amount_usd': 0.0,
                'stop_distance': 0.0,
                'stop_distance_pips': 0.0,
                'pip_value_per_lot': 10.0,
                'asset_class': 'forex',
            },
            "asset_class": "forex",
        }


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
    primary_candles=None,
    asset_class: str = 'cryptocurrency',
    entry_type: str = 'market',
) -> dict[str, Any]:
    direction = str(analysis.get("direction") or "NEUTRAL")
    score = int(analysis.get("total_score") or 0)
    if score == 0:
        score = int(analysis.get("forming_score") or 0)
    quality = str((analysis.get("data_quality") or {}).get("status") or "insufficient")
    bars = list(primary_candles or []) or snapshot.ltf() or snapshot.h1 or snapshot.h4 or snapshot.d1
    entry = float(bars[-1].close) if bars else 0.0
    atr_value = atr(bars) if len(bars) >= 16 else None
    calendar_status = str((calendar or {}).get("status") or "UNAVAILABLE")
    timing = analysis.get("trade_timing") or {}
    timing_status = str(timing.get("status") or "WAIT")
    reasons = []

    if not bars or entry <= 0:
        reasons.append(build_blocking_reason(
            ReasonCode.NO_USABLE_CANDLES,
            data={"entry": entry, "bars_available": len(bars) if bars else 0}
        ))
    if direction == "NEUTRAL":
        reasons.append(build_blocking_reason(
            ReasonCode.NO_CONFIRMED_DIRECTION,
            data={"detected_direction": direction}
        ))
    if score < minimum_score:
        reasons.append(build_blocking_reason(
            ReasonCode.SCORE_BELOW_THRESHOLD,
            custom_message=f"Score {score}/100 is below minimum {minimum_score}",
            data={"score": score, "minimum": minimum_score}
        ))
    if timing_status != "READY":
        timing_reasons = timing.get("avoid_reasons") if timing_status == "AVOID" else timing.get("wait_for")
        missing = ", ".join(str(item).replace("_", " ") for item in (timing_reasons or [])[:3])
        reason_code = ReasonCode.TRADE_TIMING_AVOID if timing_status == "AVOID" else ReasonCode.AWAITING_TRIGGER
        reasons.append(build_blocking_reason(
            reason_code,
            custom_message=f"Trade timing is {timing_status}{': waiting for ' + missing if missing else ''}",
            data={"timing_status": timing_status, "reasons": timing_reasons or []}
        ))
    if quality not in ("good", "limited"):
        reasons.append(build_blocking_reason(
            ReasonCode.DATA_QUALITY_POOR,
            custom_message=f"Data quality is {quality}",
            data={"quality": quality}
        ))
    # A real news window blocks the plan. A calendar we simply could not reach
    # must not: an outage on a free upstream feed would otherwise silently
    # suppress every signal indefinitely. Degrade instead — publish, flag it,
    # and cap risk below.
    calendar_degraded = calendar_status == "UNAVAILABLE"
    if calendar_status in ("BLOCKED", "POST_NEWS"):
        reasons.append(build_blocking_reason(
            ReasonCode.CALENDAR_BLOCKED,
            custom_message=f"Economic calendar status is {calendar_status}",
            data={"calendar_status": calendar_status}
        ))

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
        reasons.append(build_blocking_reason(
            ReasonCode.INVALID_STRUCTURAL_STOP,
            data={"entry": entry, "stop": stop, "atr_value": atr_value}
        ))
        return _empty_plan(direction, score, calendar_status, reasons)

    daily = _daily_range(snapshot, entry)
    remaining_adr = daily.get("remaining_up") if direction == "BUY" else daily.get("remaining_down")
    volatility_ceiling = atr_value * 3.0
    structural_ceiling = abs(structural_targets[0] - entry) if structural_targets else volatility_ceiling
    candidates = [volatility_ceiling, structural_ceiling]
    if remaining_adr is not None and remaining_adr > 0:
        candidates.append(remaining_adr)
    expected_movement = min(candidates)
    available_rr = expected_movement / risk_distance

    cost_bps = TRANSACTION_COSTS_BPS.get(asset_class, 12)
    if entry_type == 'limit':
        cost_bps = cost_bps * 0.8
    slippage_bps = 5
    spread_bps = cost_bps - slippage_bps if cost_bps > slippage_bps else cost_bps
    total_cost_bps = cost_bps

    estimated_cost = entry*(total_cost_bps/10000.0)
    cost_r = estimated_cost/risk_distance
    net_available_rr = max(0.0, available_rr-cost_r)

    if net_available_rr < minimum_rr:
        reasons.append(build_blocking_reason(
            ReasonCode.RR_BELOW_MINIMUM,
            custom_message=f"Only {net_available_rr:.2f}R remains after estimated costs; minimum is {minimum_rr:.1f}R",
            data={"net_available_rr": net_available_rr, "minimum_rr": minimum_rr, "available_rr": available_rr, "cost_r": cost_r}
        ))

    targets = []
    for i, multiple in enumerate((1.0, 2.0, 3.0)):
        target_price = entry + movement_direction * risk_distance * multiple
        reachable = multiple <= available_rr + 1e-9
        rr_result = calculate_net_rr(entry, stop, target_price, movement_direction, asset_class, entry_type)
        targets.append({
            "label": f"TP{int(multiple)}",
            "price": target_price,
            "r_multiple": multiple,
            "reachable": reachable,
            "gross_rr": rr_result['gross_rr'],
            "net_rr": rr_result['net_rr'],
        })

    eligible = not reasons
    if eligible and score >= 70 and net_available_rr >= 3:
        status = "STRONG"
    elif eligible and net_available_rr >= 2:
        status = "VALID"
    elif eligible:
        status = "WATCHLIST"
    else:
        status = "BLOCKED" if calendar_status in ("BLOCKED", "POST_NEWS") else "WAIT"

    risk_percent = 0.0 if not eligible else 1.0 if status == "STRONG" else 0.5 if status == "VALID" else 0.25
    if (timing.get("regime") or {}).get("monthly_weekly_conflict") or not (timing.get("session") or {}).get("preferred", False):
        risk_percent = min(risk_percent, 0.25)
    if calendar_degraded:
        # Trading blind to the calendar — size down rather than sit out.
        risk_percent = min(risk_percent, 0.25)

    triggers = _generate_plan_triggers(snapshot, analysis, entry, direction) if eligible else []
    blocking_reasons = _generate_blocking_reasons(analysis, direction, timing_status)

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
        "net_available_rr": net_available_rr,
        "estimated_cost_r": cost_r,
        "total_transaction_cost_bps": total_cost_bps,
        "spread_assumption_bps": spread_bps,
        "slippage_assumption_bps": slippage_bps,
        "minimum_rr": minimum_rr,
        "targets": targets,
        "tp1": targets[0]["price"] if len(targets) > 0 else None,
        "tp2": targets[1]["price"] if len(targets) > 1 else None,
        "tp3": targets[2]["price"] if len(targets) > 2 else None,
        "gross_rr": targets[0]["gross_rr"] if len(targets) > 0 else None,
        "net_rr": targets[0]["net_rr"] if len(targets) > 0 else None,
        "asset_class": asset_class,
        "entry_type": entry_type,
        "daily_range": daily,
        "structural_targets": structural_targets[:5],
        "account_risk_percent": risk_percent,
        "calendar_status": calendar_status,
        "calendar_degraded": calendar_degraded,
        "timing_status": timing_status,
        "timing": timing,
        "reasons": reasons,
        "triggers": triggers,
        "blocking_reasons": blocking_reasons,
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
        "net_available_rr": 0, "estimated_cost_r": None,
        "total_transaction_cost_bps": 12,
        "spread_assumption_bps": 10,
        "slippage_assumption_bps": 5,
        "minimum_rr": 2.0, "targets": [], "daily_range": {},
        "structural_targets": [], "account_risk_percent": 0,
        "calendar_status": calendar_status, "calendar_degraded": calendar_status == "UNAVAILABLE",
        "timing_status": "WAIT", "timing": {}, "reasons": reasons,
        "triggers": [], "blocking_reasons": [r for r in reasons if isinstance(r, dict)],
        "position_size_formula": "account_equity * account_risk_percent / 100 / risk_distance",
    }


# Backward compatibility wrapper
def build_trade_plan_legacy(
    snapshot: MarketSnapshot,
    analysis: dict,
    calendar: Optional[dict[str, Any]] = None,
    minimum_score: int = 60,
    minimum_rr: float = 2.0,
    primary_candles=None,
    estimated_round_trip_cost_bps: float = 24.0,
) -> dict[str, Any]:
    planner = TradePlanner()
    return planner.build_trade_plan(
        snapshot=snapshot,
        analysis=analysis,
        calendar=calendar,
        minimum_score=minimum_score,
        minimum_rr=minimum_rr,
        primary_candles=primary_candles,
        estimated_round_trip_cost_bps=estimated_round_trip_cost_bps,
    )


class TradePlanner:
    def __init__(self, risk_manager: Optional[RiskManager] = None):
        self.risk_manager = risk_manager

    def _get_asset_class(self, pair: str) -> str:
        return get_asset_class(pair)

    def calculate_position_size(
        self,
        account_balance_usd: float,
        entry: float,
        stop: float,
        symbol: str,
        direction: str,
        asset_class: str,
    ) -> dict:
        if self.risk_manager:
            return self.risk_manager.calculate_position_size(
                account_balance_usd=account_balance_usd,
                entry=entry,
                stop=stop,
                symbol=symbol,
                direction=direction,
                asset_class=asset_class,
            )
        return {
            'lot_size': 0.0,
            'risk_amount_usd': 0.0,
            'stop_distance': abs(entry - stop),
            'stop_distance_pips': 0.0,
            'pip_value_per_lot': 10.0,
            'asset_class': asset_class,
        }
