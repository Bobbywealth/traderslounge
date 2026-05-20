"""Module 6 — RSI Confirmation Filter (+5).

Confirmation only. Awards points when RSI is oversold (BUY) /
overbought (SELL) OR shows divergence aligned with the trade direction.
"""
from __future__ import annotations

from typing import List

from ..data_types import Candle, Direction, ModuleResult
from ..indicators import detect_swings, rsi

MAX_POINTS = 5
PERIOD = 14
OVERSOLD = 30
OVERBOUGHT = 70


def evaluate(ltf: List[Candle], proposed_direction: Direction) -> ModuleResult:
    if len(ltf) < PERIOD + 5:
        return ModuleResult("rsi", 0, MAX_POINTS, Direction.NEUTRAL,
                            "Insufficient data for RSI")
    closes = [c.close for c in ltf]
    series = rsi(closes, PERIOD)
    last = series[-1]

    # Divergence check: compare last two swing highs/lows in price vs RSI
    swings = detect_swings(ltf, left_right=2)[-10:]
    highs = [s for s in swings if s.type == "high"][-2:]
    lows = [s for s in swings if s.type == "low"][-2:]
    bull_div = (
        len(lows) == 2
        and lows[1].price < lows[0].price
        and series[lows[1].index] > series[lows[0].index]
    )
    bear_div = (
        len(highs) == 2
        and highs[1].price > highs[0].price
        and series[highs[1].index] < series[highs[0].index]
    )
    details = {"rsi": last, "bull_div": bull_div, "bear_div": bear_div}

    if proposed_direction == Direction.BUY and (last <= OVERSOLD or bull_div):
        why = "oversold" if last <= OVERSOLD else "bullish divergence"
        return ModuleResult("rsi", MAX_POINTS, MAX_POINTS, Direction.BUY,
                            f"RSI {last:.1f} — {why}", details)
    if proposed_direction == Direction.SELL and (last >= OVERBOUGHT or bear_div):
        why = "overbought" if last >= OVERBOUGHT else "bearish divergence"
        return ModuleResult("rsi", MAX_POINTS, MAX_POINTS, Direction.SELL,
                            f"RSI {last:.1f} — {why}", details)
    return ModuleResult("rsi", 0, MAX_POINTS, Direction.NEUTRAL,
                        f"RSI {last:.1f} — no confirmation", details)
