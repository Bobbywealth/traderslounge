"""Section 10 (Historical Volatility) — Phase 1.

Computes rolling-window historical volatility (annualized standard
deviation of log returns) and classifies the current regime against
the trailing distribution.

Periods-per-year mapping per timeframe (15-minute baseline × 96 bars/day):
  D1:   365
  H4:   365 * 6 = 2190
  H1:   365 * 24 = 8760
  M15:  365 * 96 = 35040
  M5:   365 * 288 = 105120

Regime thresholds:
  - compressed:   current HV < 20th percentile of trailing distribution
  - normal:       20th .. 80th percentile
  - expanded:     current HV > 80th percentile

Report-only — never feeds the BWTS score. Used downstream by risk_rating,
scenarios, and the executive summary's horizon selection.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from scanner.data_types import Candle, MarketSnapshot


_PERIODS_PER_YEAR = {
    "D1": 365,
    "H4": 365 * 6,
    "H1": 365 * 24,
    "M15": 365 * 96,
    "M5": 365 * 288,
    "M1": 365 * 1440,
}

_WINDOW = 30      # rolling window for current HV
_LOOKBACK = 252   # trailing history for regime distribution


def _select_candles(snapshot: MarketSnapshot, primary_tf: str) -> List[Candle]:
    tf = (primary_tf or "1h").upper()
    return {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
    }.get(tf) or snapshot.h1 or snapshot.ltf()


def _log_returns(closes: List[float]) -> List[float]:
    out: List[float] = []
    for i in range(1, len(closes)):
        prev, cur = closes[i - 1], closes[i]
        if prev <= 0 or cur <= 0:
            continue
        out.append(math.log(cur / prev))
    return out


def _rolling_hv(returns: List[float], window: int) -> List[float]:
    """Annualized HV per window. Uses population stddev."""
    out: List[float] = []
    ppy = None  # set by caller via period lookup
    for i in range(window, len(returns) + 1):
        segment = returns[i - window:i]
        if not segment:
            continue
        mean = sum(segment) / len(segment)
        var = sum((x - mean) ** 2 for x in segment) / len(segment)
        out.append(math.sqrt(var))
    return out


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((pct / 100.0) * (len(s) - 1)))))
    return s[k]


def compute(
    snapshot: MarketSnapshot,
    primary_timeframe: Optional[str] = None,
) -> Dict[str, Any]:
    tf = (primary_timeframe or "1h").upper()
    candles = _select_candles(snapshot, tf)
    ppy = _PERIODS_PER_YEAR.get(tf, _PERIODS_PER_YEAR["H1"])

    if len(candles) < _WINDOW + 5:
        return {
            "available": False,
            "reason": "insufficient_data",
            "min_required": _WINDOW + 5,
            "got": len(candles),
        }

    closes = [c.close for c in candles]
    rets = _log_returns(closes)
    rolling = _rolling_hv(rets, _WINDOW)
    if not rolling:
        return {"available": False, "reason": "returns_uncomputable"}

    # Annualize the most recent rolling HV.
    current = rolling[-1] * math.sqrt(ppy)
    lookback = rolling[-_LOOKBACK:] if len(rolling) >= _LOOKBACK else rolling
    p20 = _percentile(lookback, 20)
    p80 = _percentile(lookback, 80)
    p20_a = p20 * math.sqrt(ppy)
    p80_a = p80 * math.sqrt(ppy)

    if current < p20_a:
        regime = "compressed"
    elif current > p80_a:
        regime = "expanded"
    else:
        regime = "normal"

    return {
        "available": True,
        "kind": "measured",
        "timeframe": tf,
        "current_hv_annualized": round(current, 4),
        "p20_annualized": round(p20_a, 4),
        "p80_annualized": round(p80_a, 4),
        "regime": regime,
        "window_bars": _WINDOW,
        "lookback_bars": len(lookback),
        "notes": (
            "Compressed regimes often precede expansion; expanded regimes "
            "raise the risk of false breakouts and slippage. Pair with "
            "calendar state and structure before sizing."
        ),
    }