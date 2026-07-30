"""Section 4 (MACD interpretation) — Phase 1.

The existing V2 path only consumes MACD as a boolean (line vs signal on
the side of the trade direction). This module emits a richer reading:
  - current line / signal / histogram values
  - recent crossover direction (within last 5 bars)
  - histogram momentum (rising / falling / flat)
  - divergence hints between histogram and price

Report-only — never feeds the BWTS score.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from scanner.data_types import Candle, MarketSnapshot
from scanner.indicators import detect_swings, ema


def _select_candles(snapshot: MarketSnapshot, primary_tf: str) -> List[Candle]:
    tf = (primary_tf or "1h").upper()
    return {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
    }.get(tf) or snapshot.h1 or snapshot.ltf()


def _macd_series(closes: List[float], fast: int = 12, slow: int = 26,
                 signal_p: int = 9) -> Dict[str, List[float]]:
    if len(closes) < slow + signal_p:
        return {"line": [], "signal": [], "histogram": []}
    line = [a - b for a, b in zip(ema(closes, fast), ema(closes, slow))]
    sig = ema(line, signal_p)
    hist = [a - b for a, b in zip(line, sig)]
    return {"line": line, "signal": sig, "histogram": hist}


def _recent_crossover(line: List[float], signal: List[float]) -> str:
    """Identify the most recent MACD/signal crossover within 5 bars."""
    for i in range(len(line) - 1, max(len(line) - 6, 0), -1):
        if i <= 0:
            break
        prev_diff = line[i - 1] - signal[i - 1]
        cur_diff = line[i] - signal[i]
        if prev_diff == 0 or cur_diff == 0:
            continue
        if (prev_diff < 0) and (cur_diff > 0):
            return "bullish_recent"
        if (prev_diff > 0) and (cur_diff < 0):
            return "bearish_recent"
    if not line:
        return "neutral"
    return "above" if line[-1] > signal[-1] else "below"


def _histogram_momentum(hist: List[float]) -> str:
    if len(hist) < 3:
        return "flat"
    a, b, c = hist[-3], hist[-2], hist[-1]
    if c > b > a:
        return "rising"
    if c < b < a:
        return "falling"
    return "flat"


def _histogram_divergence_hint(candles: List[Candle],
                               hist: List[float]) -> Dict[str, bool]:
    if len(hist) < 6 or len(candles) < 6:
        return {"bull_div_hint": False, "bear_div_hint": False}
    swings = detect_swings(candles, left_right=2)[-10:]
    highs = [s for s in swings if s.type == "high"][-2:]
    lows = [s for s in swings if s.type == "low"][-2:]
    bull_div = (
        len(lows) == 2
        and lows[1].price < lows[0].price
        and hist[lows[1].index] > hist[lows[0].index]
    )
    bear_div = (
        len(highs) == 2
        and highs[1].price > highs[0].price
        and hist[highs[1].index] < hist[highs[0].index]
    )
    return {"bull_div_hint": bull_div, "bear_div_hint": bear_div}


def compute(
    snapshot: MarketSnapshot,
    primary_timeframe: Optional[str] = None,
) -> Dict[str, Any]:
    candles = _select_candles(snapshot, primary_timeframe or "1h")
    if len(candles) < 35:
        return {
            "available": False,
            "reason": "insufficient_data",
            "min_required": 35,
            "got": len(candles),
        }

    closes = [c.close for c in candles]
    series = _macd_series(closes)
    if not series["line"]:
        return {"available": False, "reason": "macd_uncomputable"}

    cross = _recent_crossover(series["line"], series["signal"])
    mom = _histogram_momentum(series["histogram"])
    div_hint = _histogram_divergence_hint(candles, series["histogram"])

    line_last = round(series["line"][-1], 6)
    sig_last = round(series["signal"][-1], 6)
    hist_last = round(series["histogram"][-1], 6)

    return {
        "available": True,
        "kind": "measured",
        "timeframe": (primary_timeframe or "1h").upper(),
        "line": line_last,
        "signal": sig_last,
        "histogram": hist_last,
        "crossover_state": cross,
        "histogram_momentum": mom,
        "divergence_hint": div_hint,
        "side_of_zero": "above" if line_last > 0 else "below",
        "notes": (
            "Cross above zero and recent bullish crossover support a "
            "bullish bias; histogram rising strengthens momentum. "
            "Bull/bear divergence hints are early-warning only and "
            "must be confirmed by structure + price action."
        ),
    }