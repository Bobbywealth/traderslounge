"""Historical-analogue similarity endpoint logic.

Extracted from scanner/api.py as the first step in the planned split of
the api monolith (Roadmap #8).  Kept as a free function so it can be
unit-tested without instantiating an HTTP handler.

The api.py route handler is now a one-liner that calls
``build_similarity_response`` after parsing query parameters and applying
the response cache.  All per-dimension breakdown logic lives here.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Mapping, Optional

from .analysis_history import resolved_similarity_history
from .historical_similarity import find_similar_setups

log = logging.getLogger(__name__)


def _bucket_breakdown(matches: list, dimension_key: str) -> list[dict[str, Any]]:
    """Group matches by a dimension (session, regime, volatility) and
    compute wins / losses / sample size / win-rate."""
    buckets: dict[str, dict[str, int]] = {}
    for match in matches:
        meta = (
            match.get("metadata")
            if isinstance(match.get("metadata"), dict)
            else {}
        )
        value = str(meta.get(dimension_key) or "unknown")
        bucket = buckets.setdefault(value, {"wins": 0, "losses": 0, "samples": 0})
        bucket["samples"] += 1
        outcome = str(match.get("outcome") or "").upper()
        if outcome in {"WIN", "TP", "TARGET"}:
            bucket["wins"] += 1
        elif outcome in {"LOSS", "STOP", "INVALIDATED"}:
            bucket["losses"] += 1
    out = []
    for value, counts in sorted(buckets.items()):
        total = counts["samples"]
        win_rate = (counts["wins"] / total) if total else None
        out.append({
            "value": value,
            "samples": total,
            "wins": counts["wins"],
            "losses": counts["losses"],
            "win_rate_pct": round(win_rate * 100, 1) if win_rate is not None else None,
        })
    return out


def build_similarity_response(
    pair: str,
    timeframe: Optional[str],
    limit: int,
    minimum_similarity: float,
    repository: Any,
    analysis_or_stale: Optional[Mapping[str, Any]],
) -> dict[str, Any]:
    """Compute the similarity payload.  Returns a dict ready to JSON-encode.

    ``analysis_or_stale`` is the resolved V2 analysis (current or stale).
    ``repository`` is the ApiState's repository handle used to pull
    resolved history.  This function is deliberately decoupled from the
    HTTP handler so it can be unit-tested in isolation.
    """
    history: list = []
    try:
        history = resolved_similarity_history(repository, limit=5000)
    except Exception:
        log.exception("similarity history lookup failed")
        history = []

    try:
        result = find_similar_setups(
            analysis_or_stale or {},
            history,
            limit=limit,
            minimum_similarity=minimum_similarity,
        )
    except Exception:
        log.exception("similarity ranking failed")
        return {
            "matches": [],
            "sample_size": 0,
            "historical_win_rate_pct": None,
            "average_realized_r": None,
            "reliability_score": 0.0,
            "status": "ERROR",
            "is_forecast_probability": False,
            "warning": "similarity ranking failed",
            "pair": pair,
            "timeframe": timeframe or "default",
            "generated_at": int(time.time()),
        }

    matches = list(result.get("matches") or [])
    for dimension_key in ("session", "market_regime", "volatility_regime"):
        result[f"breakdown_by_{dimension_key}"] = _bucket_breakdown(matches, dimension_key)

    result["pair"] = pair
    result["timeframe"] = (
        timeframe
        or (analysis_or_stale or {}).get("data_quality", {}).get("primary_timeframe", "default")
    )
    result["generated_at"] = int(time.time())
    return result
