"""Institutional multi-factor analysis — Phase 1 (OHLCV-only).

This package implements sections 1, 4, 7, 8, 10, 17, 18, 19, 20, 21 of the
institutional asset-analysis blueprint, using only the OHLCV data already
fed into the scanner.

Hard rules enforced across every module in this package:
  1. NEVER mutate total_score, CAPS, direction, or any existing gate.
     All outputs are report-only fields that downstream renderers may
     consume but never feed back into the BWTS score or Signals gate.
  2. NEVER fabricate data. If a module's inputs are unavailable, it
     returns ``{"available": False, "reason": "..."}`` instead of guessing.
  3. Estimate-only fields (Elliott counts, AB=CD, scenario probabilities)
     are always tagged with ``"kind": "estimate"`` so renderers and
     backtesters can distinguish them from measured/confirmed numbers.
  4. Stdlib only — mirrors the rest of the scanner.

Public entry point:
  - :func:`build_institutional` aggregates every module's output into one
    dict that can be attached to the canonical analysis result.
  - :func:`analyze_with_institutional` wraps
    :func:`scanner.crypto_analysis.analyze_crypto` so callers can opt in
    without modifying the production analyzer.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from scanner.data_types import MarketSnapshot

from . import (
    ab_cd,
    elliott,
    executive_summary,
    hidden_divergence,
    historical_volatility,
    macd_interpret,
    market_structure_mtf,
    monitoring,
    risk_rating,
    scenarios,
    trade_plans,
)
from .market_structure_mtf import DEFAULT_TIMEFRAMES

__all__ = [
    "build_institutional",
    "analyze_with_institutional",
    "DEFAULT_TIMEFRAMES",
]


def build_institutional(
    analysis: Dict[str, Any],
    snapshot: MarketSnapshot,
    *,
    calendar_state: Optional[str] = None,
    primary_timeframe: Optional[str] = None,
    timeframes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Run every Phase 1 module against an existing analysis dict.

    ``analysis`` is the dict produced by
    :func:`scanner.crypto_analysis.analyze_crypto`. We never mutate it
    directly — we return a new dict under ``analysis['institutional']``
    that the caller may merge.
    """
    tf_list = timeframes or DEFAULT_TIMEFRAMES
    primary_tf = primary_timeframe or (
        (analysis.get("data_quality") or {}).get("primary_timeframe") or "1h"
    )

    sections: Dict[str, Any] = {
        "version": "phase1-1",
        "schema_disclaimer": (
            "Estimate-only fields are tagged kind='estimate'. "
            "No field in this block feeds the BWTS score or Signals "
            "publication gate."
        ),
        "market_structure_mtf": market_structure_mtf.compute(
            snapshot, timeframes=tf_list
        ),
        "hidden_divergence": hidden_divergence.compute(snapshot, primary_tf),
        "macd_interpret": macd_interpret.compute(snapshot, primary_tf),
        "elliott": elliott.compute(snapshot, primary_tf),
        "ab_cd": ab_cd.compute(snapshot, primary_tf),
        "historical_volatility": historical_volatility.compute(
            snapshot, primary_tf
        ),
    }

    # Composite sections that read from the analysis dict + the section
    # outputs above. They depend on each other in a fixed order so we
    # run them sequentially and pass the running bag.
    bag: Dict[str, Any] = {**sections, "analysis": analysis}

    sections["scenarios"] = scenarios.compute(
        analysis, snapshot, calendar_state=calendar_state
    )
    bag["scenarios"] = sections["scenarios"]

    sections["trade_plans"] = trade_plans.compute(analysis, snapshot)
    bag["trade_plans"] = sections["trade_plans"]

    sections["risk_rating"] = risk_rating.compute(
        analysis, snapshot, sections, calendar_state=calendar_state
    )
    bag["risk_rating"] = sections["risk_rating"]

    sections["monitoring"] = monitoring.compute(
        analysis, snapshot, sections, calendar_state=calendar_state
    )

    sections["executive_summary"] = executive_summary.compute(
        analysis, snapshot, sections
    )

    return sections


def analyze_with_institutional(
    snapshot: MarketSnapshot,
    *,
    benchmark_candles: Optional[List[Any]] = None,
    primary_candles: Optional[List[Any]] = None,
    primary_timeframe: Optional[str] = None,
    calendar_state: Optional[str] = None,
    timeframes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Wrapper around :func:`scanner.crypto_analysis.analyze_crypto`.

    Returns the canonical analysis dict with an added
    ``"institutional"`` key containing the Phase 1 outputs. The
    canonical fields (score, direction, trade_plan, ...) are byte-for-byte
    identical to the wrapped call's result; only the new block is added.
    """
    # Imported lazily to avoid an import cycle between the package and
    # the analyzer (crypto_analysis already imports scanner.modules.*).
    from scanner.crypto_analysis import analyze_crypto

    analysis = analyze_crypto(
        snapshot,
        benchmark_candles=benchmark_candles,
        primary_candles=primary_candles,
        primary_timeframe=primary_timeframe,
    )
    analysis["institutional"] = build_institutional(
        analysis,
        snapshot,
        calendar_state=calendar_state,
        primary_timeframe=primary_timeframe,
        timeframes=timeframes,
    )
    return analysis