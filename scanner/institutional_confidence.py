"""Explainable institutional confidence and data provenance.

This module is report-only. It never changes canonical direction, eligibility,
position sizing, or account-risk limits. Scores describe evidence coverage and
agreement, not forecast probability.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class ConfidenceComponent:
    key: str
    label: str
    score: float
    maximum: float
    source_type: str
    reason: str
    available: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "score": round(max(0.0, min(self.maximum, self.score)), 1),
            "maximum": round(self.maximum, 1),
            "source_type": self.source_type,
            "reason": self.reason,
            "available": self.available,
        }


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result else default


def _normalized(value: Any, maximum: float) -> float:
    raw = _number(value)
    if raw <= 1.0:
        raw *= 100.0
    return max(0.0, min(maximum, raw / 100.0 * maximum))


def _category_score(analysis: Mapping[str, Any], names: Sequence[str], maximum: float) -> tuple[float, bool]:
    categories = _mapping(analysis.get("category_breakdown"))
    present = [categories[name] for name in names if name in categories]
    if not present:
        return 0.0, False
    return min(maximum, sum(_number(value) for value in present)), True


def build_data_provenance(analysis: Mapping[str, Any]) -> dict[str, Any]:
    """Classify claims by how directly they are supported by available inputs."""
    quality = _mapping(analysis.get("data_quality"))
    institutional = _mapping(analysis.get("institutional"))
    liquidity = _mapping(analysis.get("liquidity"))
    sentiment = _mapping(analysis.get("sentiment"))
    order_flow = _mapping(analysis.get("order_flow"))

    items = [
        {
            "key": "price",
            "label": "Price feed",
            "status": "observed" if analysis.get("current_price") is not None else "unavailable",
            "source_type": "observed_data",
        },
        {
            "key": "volume",
            "label": "Volume",
            "status": "calculated" if _mapping(analysis.get("volume")) or _mapping(analysis.get("indicators")).get("volume") is not None else "unavailable",
            "source_type": "calculated_indicator",
        },
        {
            "key": "market_structure",
            "label": "Market structure",
            "status": "inferred" if analysis.get("market_context") or institutional.get("market_structure") else "unavailable",
            "source_type": "rule_based_inference",
        },
        {
            "key": "liquidity",
            "label": "Liquidity map",
            "status": "observed" if liquidity.get("provider_backed") else "inferred" if liquidity else "unavailable",
            "source_type": "provider_data" if liquidity.get("provider_backed") else "rule_based_inference",
        },
        {
            "key": "order_flow",
            "label": "Order flow",
            "status": "observed" if order_flow.get("provider_backed") else "unavailable",
            "source_type": "provider_data" if order_flow.get("provider_backed") else "unavailable_provider_data",
        },
        {
            "key": "sentiment",
            "label": "Sentiment",
            "status": "observed" if sentiment.get("provider_backed") else "estimated" if sentiment else "unavailable",
            "source_type": "provider_data" if sentiment.get("provider_backed") else "estimated_data",
        },
        {
            "key": "patterns",
            "label": "Elliott and harmonic patterns",
            "status": "candidate" if institutional.get("elliott") or institutional.get("harmonics") else "unavailable",
            "source_type": "pattern_candidate",
        },
    ]
    available = sum(item["status"] != "unavailable" for item in items)
    provider_backed = sum(item["source_type"] == "provider_data" for item in items)
    return {
        "status": str(quality.get("status") or ("GOOD" if available >= 5 else "LIMITED")).upper(),
        "coverage_pct": round(available / len(items) * 100.0, 1),
        "provider_backed_pct": round(provider_backed / len(items) * 100.0, 1),
        "items": items,
        "legend": {
            "observed_data": "Direct market or provider data.",
            "calculated_indicator": "Deterministic calculation from observed data.",
            "rule_based_inference": "Deterministic interpretation; not directly observed.",
            "pattern_candidate": "Candidate geometry requiring forward validation.",
            "estimated_data": "Approximation or proxy.",
            "unavailable_provider_data": "Not available from a connected provider.",
        },
    }


def build_institutional_confidence(analysis: Mapping[str, Any], calendar: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Return an auditable 0-100 evidence score, never a probability."""
    calendar = _mapping(calendar)
    direction = str(analysis.get("direction") or "NEUTRAL").upper()
    context = _mapping(analysis.get("market_context"))
    indicators = _mapping(analysis.get("indicators"))
    timing = _mapping(analysis.get("trade_timing"))
    trade_plan = _mapping(analysis.get("trade_plan"))
    provenance = build_data_provenance(analysis)

    structure_score, structure_available = _category_score(analysis, ("structure", "market_structure"), 25.0)
    if not structure_available:
        aligned = not bool(context.get("opposing_frames")) and direction in {"BUY", "SELL"}
        structure_score = 20.0 if aligned else 8.0 if direction in {"BUY", "SELL"} else 0.0

    momentum_score, momentum_available = _category_score(analysis, ("momentum",), 20.0)
    if not momentum_available:
        momentum_score = 12.0 if indicators.get("rsi") is not None or indicators.get("macd") is not None else 0.0

    liquidity = _mapping(analysis.get("liquidity"))
    liquidity_score = 18.0 if liquidity.get("provider_backed") else 10.0 if liquidity else 0.0
    macro_status = str(calendar.get("status") or "UNAVAILABLE").upper()
    macro_score = 10.0 if macro_status == "CLEAR" else 5.0 if macro_status in {"CAUTION", "NEAR_EVENT"} else 0.0
    volatility = _mapping(timing.get("regime")) or _mapping(analysis.get("volatility_regime"))
    volatility_score = 8.0 if volatility else 0.0
    timing_status = str(timing.get("status") or "WAIT").upper()
    timing_score = 10.0 if timing_status == "READY" else 5.0 if timing_status not in {"AVOID", "BLOCKED"} else 0.0
    data_score = provenance["coverage_pct"] / 100.0 * 7.0

    components = [
        ConfidenceComponent("structure", "Market structure", structure_score, 25.0, "rule_based_inference", "Directional and multi-timeframe structural agreement.", structure_available or bool(context)),
        ConfidenceComponent("momentum", "Momentum", momentum_score, 20.0, "calculated_indicator", "RSI, MACD, divergence, and canonical momentum evidence.", momentum_available or bool(indicators)),
        ConfidenceComponent("liquidity", "Liquidity", liquidity_score, 20.0, "provider_data" if liquidity.get("provider_backed") else "rule_based_inference", "Provider-backed liquidity receives more weight than inferred zones.", bool(liquidity)),
        ConfidenceComponent("macro", "Macro and calendar", macro_score, 10.0, "provider_data" if calendar else "unavailable_provider_data", f"Economic-calendar status: {macro_status}.", bool(calendar)),
        ConfidenceComponent("volatility", "Volatility regime", volatility_score, 10.0, "calculated_indicator", "Regime availability and execution suitability.", bool(volatility)),
        ConfidenceComponent("timing", "Execution timing", timing_score, 10.0, "rule_based_inference", f"Current execution state: {timing_status}.", bool(timing)),
        ConfidenceComponent("data_quality", "Data quality", data_score, 7.0, "data_provenance", f"Input coverage is {provenance['coverage_pct']}%.", True),
    ]

    total = sum(component.as_dict()["score"] for component in components)
    maximum = sum(component.maximum for component in components)
    score = round(total / maximum * 100.0, 1) if maximum else 0.0
    gates_open = bool(trade_plan.get("eligible")) and timing_status == "READY"
    state = "READY" if gates_open and score >= 70 else "SETUP_FORMING" if direction in {"BUY", "SELL"} else "WAIT"
    if timing_status in {"AVOID", "BLOCKED"} or macro_status in {"BLOCKED", "POST_NEWS"}:
        state = "BLOCKED"

    return {
        "score": score,
        "label": "Institutional Confidence",
        "is_probability": False,
        "position_sizing_allowed": False,
        "decision_state": state,
        "components": [component.as_dict() for component in components],
        "data_provenance": provenance,
        "disclaimer": "This score measures evidence coverage and agreement. It is not a calibrated win probability and cannot increase account-risk limits.",
    }
