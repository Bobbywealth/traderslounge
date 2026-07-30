"""Portfolio-level risk calculations.

Sizing is derived from equity, fixed risk limits, stop distance, costs, and
correlated exposure. Confidence scores may reduce exposure but can never raise
it above the fixed account-risk ceiling.
"""
from __future__ import annotations

from typing import Any, Mapping, Sequence


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result else default


def position_size(
    *,
    account_equity: float,
    max_risk_pct: float,
    entry: float,
    stop: float,
    contract_size: float = 1.0,
    spread_bps: float = 0.0,
    slippage_bps: float = 0.0,
    fee_bps_round_trip: float = 0.0,
    exposure_reduction: float = 1.0,
) -> dict[str, Any]:
    equity = max(0.0, _number(account_equity))
    risk_pct = max(0.0, min(100.0, _number(max_risk_pct)))
    entry_value = _number(entry)
    stop_value = _number(stop)
    contract = max(1e-12, _number(contract_size, 1.0))
    reduction = max(0.0, min(1.0, _number(exposure_reduction, 1.0)))
    price_risk = abs(entry_value - stop_value) * contract
    cost_bps = max(0.0, _number(spread_bps)) + max(0.0, _number(slippage_bps)) + max(0.0, _number(fee_bps_round_trip))
    estimated_cost_per_unit = abs(entry_value) * (cost_bps / 10000.0) * contract
    effective_risk_per_unit = price_risk + estimated_cost_per_unit
    risk_budget = equity * risk_pct / 100.0
    raw_units = risk_budget / effective_risk_per_unit if effective_risk_per_unit > 0 else 0.0
    adjusted_units = raw_units * reduction
    return {
        "account_equity": round(equity, 2),
        "max_risk_pct": round(risk_pct, 4),
        "risk_budget": round(risk_budget, 2),
        "price_risk_per_unit": round(price_risk, 8),
        "estimated_cost_per_unit": round(estimated_cost_per_unit, 8),
        "effective_risk_per_unit": round(effective_risk_per_unit, 8),
        "maximum_units_before_adjustment": round(raw_units, 8),
        "recommended_units": round(adjusted_units, 8),
        "exposure_reduction": round(reduction, 4),
        "confidence_used_to_raise_risk": False,
        "rule": "Fixed account-risk ceiling divided by stop-and-cost risk per unit.",
    }


def portfolio_heat(positions: Sequence[Mapping[str, Any]], correlation_threshold: float = 0.75) -> dict[str, Any]:
    rows = []
    total_risk_pct = 0.0
    directional_buckets: dict[str, float] = {}
    for position in positions:
        symbol = str(position.get("symbol") or position.get("pair") or "UNKNOWN")
        direction = str(position.get("direction") or "UNKNOWN").upper()
        risk_pct = max(0.0, _number(position.get("risk_pct"), _number(position.get("account_risk_percent"))))
        correlation_group = str(position.get("correlation_group") or symbol.split("/")[0] or symbol)
        total_risk_pct += risk_pct
        bucket_key = f"{correlation_group}:{direction}"
        directional_buckets[bucket_key] = directional_buckets.get(bucket_key, 0.0) + risk_pct
        rows.append({"symbol": symbol, "direction": direction, "risk_pct": round(risk_pct, 4), "correlation_group": correlation_group})

    largest_bucket = max(directional_buckets.values(), default=0.0)
    concentration_ratio = largest_bucket / total_risk_pct if total_risk_pct else 0.0
    concentration_status = "HIGH" if concentration_ratio >= correlation_threshold and total_risk_pct > 0 else "MODERATE" if concentration_ratio >= 0.5 else "LOW"
    return {
        "positions": rows,
        "total_portfolio_heat_pct": round(total_risk_pct, 4),
        "largest_correlated_directional_bucket_pct": round(largest_bucket, 4),
        "concentration_ratio": round(concentration_ratio, 4),
        "concentration_status": concentration_status,
        "buckets": {key: round(value, 4) for key, value in sorted(directional_buckets.items())},
        "warning": "Correlation groups are explicit inputs until a live covariance provider is connected.",
    }


def portfolio_adjustment(heat: Mapping[str, Any], max_portfolio_heat_pct: float) -> dict[str, Any]:
    current = max(0.0, _number(heat.get("total_portfolio_heat_pct")))
    ceiling = max(0.0, _number(max_portfolio_heat_pct))
    remaining = max(0.0, ceiling - current)
    concentration = str(heat.get("concentration_status") or "LOW").upper()
    multiplier = 0.5 if concentration == "HIGH" else 0.75 if concentration == "MODERATE" else 1.0
    return {
        "current_heat_pct": round(current, 4),
        "maximum_heat_pct": round(ceiling, 4),
        "remaining_heat_pct": round(remaining, 4),
        "new_trade_exposure_multiplier": multiplier if remaining > 0 else 0.0,
        "blocked": remaining <= 0,
        "reason": "Portfolio heat ceiling reached." if remaining <= 0 else f"{concentration.title()} correlated concentration.",
    }
