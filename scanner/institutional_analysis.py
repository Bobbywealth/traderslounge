"""Deterministic Phase-1 institutional analysis derived only from OHLCV data.

Estimated pattern counts and scenario probabilities are explicitly labelled;
they are decision aids, not claims of certainty or provider-backed flows.
"""
from __future__ import annotations

import math
from statistics import pstdev
from typing import Any

from .indicators import detect_swings, label_swings, rsi


def build_technical_assessment(*, bars, frames, trends, indicators, zones, direction: str, score: int, price: float | None, timeframe: str) -> dict[str, Any]:
    structure = {name: _structure_frame(frames.get(name) or [], trends.get(name) or {}) for name in ("mn1", "w1", "d1", "h4", "h1")}
    structure["selected"] = _structure_frame(bars, trends.get("selected") or trends.get(timeframe) or {})
    divergences = _rsi_divergences(bars)
    elliott = _elliott_candidate(bars, direction)
    abcd = _abcd_candidate(bars)
    hist_vol = _historical_volatility(bars, timeframe)
    return {
        "methodology": "deterministic_ohlcv_phase_1",
        "limitations": [
            "Elliott and AB=CD outputs are candidates, not certified pattern counts",
            "Scenario probabilities are rule-based estimates, not statistically calibrated forecasts",
            "No options-flow, on-chain, fundamental, or broad sentiment provider is included",
        ],
        "market_structure": {
            "timeframes": structure,
            "overall": "bullish" if direction == "BUY" else "bearish" if direction == "SELL" else "neutral",
            "confidence": _confidence(score),
            "support": (zones.get("support") or [])[:4],
            "resistance": (zones.get("resistance") or [])[:4],
            "demand_zones": [z for z in (zones.get("support_resistance") or []) if z.get("type") == "support"][:3],
            "supply_zones": [z for z in (zones.get("support_resistance") or []) if z.get("type") == "resistance"][:3],
        },
        "momentum_detail": {
            "rsi": indicators.get("rsi"),
            "rsi_state": _rsi_state(indicators.get("rsi")),
            "rsi_divergences": divergences,
            "macd": indicators.get("macd"),
            "macd_signal": indicators.get("macd_signal"),
            "macd_histogram": _difference(indicators.get("macd"), indicators.get("macd_signal")),
            "agreement": _indicator_agreement(indicators, direction),
        },
        "elliott_wave": elliott,
        "abcd_pattern": abcd,
        "volatility_detail": {
            "atr": indicators.get("atr"),
            "historical_volatility_annualized_pct": hist_vol,
            "bollinger_width": indicators.get("bollinger_width"),
            "keltner_width": indicators.get("keltner_width"),
            "compression": bool(indicators.get("compression")),
            "regime": "compression" if indicators.get("compression") else "normal_or_expanding",
        },
        "current_price": price,
    }


def enrich_with_plan(analysis: dict[str, Any]) -> dict[str, Any]:
    """Add scenarios, horizon plans, risk score, and executive summary."""
    institutional = analysis.setdefault("institutional_analysis", {})
    plan = analysis.get("trade_plan") or {}
    direction = str(analysis.get("direction") or "NEUTRAL")
    score = int(analysis.get("total_score") or 0)
    calendar = str(plan.get("calendar_status") or (analysis.get("economic_calendar") or {}).get("status") or "UNAVAILABLE")
    issues = list((analysis.get("data_quality") or {}).get("issues") or [])
    opposing = list((analysis.get("market_context") or {}).get("opposing_frames") or [])
    risk_points = 3
    risk_points += 2 if calendar in {"BLOCKED", "POST_NEWS", "UNAVAILABLE"} else 1 if calendar == "CAUTION" else 0
    risk_points += 1 if issues else 0
    risk_points += 1 if opposing else 0
    risk_points += 1 if (analysis.get("trade_timing") or {}).get("status") == "AVOID" else 0
    risk_points += 1 if (analysis.get("trade_timing") or {}).get("regime", {}).get("unstable_volatility") else 0
    risk_score = max(1, min(10, risk_points))

    bullish = 50 + (score - 50) * .6 if direction == "BUY" else 28 - max(0, score - 50) * .25 if direction == "SELL" else 33
    bearish = 50 + (score - 50) * .6 if direction == "SELL" else 28 - max(0, score - 50) * .25 if direction == "BUY" else 33
    if calendar in {"BLOCKED", "POST_NEWS", "UNAVAILABLE"}:
        bullish *= .8; bearish *= .8
    bullish = max(10, min(75, round(bullish)))
    bearish = max(10, min(75, round(bearish)))
    base = max(10, 100 - bullish - bearish)
    total = bullish + bearish + base
    bullish, bearish = round(bullish / total * 100), round(bearish / total * 100)
    base = 100 - bullish - bearish

    institutional["scenario_analysis"] = {
        "method": "rule_based_estimate_not_calibrated_forecast",
        "bull_case": {"probability_pct": bullish, "target": plan.get("tp2") or plan.get("tp1"), "catalysts": ["higher-timeframe alignment", "volume and structure confirmation"]},
        "base_case": {"probability_pct": base, "expected_range": _range(plan.get("stop"), plan.get("tp1")), "catalysts": ["continued consolidation", "mixed confirmation"]},
        "bear_case": {"probability_pct": bearish, "target": plan.get("tp2") or plan.get("tp1") if direction == "SELL" else plan.get("stop"), "risk_factors": list(plan.get("reasons") or [])[:4] or ["structure invalidation"]},
    }
    institutional["trading_strategies"] = _horizon_plans(plan, direction)
    institutional["risk_assessment"] = {
        "overall_risk_1_to_10": risk_score,
        "rating": "high" if risk_score >= 8 else "elevated" if risk_score >= 6 else "moderate" if risk_score >= 4 else "low",
        "largest_risks": (list(plan.get("reasons") or []) + issues + ([f"opposing timeframes: {', '.join(opposing)}"] if opposing else []))[:6],
        "calendar_status": calendar,
        "liquidity_warning": "Stops can slip during thin or fast markets",
    }
    institutional["monitoring_plan"] = {
        "price_alerts": [x for x in [plan.get("entry"), plan.get("stop"), plan.get("tp1"), plan.get("tp2"), plan.get("tp3")] if x is not None],
        "indicator_alerts": list(analysis.get("monitoring") or []),
        "calendar_events": [f"calendar gate changes from {calendar}"],
        "trend_invalidation": plan.get("invalidation") or plan.get("stop"),
        "volume_confirmation": "relative volume at or above 1.1 and directionally supportive VWAP/OBV",
    }
    institutional["executive_summary"] = {
        "overall_bias": "Bullish" if direction == "BUY" else "Bearish" if direction == "SELL" else "Neutral",
        "conviction_0_to_100": score,
        "confidence": _confidence(score),
        "best_setup_status": str(plan.get("status") or "WAIT"),
        "recommended_time_horizon": "swing" if plan.get("eligible") else "monitor_only",
        "entry": plan.get("entry"),
        "stop": plan.get("stop"),
        "targets": [x for x in [plan.get("tp1"), plan.get("tp2"), plan.get("tp3")] if x is not None],
        "clear_invalidation": plan.get("invalidation") or plan.get("stop"),
        "plain_english_thesis": _thesis(direction, score, plan),
    }
    return analysis


def _structure_frame(candles, trend_info):
    swings = label_swings(detect_swings(candles, 2)) if len(candles) >= 8 else []
    labels = [s.label for s in swings if s.label][-6:]
    prior = labels[-2] if len(labels) >= 2 else None
    latest = labels[-1] if labels else None
    event = None
    if latest in {"HH", "LL"}:
        event = "BOS"
    if prior in {"HH", "HL"} and latest in {"LH", "LL"}:
        event = "CHOCH_bearish"
    elif prior in {"LH", "LL"} and latest in {"HH", "HL"}:
        event = "CHOCH_bullish"
    return {"trend": trend_info.get("trend", "neutral"), "swing_labels": labels, "latest_structure_event": event, "confidence": "medium" if len(labels) >= 4 else "low"}


def _rsi_divergences(bars):
    if len(bars) < 35: return []
    values = rsi([float(c.close) for c in bars])
    swings = label_swings(detect_swings(bars, 2))
    out = []
    for kind in ("high", "low"):
        pivots = [s for s in swings if s.type == kind and s.index < len(values) and math.isfinite(values[s.index])]
        if len(pivots) < 2: continue
        a, b = pivots[-2], pivots[-1]
        ra, rb = values[a.index], values[b.index]
        if kind == "low" and b.price < a.price and rb > ra: out.append({"type": "regular_bullish", "confidence": "medium"})
        if kind == "high" and b.price > a.price and rb < ra: out.append({"type": "regular_bearish", "confidence": "medium"})
        if kind == "low" and b.price > a.price and rb < ra: out.append({"type": "hidden_bullish", "confidence": "low"})
        if kind == "high" and b.price < a.price and rb > ra: out.append({"type": "hidden_bearish", "confidence": "low"})
    return out


def _elliott_candidate(bars, direction):
    swings = label_swings(detect_swings(bars, 3)) if len(bars) >= 20 else []
    recent = swings[-6:]
    progressing = sum(s.label in ({"HH", "HL"} if direction == "BUY" else {"LH", "LL"}) for s in recent if s.label)
    return {"classification": "impulse_candidate" if progressing >= 4 else "corrective_or_undetermined", "estimated_wave": min(5, max(1, len(recent)-1)) if recent else None, "primary_direction": direction, "alternative_count": "ABC correction", "confidence": "medium" if progressing >= 4 and len(recent) >= 5 else "low", "pivot_count": len(recent)}


def _abcd_candidate(bars):
    swings = detect_swings(bars, 3) if len(bars) >= 20 else []
    if len(swings) < 4: return {"detected": False, "confidence": "low"}
    x = swings[-4:]
    ab, bc, cd = abs(x[1].price-x[0].price), abs(x[2].price-x[1].price), abs(x[3].price-x[2].price)
    ratio = cd/ab if ab else 0
    retrace = bc/ab if ab else 0
    valid = .85 <= ratio <= 1.15 and .382 <= retrace <= .886
    return {"detected": valid, "ab_cd_ratio": round(ratio, 3), "bc_retracement": round(retrace, 3), "completion_price": x[3].price, "direction": "bullish" if x[3].type == "low" else "bearish", "confidence": "medium" if valid else "low"}


def _historical_volatility(bars, timeframe):
    closes = [float(c.close) for c in bars[-61:] if c.close]
    if len(closes) < 20: return None
    returns = [math.log(b/a) for a, b in zip(closes[:-1], closes[1:]) if a > 0 and b > 0]
    periods = {"mn1":12,"w1":52,"d1":365,"4h":2190,"h4":2190,"1h":8760,"h1":8760,"15m":35040,"m15":35040}.get(str(timeframe).lower(),365)
    return round(pstdev(returns)*math.sqrt(periods)*100, 2) if len(returns) >= 2 else None


def _horizon_plans(plan, direction):
    base = {"direction": direction, "entry": plan.get("entry"), "stop": plan.get("stop"), "targets": [x for x in [plan.get("tp1"), plan.get("tp2"), plan.get("tp3")] if x is not None], "eligible": bool(plan.get("eligible")), "risk_reward": plan.get("net_available_rr")}
    return {"day_trade": {**base, "time_horizon": "intraday", "status": plan.get("status", "WAIT")}, "swing_trade": {**base, "time_horizon": "several days", "status": plan.get("status", "WAIT")}, "position_trade": {**base, "time_horizon": "weeks", "status": "WAIT" if not plan.get("eligible") else "CONDITIONAL", "scaling_strategy": "scale only after a confirmed close and never widen the stop"}}


def _indicator_agreement(indicators, direction):
    sign = 1 if direction == "BUY" else -1 if direction == "SELL" else 0
    checks = []
    r = indicators.get("rsi"); checks.append(r is not None and ((r > 50) if sign > 0 else (r < 50)))
    m = _difference(indicators.get("macd"), indicators.get("macd_signal")); checks.append(m is not None and m*sign > 0)
    checks.extend([bool((indicators.get("ichimoku") or {}).get("aligned")), bool((indicators.get("supertrend") or {}).get("aligned"))])
    agreed = sum(checks)
    return {"supporting": agreed, "evaluated": len(checks), "summary": "agree" if agreed >= 3 else "mixed" if agreed >= 2 else "conflict"}


def _rsi_state(value):
    if value is None: return "unavailable"
    return "overbought" if value >= 70 else "oversold" if value <= 30 else "bullish" if value > 50 else "bearish" if value < 50 else "neutral"

def _difference(a,b):
    try: return float(a)-float(b)
    except (TypeError,ValueError): return None

def _range(a,b): return [x for x in [a,b] if x is not None]
def _confidence(score): return "High" if score >= 70 else "Medium" if score >= 45 else "Low"
def _thesis(direction, score, plan):
    if not plan.get("eligible"): return f"The {direction.lower()} thesis has {score}/100 confluence, but required trade gates are not complete. Monitor rather than enter."
    return f"A guarded {direction} setup passed the technical, timing, calendar, and minimum-R gates at {score}/100 confluence; invalidate at the published stop."
