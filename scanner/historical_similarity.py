"""Historical setup similarity using transparent normalized feature distance."""
from __future__ import annotations

from math import sqrt
from typing import Any, Iterable, Mapping

FEATURES = (
    "score", "rsi", "atr_pct", "trend_strength", "liquidity_score",
    "volatility_score", "session_score", "setup_quality_score",
)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result else default


def setup_vector(analysis: Mapping[str, Any]) -> dict[str, float]:
    indicators = _mapping(analysis.get("indicators"))
    timing = _mapping(analysis.get("trade_timing"))
    regime = _mapping(timing.get("regime"))
    liquidity = _mapping(analysis.get("liquidity"))
    quality = _mapping(analysis.get("decision_quality"))
    price = _number(analysis.get("current_price"))
    atr = _number(indicators.get("atr"))
    return {
        "score": _number(analysis.get("total_score")) / 100.0,
        "rsi": _number(indicators.get("rsi"), 50.0) / 100.0,
        "atr_pct": (atr / price) if price > 0 else 0.0,
        "trend_strength": _number(indicators.get("adx", regime.get("trend_strength"))) / 100.0,
        "liquidity_score": _number(liquidity.get("score", liquidity.get("quality"))) / 100.0,
        "volatility_score": _number(regime.get("score", regime.get("volatility_score"))) / 100.0,
        "session_score": _number(timing.get("session_score"), 50.0) / 100.0,
        "setup_quality_score": _number(quality.get("setup_quality"), 50.0) / 100.0,
    }


def _distance(left: Mapping[str, float], right: Mapping[str, float]) -> float:
    return sqrt(sum((left.get(key, 0.0) - right.get(key, 0.0)) ** 2 for key in FEATURES) / len(FEATURES))


def find_similar_setups(
    analysis: Mapping[str, Any],
    history: Iterable[Mapping[str, Any]],
    limit: int = 10,
    minimum_similarity: float = 0.55,
) -> dict[str, Any]:
    """Rank resolved historical setups. Empty history remains explicit."""
    current = setup_vector(analysis)
    matches = []
    for row in history:
        vector = _mapping(row.get("vector")) or setup_vector(row)
        similarity = max(0.0, min(1.0, 1.0 - _distance(current, vector)))
        if similarity < minimum_similarity:
            continue
        matches.append({
            "id": row.get("id") or row.get("fingerprint"),
            "pair": row.get("pair"),
            "timeframe": row.get("timeframe"),
            "direction": row.get("direction"),
            "outcome": row.get("outcome"),
            "realized_r": row.get("realized_r"),
            "similarity_pct": round(similarity * 100.0, 1),
        })
    matches.sort(key=lambda item: item["similarity_pct"], reverse=True)
    matches = matches[: max(1, min(50, int(limit)))]
    resolved = [item for item in matches if item.get("outcome") is not None]
    wins = [item for item in resolved if str(item.get("outcome")).upper() in {"WIN", "TP", "TARGET"}]
    sample = len(resolved)
    reliability = min(100.0, sample / 30.0 * 100.0)
    return {
        "matches": matches,
        "sample_size": sample,
        "historical_win_rate_pct": round(len(wins) / sample * 100.0, 1) if sample else None,
        "average_realized_r": round(sum(_number(item.get("realized_r")) for item in resolved) / sample, 3) if sample else None,
        "reliability_score": round(reliability, 1),
        "status": "USABLE" if sample >= 30 else "LIMITED_SAMPLE" if sample else "NO_HISTORY",
        "is_forecast_probability": False,
        "warning": "Similarity statistics are descriptive and must not independently determine position size.",
        "query_vector": current,
    }
