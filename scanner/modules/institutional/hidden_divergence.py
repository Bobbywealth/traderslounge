"""Section 4 (RSI hidden divergence) — Phase 1.

The existing RSI scoring module in :mod:`scanner.modules.rsi_filter`
already detects *regular* divergence (price vs RSI disagree at extremes,
signaling reversal). This module adds *hidden* divergence (price vs RSI
disagree with the prevailing trend, signaling continuation).

Definitions:
  - Hidden bullish:  price makes a higher low   while RSI makes a lower low
                    → trend continuation up.
  - Hidden bearish:  price makes a lower high   while RSI makes a higher high
                    → trend continuation down.

Report-only — never feeds the BWTS score.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from scanner.data_types import Candle, MarketSnapshot
from scanner.indicators import detect_swings, rsi


def _select_candles(snapshot: MarketSnapshot, primary_tf: str) -> List[Candle]:
    tf = (primary_tf or "1h").upper()
    return {
        "D1": snapshot.d1,
        "H4": snapshot.h4,
        "H1": snapshot.h1,
        "M15": snapshot.m15,
        "M5": snapshot.m5,
    }.get(tf) or snapshot.h1 or snapshot.ltf()


def _classify(price_a: float, price_b: float) -> str:
    if price_b > price_a:
        return "higher"
    if price_b < price_a:
        return "lower"
    return "equal"


def compute(
    snapshot: MarketSnapshot,
    primary_timeframe: Optional[str] = None,
) -> Dict[str, Any]:
    candles = _select_candles(snapshot, primary_timeframe or "1h")
    period = 14
    if len(candles) < period + 5:
        return {
            "available": False,
            "reason": "insufficient_data",
            "min_required": period + 5,
            "got": len(candles),
        }

    closes = [c.close for c in candles]
    series = rsi(closes, period)
    swings = detect_swings(candles, left_right=2)[-10:]
    highs = [s for s in swings if s.type == "high"][-2:]
    lows = [s for s in swings if s.type == "low"][-2:]

    hidden_bull = (
        len(lows) == 2
        and _classify(lows[0].price, lows[1].price) == "higher"
        and series[lows[1].index] < series[lows[0].index]
    )
    hidden_bear = (
        len(highs) == 2
        and _classify(highs[0].price, highs[1].price) == "lower"
        and series[highs[1].index] > series[highs[0].index]
    )

    direction = "neutral"
    if hidden_bull:
        direction = "bullish_continuation"
    elif hidden_bear:
        direction = "bearish_continuation"

    return {
        "available": True,
        "kind": "measured",
        "pattern": "hidden",
        "direction": direction,
        "hidden_bullish": hidden_bull,
        "hidden_bearish": hidden_bear,
        "rsi_last": round(series[-1], 2) if series else None,
        "swing_window": [
            {
                "type": s.type,
                "index": s.index,
                "price": s.price,
                "rsi": round(series[s.index], 2),
            }
            for s in (highs + lows)
        ],
        "notes": (
            "Hidden divergence signals trend continuation, complementary "
            "to the regular divergence the LTF rsi_filter module emits. "
            "Use with HTF bias — never in isolation."
        ),
    }