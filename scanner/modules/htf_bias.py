"""Module 1 — HTF Bias Detector (+20).

Daily + 4H + 1H must all agree on direction for full points. Uses EMA20 vs
EMA50 alignment as the per-timeframe vote. If all three agree → +20 with
that direction; otherwise +0 NEUTRAL.
"""
from __future__ import annotations

from typing import List

from ..data_types import Candle, Direction, ModuleResult
from ..indicators import ema

MAX_POINTS = 20


def _tf_bias(candles: List[Candle]) -> Direction:
    if len(candles) < 60:
        return Direction.NEUTRAL
    closes = [c.close for c in candles]
    e20 = ema(closes, 20)
    e50 = ema(closes, 50)
    price = closes[-1]
    score = 0
    if e20[-1] > e50[-1]:
        score += 1
    elif e20[-1] < e50[-1]:
        score -= 1
    if len(closes) >= 200:
        e200 = ema(closes, 200)
        if price > e200[-1]:
            score += 1
        elif price < e200[-1]:
            score -= 1
    if score > 0:
        return Direction.BUY
    if score < 0:
        return Direction.SELL
    return Direction.NEUTRAL


def evaluate(d1: List[Candle], h4: List[Candle], h1: List[Candle]) -> ModuleResult:
    d = _tf_bias(d1)
    h4b = _tf_bias(h4)
    h1b = _tf_bias(h1)
    details = {"d1": d.value, "h4": h4b.value, "h1": h1b.value}
    if d == h4b == h1b and d != Direction.NEUTRAL:
        return ModuleResult(
            name="htf_bias",
            points=MAX_POINTS,
            max_points=MAX_POINTS,
            direction=d,
            reason=f"D1/H4/H1 all {d.value}",
            details=details,
        )
    return ModuleResult(
        name="htf_bias",
        points=0,
        max_points=MAX_POINTS,
        direction=Direction.NEUTRAL,
        reason="Timeframes not aligned",
        details=details,
    )
