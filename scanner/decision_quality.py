"""Pure, report-only decision-quality enrichment for scanner analyses.

This module preserves the scanner's canonical direction, score, and trade gates.
It does not calculate a position size and never consumes scenario weights.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from .institutional_intelligence import attach_institutional_intelligence


SCENARIO_WEIGHT_DISCLAIMER = (
    "Scenario weights are explicitly uncalibrated, are not probabilities, "
    "and must not be used for position sizing or account exposure."
)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number else default


def _first_number(*values: Any) -> Optional[float]:
    for value in values:
        number = _number(value)
        if number is not None:
            return number
    return None


def _status(source: Mapping[str, Any], default: str = "UNAVAILABLE") -> str:
    return str(source.get("status") or default).upper()


def _trade_plan(analysis: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(analysis.get("trade_plan"))


def _calendar_state(calendar: Mapping[str, Any]) -> tuple[str, Any]:
    status = _status(calendar)
    proximity = calendar.get("proximity_minutes", calendar.get("minutes_to_event"))
    return status, proximity


def _gate_is_open(analysis: Mapping[str, Any], calendar_status: str) -> bool:
    """Read existing gates only; do not create or override scanner eligibility."""
    plan = _trade_plan(analysis)
    if plan and plan.get("eligible") is False:
        return False
    timing = _mapping(analysis.get("trade_timing"))
    if timing and _status(timing, "WAIT") in {"AVOID", "BLOCKED"}:
        return False
    return calendar_status not in {"BLOCKED", "POST_NEWS"}


def _ledger_entry(kind: str, points: float, reason: str, available: bool = True) -> dict[str, Any]:
    return {
        "kind": kind,
        "points": round(points, 1),
        "polarity": "positive" if points > 0 else "negative" if points < 0 else "neutral",
        "reason": reason,
        "available": available,
    }


def build_evidence_ledger(analysis: Mapping[str, Any], calendar: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
    """Build auditable positive/negative evidence without changing canonical scoring."""
    calendar = _mapping(calendar)
    score = _number(analysis.get("total_score"), 0.0) or 0.0
    direction = str(analysis.get("direction") or "NEUTRAL").upper()
    timing = _mapping(analysis.get("trade_timing"))
    context = _mapping(analysis.get("market_context"))
    entries = []
    categories = _mapping(analysis.get("category_breakdown"))
    for name, value in sorted(categories.items(), key=lambda item: str(item[0])):
        points = _number(value, 0.0) or 0.0
        if points:
            entries.append(_ledger_entry(str(name), points, f"{str(name).replace('_', ' ').title()} contribution from the canonical engine."))
    if not entries:
        entries.append(_ledger_entry("canonical_score", score, "Canonical total_score contribution; category detail was unavailable."))

    if direction not in {"BUY", "SELL"}:
        entries.append(_ledger_entry("direction_gate", -15, "No confirmed directional bias."))

    opposing = context.get("opposing_frames") or []
    if opposing:
        entries.append(_ledger_entry("timeframe_conflict", -min(12.0, 4.0 * len(opposing)), "Opposing timeframes: " + ", ".join(map(str, opposing))))

    timing_status = _status(timing, "WAIT")
    if timing_status in {"AVOID", "BLOCKED"}:
        entries.append(_ledger_entry("timing_gate", -15, f"Trade timing is {timing_status}."))
    elif timing_status != "READY":
        entries.append(_ledger_entry("timing_gate", -5, f"Trade timing is {timing_status}."))

    calendar_status, _ = _calendar_state(calendar)
    if calendar_status in {"BLOCKED", "POST_NEWS"}:
        entries.append(_ledger_entry("news_proximity", -15, f"Calendar status is {calendar_status}."))
    elif calendar_status in {"CAUTION", "NEAR_EVENT"}:
        entries.append(_ledger_entry("news_proximity", -8, f"Calendar status is {calendar_status}."))
    elif calendar_status != "CLEAR":
        entries.append(_ledger_entry("news_availability", -3, "Calendar status is unavailable.", False))

    data_status = _status(_mapping(analysis.get("data_quality")), "INSUFFICIENT")
    if data_status not in {"GOOD", "LIMITED"}:
        entries.append(_ledger_entry("data_quality", -10, f"Data quality is {data_status}."))

    net_rr = _first_number(_trade_plan(analysis).get("net_available_rr"), _trade_plan(analysis).get("net_rr"))
    if net_rr is not None and net_rr < 2.0:
        entries.append(_ledger_entry("reward_to_risk_after_fees", -10, f"Post-fee reward-to-risk is only {net_rr:.2f}R."))

    raw_score = sum(entry["points"] for entry in entries)
    return {
        "entries": entries,
        "canonical_score": round(score, 1),
        "raw_points": round(raw_score, 1),
        "final_setup_score": round(max(0.0, min(100.0, raw_score)), 1),
        "method": "canonical category contributions plus explicit trade-quality deductions",
    }


def build_risk_profile(analysis: Mapping[str, Any], calendar: Optional[Mapping[str, Any]] = None, portfolio: Optional[Mapping[str, Any]] = None, historical_stats: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
    """Expose available financial-risk inputs. Missing data remains explicit."""
    plan = _trade_plan(analysis)
    calendar = _mapping(calendar)
    portfolio = _mapping(portfolio)
    historical_stats = _mapping(historical_stats)
    entry = _first_number(plan.get("entry"), analysis.get("current_price"))
    stop = _first_number(plan.get("stop"), plan.get("stop_loss"))
    atr = _first_number(plan.get("atr"), analysis.get("atr"), _mapping(analysis.get("indicators")).get("atr"))
    risk_distance = abs(entry - stop) if entry and stop is not None else None
    stop_pct = (risk_distance / entry * 100) if risk_distance is not None and entry else None
    atr_normalized_stop = (risk_distance / atr) if risk_distance is not None and atr and atr > 0 else None
    spread = _first_number(plan.get("spread_assumption_bps"), plan.get("spread_bps"), analysis.get("spread_bps"))
    slippage = _first_number(plan.get("slippage_assumption_bps"), plan.get("slippage_bps"), analysis.get("slippage_bps"))
    net_rr = _first_number(plan.get("net_rr"), plan.get("net_available_rr"))
    liquidity = _mapping(analysis.get("liquidity"))
    liquidity_flag = liquidity.get("available", analysis.get("liquidity_available"))
    liquidity_available = bool(liquidity_flag) if liquidity_flag is not None else bool(liquidity)
    correlation = portfolio.get("correlation", portfolio.get("correlation_to_portfolio"))
    correlation_available = correlation is not None
    calendar_status, news_proximity = _calendar_state(calendar)
    drawdown = historical_stats.get("max_drawdown", historical_stats.get("drawdown"))
    drawdown_available = drawdown is not None
    gates_open = _gate_is_open(analysis, calendar_status)

    risk_points = 2.0
    if stop_pct is None:
        risk_points += 1.0
    elif stop_pct >= 3:
        risk_points += 2.0
    elif stop_pct >= 1.5:
        risk_points += 1.0
    if atr_normalized_stop is None:
        risk_points += 0.5
    elif atr_normalized_stop >= 2.0:
        risk_points += 1.0
    if (spread or 0) + (slippage or 0) >= 30:
        risk_points += 1.0
    if not liquidity_available:
        risk_points += 1.0
    if not correlation_available:
        risk_points += 0.5
    if calendar_status in {"BLOCKED", "POST_NEWS"}:
        risk_points += 2.0
    elif calendar_status != "CLEAR":
        risk_points += 0.5
    if not drawdown_available:
        risk_points += 0.5
    if net_rr is None or net_rr < 2:
        risk_points += 1.5
    risk_score = round(max(1.0, min(10.0, risk_points)), 1)

    exposure = 0.0
    if gates_open and entry and risk_distance and net_rr is not None and net_rr >= 2:
        exposure = min(1.0, max(0.1, round((10.0 - risk_score) * 0.1, 2)))
        if not (liquidity_available and correlation_available and drawdown_available):
            exposure = min(exposure, 0.5)
    return {
        "entry_available": entry is not None,
        "stop_pct": round(stop_pct, 4) if stop_pct is not None else None,
        "atr_normalized_stop": round(atr_normalized_stop, 4) if atr_normalized_stop is not None else None,
        "spread_bps": spread,
        "slippage_bps": slippage,
        "liquidity_available": liquidity_available,
        "portfolio_correlation_available": correlation_available,
        "news_status": calendar_status,
        "news_proximity_minutes": news_proximity,
        "historical_drawdown_available": drawdown_available,
        "net_rr_after_fees": net_rr,
        "risk_score_1_to_10": risk_score,
        "max_recommended_account_exposure_pct": exposure,
        "exposure_basis": "Existing trade gates, stop/cost/liquidity/correlation/news/drawdown/RR inputs only; scenario weights are excluded.",
        "sizing_rule_status": "RULE_BASED_NOT_EMPIRICALLY_CALIBRATED",
    }


def build_scenario_weights(analysis: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize deterministic bull/base/bear figures without calling them probabilities."""
    legacy = _mapping(_mapping(analysis.get("institutional_analysis")).get("scenario_analysis"))
    modular = _mapping(_mapping(analysis.get("institutional")).get("scenarios"))
    source = legacy or modular
    weights: dict[str, float] = {}
    for label, key in (("bull", "bull_case"), ("base", "base_case"), ("bear", "bear_case")):
        row = _mapping(source.get(key))
        value = _first_number(row.get("weight_pct"), row.get("probability_pct"))
        if value is not None:
            weights[label] = round(max(0.0, min(100.0, value)), 1)
    if not weights:
        direction = str(analysis.get("direction") or "NEUTRAL").upper()
        score = max(0.0, min(100.0, _number(analysis.get("total_score"), 0.0) or 0.0))
        primary = max(10.0, min(70.0, 35.0 + max(0.0, score - 50.0)))
        remainder = 100.0 - primary
        weights = {"bull": 20.0, "base": round(remainder * 0.4, 1), "bear": 20.0}
        if direction == "BUY":
            weights["bull"], weights["bear"] = round(primary, 1), round(remainder * 0.6, 1)
        elif direction == "SELL":
            weights["bear"], weights["bull"] = round(primary, 1), round(remainder * 0.6, 1)
        else:
            weights = {"bull": 30.0, "base": 40.0, "bear": 30.0}
    return {
        "label": "Scenario Weights",
        "weights": weights,
        "calibrated": False,
        "forecast_probabilities": False,
        "position_sizing_allowed": False,
        "method": "deterministic rule-based scenario normalization",
        "disclaimer": SCENARIO_WEIGHT_DISCLAIMER,
    }


def _component_scores(analysis: Mapping[str, Any], ledger: Mapping[str, Any], risk: Mapping[str, Any]) -> dict[str, float]:
    context = _mapping(analysis.get("market_context"))
    direction = str(analysis.get("direction") or "NEUTRAL").upper()
    bias = 50.0 + (10.0 if direction in {"BUY", "SELL"} else -20.0) - (20.0 if context.get("opposing_frames") else 0.0)
    setup = _number(ledger.get("final_setup_score"), 0.0) or 0.0
    readiness = 60.0
    if risk.get("news_status") in {"BLOCKED", "POST_NEWS"}:
        readiness = 0.0
    elif risk.get("news_status") != "CLEAR":
        readiness -= 15.0
    if risk.get("net_rr_after_fees") is None:
        readiness -= 15.0
    elif risk["net_rr_after_fees"] < 2:
        readiness -= 25.0
    if not risk.get("liquidity_available"):
        readiness -= 10.0
    return {
        "market_bias_confidence": round(max(0.0, min(100.0, bias)), 1),
        "setup_quality": round(max(0.0, min(100.0, setup)), 1),
        "execution_readiness": round(max(0.0, min(100.0, readiness)), 1),
    }


def _intelligence_unavailable(exc: Exception) -> dict[str, Any]:
    """Return a stable additive fallback without weakening canonical gates."""
    return {
        "version": "2.0.0",
        "available": False,
        "status": "UNAVAILABLE",
        "reason": f"intelligence_v2_error: {exc!r}",
        "execution_authority": "CANONICAL_TRADE_GATES_ONLY",
        "position_sizing_uses_consensus": False,
        "position_sizing_uses_similarity": False,
        "position_sizing_uses_grade": False,
        "disclaimer": "Intelligence V2 is unavailable; canonical trade gates remain authoritative.",
    }


def attach_decision_quality(analysis: Mapping[str, Any], calendar: Optional[Mapping[str, Any]] = None, portfolio: Optional[Mapping[str, Any]] = None, historical_stats: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
    """Return an enriched copy, preserving canonical direction, total_score and gates."""
    original = dict(analysis or {})
    ledger = build_evidence_ledger(original, calendar)
    risk = build_risk_profile(original, calendar, portfolio, historical_stats)
    components = _component_scores(original, ledger, risk)
    result = dict(original)
    plan = _trade_plan(original)
    if plan:
        plan_copy = dict(plan)
        existing_risk_pct = _number(plan_copy.get("account_risk_percent"), 0.0) or 0.0
        risk_cap = _number(risk.get("max_recommended_account_exposure_pct"), 0.0) or 0.0
        plan_copy["account_risk_percent"] = round(min(existing_risk_pct, risk_cap), 2)
        plan_copy["risk_cap_source"] = "financial_risk_profile_without_scenario_weights"
        plan_copy["scenario_weights_used_for_sizing"] = False
        result["trade_plan"] = plan_copy
    timing = _mapping(original.get("trade_timing"))
    alert_status = "TRIGGERED" if plan.get("eligible") and _status(timing, "WAIT") == "READY" else "ARMED" if plan.get("entry") is not None else "MONITORING"
    result["decision_quality"] = {
        "scenario_weights": build_scenario_weights(original),
        "scenario_weight_disclaimer": SCENARIO_WEIGHT_DISCLAIMER,
        "market_bias_confidence": components["market_bias_confidence"],
        "setup_quality": components["setup_quality"],
        "execution_readiness": components["execution_readiness"],
        "evidence_ledger": ledger,
        "financial_risk_profile": risk,
        "entry_alert": {
            "status": alert_status,
            "entry": plan.get("entry"),
            "invalidation": plan.get("invalidation") or plan.get("stop"),
            "conditions": list(plan.get("triggers") or []),
            "blocking_reasons": list(plan.get("blocking_reasons") or plan.get("reasons") or []),
            "message": "Entry conditions are valid now." if alert_status == "TRIGGERED" else "Alert will become valid only after every execution gate passes.",
        },
    }
    try:
        return attach_institutional_intelligence(result, calendar=calendar)
    except Exception as exc:  # pragma: no cover - defensive runtime isolation
        result["institutional_intelligence_v2"] = _intelligence_unavailable(exc)
        return result
