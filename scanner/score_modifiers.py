"""Wires regime modifiers (#5) and learned weights (#2) into the V2
Confluence scoring engine.

Called from scanner.crypto_analysis after the per-category base scores
have been computed.  Adjusts the scores dict in-place-ish (returns a new
dict so callers can diff), updates the total, and writes the applied
modifiers back into the analysis dict so the UI can show "this score
was weighted by regime X" rather than just a number.

The integration is intentionally narrow:

  - Regime modifiers ALWAYS apply (Roadmap #5 — heuristic defaults).
  - Learned weights apply ONLY when a learned_weights_lookup callback
    is supplied AND returns buckets AND a bucket matches the current
    (instrument, timeframe, session, regime).  Until learned weights
    accumulate (Roadmap #2 — just started populating after c7c116d),
    this is a no-op and the engine behaves identically.

Total is re-clamped to [0, 100] so the existing score scale and the
60 / 70 / 90 thresholds in scanner.decision_quality keep working.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Iterable, Mapping, Optional

from .learned_weights import (
    LearnedWeightsBucket,
    find_bucket as _find_learned_bucket,
)
from .regime_taxonomy import (
    DEFAULT_REGIME_MODIFIERS,
    RegimeClassification,
    apply_regime_modifiers as _apply_regime_modifiers,
    classify_regime,
)

log = logging.getLogger(__name__)

# CATEGORY_CAPS mirrors scanner.crypto_analysis.CAPS so we can re-clamp
# per category before recomputing the total.  Caps come from the same
# 80/100-point V2 scoring taxonomy.
CATEGORY_CAPS: dict[str, int] = {
    "structure": 15,
    "momentum": 10,
    "moving_averages": 10,
    "fibonacci": 10,
    "patterns": 10,
    "volatility": 10,
    "volume": 10,
    "relative_strength": 5,
    "liquidity": 15,
}

MAX_TOTAL = sum(CATEGORY_CAPS.values())  # 95 in the canonical layout

LearnedWeightsLookup = Callable[[], Optional[Iterable[LearnedWeightsBucket]]]


def _extract_regime_fields(analysis: Mapping[str, Any]) -> dict[str, Any]:
    """Pull the regime/volume/session/news fields the classifier needs."""
    market_context = analysis.get("market_context") or {}
    trade_timing = analysis.get("trade_timing") or {}
    regime = market_context.get("regime") or {}
    return {
        "market_regime": (
            regime.get("state")
            or regime.get("label")
            or analysis.get("market_regime")
            or ""
        ),
        "volatility": regime.get("volatility") or analysis.get("volatility") or "",
        "trend": regime.get("trend") or analysis.get("trend") or "",
        "news_state": (
            analysis.get("news_state")
            or trade_timing.get("news_state")
            or ""
        ),
        "session": trade_timing.get("session") or analysis.get("session") or "",
    }


def _bucket_for(
    buckets: Optional[Iterable[LearnedWeightsBucket]],
    instrument: str,
    timeframe: str,
    session: str,
    regime: str,
) -> Optional[LearnedWeightsBucket]:
    if not buckets:
        return None
    return _find_learned_bucket(buckets, instrument, timeframe, session, regime)


def apply_score_modifiers(
    scores: Mapping[str, float],
    analysis: Mapping[str, Any],
    learned_weights_lookup: Optional[LearnedWeightsLookup] = None,
) -> tuple[dict[str, float], int, dict[str, Any]]:
    """Adjust per-category scores by regime + (optionally) learned weights.

    Returns ``(adjusted_scores, new_total, applied_modifiers)``.

    ``applied_modifiers`` is a dict suitable for inclusion in the
    analysis payload so the UI can show what was applied:

      {
        "regime": {"state": "...", "confidence": 0.8, "modifiers": {...}},
        "learned_weights": {"bucket": "...", "sample_size": 87, ...}
                         or None
      }
    """
    base = {k: float(v) for k, v in dict(scores or {}).items()}

    # Regime classification + modifiers
    regime_fields = _extract_regime_fields(analysis)
    regime = classify_regime(regime_fields)
    regime_adjusted = _apply_regime_modifiers(base, regime)

    # Optional learned weights
    learned_meta: Optional[dict[str, Any]] = None
    bucket: Optional[LearnedWeightsBucket] = None
    if learned_weights_lookup is not None:
        try:
            buckets = learned_weights_lookup()
        except Exception:
            log.exception("learned_weights_lookup failed")
            buckets = None
        bucket = _bucket_for(
            buckets,
            instrument=str(analysis.get("pair") or "").upper(),
            timeframe=str(
                (analysis.get("data_quality") or {}).get("primary_timeframe")
                or analysis.get("primary_timeframe")
                or "default"
            ).upper(),
            session=str(regime_fields.get("session") or "").upper(),
            regime=regime.state.value,
        )
        if bucket is not None and bucket.status == "USABLE":
            learned_adjusted = {
                cat: regime_adjusted.get(cat, 0.0) * float(bucket.weights.get(cat, 1.0))
                for cat in regime_adjusted
            }
            regime_adjusted = learned_adjusted
            learned_meta = {
                "instrument": bucket.instrument,
                "timeframe": bucket.timeframe,
                "session": bucket.session,
                "regime": bucket.regime,
                "sample_size": bucket.sample_size,
                "win_rate": bucket.win_rate,
                "avg_r": bucket.avg_r,
                "status": bucket.status,
            }
        elif bucket is not None:
            # LIMITED_SAMPLE — surface it but don't apply.
            learned_meta = {
                "instrument": bucket.instrument,
                "timeframe": bucket.timeframe,
                "session": bucket.session,
                "regime": bucket.regime,
                "sample_size": bucket.sample_size,
                "status": bucket.status,
                "applied": False,
                "reason": "below MIN_USABLE_SAMPLES threshold",
            }

    # Re-clamp per category and recompute total.
    final_scores: dict[str, float] = {}
    for cat, value in regime_adjusted.items():
        cap = CATEGORY_CAPS.get(cat, 100)
        final_scores[cat] = max(0.0, min(float(cap), value))

    new_total = int(round(sum(final_scores.values())))

    applied = {
        "regime": regime.to_dict(),
        "learned_weights": learned_meta,
        "caps": dict(CATEGORY_CAPS),
        "max_total": MAX_TOTAL,
    }
    return final_scores, new_total, applied
