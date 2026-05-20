"""Module 5 — Liquidity Sweep Detector (+10).

Looks for a recent candle that pierced beyond a key reference level (prev
day high/low or recent swing high/low) and then closed back inside,
signaling a stop-run + rejection.
"""
from __future__ import annotations

from typing import List

from ..data_types import Candle, Direction, ModuleResult
from ..indicators import detect_swings

MAX_POINTS = 10
LOOKBACK = 8  # candles to check for the sweep


def evaluate(
    ltf: List[Candle],
    d1: List[Candle],
    proposed_direction: Direction,
) -> ModuleResult:
    if len(ltf) < LOOKBACK + 2 or len(d1) < 2:
        return ModuleResult("liquidity", 0, MAX_POINTS, Direction.NEUTRAL,
                            "Insufficient data")
    prev_day = d1[-2]
    pdh = prev_day.high
    pdl = prev_day.low
    swings = detect_swings(ltf, left_right=2)
    recent_highs = [s.price for s in swings if s.type == "high"][-3:]
    recent_lows = [s.price for s in swings if s.type == "low"][-3:]
    recent = ltf[-LOOKBACK:]

    if proposed_direction == Direction.BUY:
        # Looking for a sweep below pdl / recent low + bullish reclaim
        target = max([pdl] + recent_lows) if recent_lows else pdl
        for c in recent:
            if c.low < target and c.close > target:
                return ModuleResult("liquidity", MAX_POINTS, MAX_POINTS, Direction.BUY,
                                    "Liquidity sweep below level + bullish reclaim",
                                    {"swept_level": target, "swept_low": c.low,
                                     "reclaim_close": c.close})
        return ModuleResult("liquidity", 0, MAX_POINTS, Direction.NEUTRAL,
                            "No bullish liquidity sweep detected",
                            {"target_level": target})

    if proposed_direction == Direction.SELL:
        target = min([pdh] + recent_highs) if recent_highs else pdh
        for c in recent:
            if c.high > target and c.close < target:
                return ModuleResult("liquidity", MAX_POINTS, MAX_POINTS, Direction.SELL,
                                    "Liquidity sweep above level + bearish rejection",
                                    {"swept_level": target, "swept_high": c.high,
                                     "rejection_close": c.close})
        return ModuleResult("liquidity", 0, MAX_POINTS, Direction.NEUTRAL,
                            "No bearish liquidity sweep detected",
                            {"target_level": target})

    return ModuleResult("liquidity", 0, MAX_POINTS, Direction.NEUTRAL,
                        "No direction proposed")
