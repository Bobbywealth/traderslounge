"""Re-exports of pre-existing crypto_analysis helpers.

These functions live in :mod:`scanner.crypto_analysis` because they are
also used by the live V2 production path. The Phase 1 institutional
modules need them too, so this module provides a single, well-documented
import surface rather than scattering ``from scanner.crypto_analysis
import _foo`` through every new file.

Each name is a stable, deterministic, stdlib-only helper. We never
modify their behavior from this package.
"""
from __future__ import annotations

from scanner.crypto_analysis import (  # noqa: F401
    _adx,
    _aggregate_days,
    _candle_patterns,
    _cci,
    _cluster_support_resistance,
    _correlation,
    _fvg,
    _sma,
    _stoch_rsi,
    _trend,
)

# Public aliases so callers don't need to know these were originally
# underscore-prefixed helpers.
adx = _adx
stoch_rsi = _stoch_rsi
cci = _cci
fvg = _fvg
trend = _trend
sma = _sma
correlation = _correlation
candle_patterns = _candle_patterns
aggregate_days = _aggregate_days
cluster_support_resistance = _cluster_support_resistance

__all__ = [
    "adx",
    "aggregate_days",
    "candle_patterns",
    "cci",
    "cluster_support_resistance",
    "correlation",
    "fvg",
    "sma",
    "stoch_rsi",
    "trend",
]