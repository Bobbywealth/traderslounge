"""Persistence adapter for Intelligence V2 history.

Reuses analysis_forecasts and forecast_outcomes. Writes are idempotent through
forecast fingerprints; only resolved outcomes are returned for similarity.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Mapping

from .historical_similarity import setup_vector


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number else default


def analysis_fingerprint(analysis: Mapping[str, Any]) -> str:
    quality = _mapping(analysis.get("data_quality"))
    plan = _mapping(analysis.get("trade_plan"))
    identity = {
        "pair": str(analysis.get("pair") or "").upper(),
        "timeframe": str(quality.get("primary_timeframe") or "default").upper(),
        "direction": str(analysis.get("direction") or "NEUTRAL").upper(),
        "closed_bar_time": quality.get("closed_bar_time"),
        "entry": plan.get("entry"),
        "stop": plan.get("stop", plan.get("invalidation")),
        "version": analysis.get("version"),
    }
    raw = json.dumps(identity, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def build_forecast_payload(analysis: Mapping[str, Any], created_at: str | None = None) -> dict[str, Any]:
    quality = _mapping(analysis.get("data_quality"))
    plan = _mapping(analysis.get("trade_plan"))
    decision = _mapping(analysis.get("decision_quality"))
    timing = _mapping(analysis.get("trade_timing"))
    regime = _mapping(timing.get("regime"))
    weights = _mapping(_mapping(decision.get("scenario_weights")).get("weights"))
    direction = str(analysis.get("direction") or "NEUTRAL").upper()
    weight = weights.get("bull") if direction == "BUY" else weights.get("bear") if direction == "SELL" else weights.get("base")
    targets = plan.get("targets") or []
    target = _mapping(targets[0]).get("price") if targets else plan.get("tp1")
    intelligence = _mapping(analysis.get("institutional_intelligence_v2"))
    return {
        "fingerprint": analysis_fingerprint(analysis),
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        "pair": str(analysis.get("pair") or "").upper(),
        "timeframe": str(quality.get("primary_timeframe") or "default").upper(),
        "direction": direction,
        "forecast_weight": _number(weight, 0.0) or 0.0,
        "weight_label": "scenario_weight_not_probability",
        "setup_type": str(_mapping(analysis.get("scenarios")).get("primary") or "canonical_setup"),
        "session": timing.get("session"),
        "volatility_regime": regime.get("label") or regime.get("state"),
        "score": int(_number(analysis.get("total_score"), 0.0) or 0),
        "setup_quality_score": int(_number(decision.get("setup_quality"), 0.0) or 0),
        "execution_readiness_score": int(_number(decision.get("execution_readiness"), 0.0) or 0),
        "entry": _number(plan.get("entry")),
        "stop_loss": _number(plan.get("stop", plan.get("invalidation"))),
        "target": _number(target),
        "engine_version": str(analysis.get("version") or "unknown"),
        "metadata": {
            "vector": setup_vector(analysis),
            "canonical_eligible": bool(plan.get("eligible")),
            "timing_status": timing.get("status"),
            "calendar_status": _mapping(analysis.get("economic_calendar")).get("status"),
            "trade_grade": intelligence.get("trade_grade"),
            "consensus": intelligence.get("multi_agent_consensus"),
        },
        "status": "PENDING",
    }


def persist_analysis(repository: Any, analysis: Mapping[str, Any]) -> int | None:
    if repository is None or not hasattr(repository, "save_forecast"):
        return None
    return int(repository.save_forecast(build_forecast_payload(analysis)))


def resolved_similarity_history(repository: Any, limit: int = 5000) -> list[dict[str, Any]]:
    if repository is None or not hasattr(repository, "forecast_rows"):
        return []
    output: list[dict[str, Any]] = []
    for row in repository.forecast_rows(limit=limit):
        if str(row.get("status") or "").upper() != "RESOLVED" or row.get("outcome") is None:
            continue
        metadata = _mapping(row.get("metadata"))
        output.append({
            "id": row.get("id"),
            "fingerprint": row.get("fingerprint"),
            "pair": row.get("pair"),
            "timeframe": row.get("timeframe"),
            "direction": row.get("direction"),
            "outcome": "WIN" if bool(row.get("outcome")) else "LOSS",
            "realized_r": _number(row.get("r_multiple")),
            "vector": _mapping(metadata.get("vector")),
            "resolved_at": row.get("resolved_at"),
        })
    return output
