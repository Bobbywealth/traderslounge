"""Module 2 — ADR Calculator (+15).

Tracks the daily range and gives full points only when the proposed trade
direction is NOT against an exhausted/extreme reading:
- BUY: not near ADR high (no buying the top)
- SELL: not near ADR low (no selling the bottom)
- ADR used > 80% with no rejection → 0 pts
- ADR used < 50% → full points (continuation valid)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from ..data_types import Candle, Direction, ModuleResult
from ..indicators import atr

MAX_POINTS = 15


@dataclass
class AdrSnapshot:
    adr: float
    day_open: float
    day_high: float
    day_low: float
    current_range: float
    percent_used: float
    adr_high: float
    adr_low: float
    near_adr_high: bool
    near_adr_low: bool
    exhausted: bool


def snapshot(d1: List[Candle], period: int = 5) -> Optional[AdrSnapshot]:
    if len(d1) < period + 2:
        return None
    a = atr(d1[:-1], period)  # ATR on completed days
    if a is None or a <= 0:
        return None
    today = d1[-1]
    current_range = today.high - today.low
    pct = (current_range / a) * 100
    adr_high = today.open + a / 2
    adr_low = today.open - a / 2
    tol = a * 0.15
    return AdrSnapshot(
        adr=a,
        day_open=today.open,
        day_high=today.high,
        day_low=today.low,
        current_range=current_range,
        percent_used=pct,
        adr_high=adr_high,
        adr_low=adr_low,
        near_adr_high=today.close >= adr_high - tol,
        near_adr_low=today.close <= adr_low + tol,
        exhausted=pct >= 80,
    )


def evaluate(d1: List[Candle], proposed_direction: Direction) -> ModuleResult:
    snap = snapshot(d1)
    if snap is None:
        return ModuleResult(
            name="adr",
            points=0,
            max_points=MAX_POINTS,
            direction=Direction.NEUTRAL,
            reason="Insufficient daily data",
        )
    details = snap.__dict__.copy()
    if proposed_direction == Direction.BUY and snap.near_adr_high:
        return ModuleResult("adr", 0, MAX_POINTS, Direction.NEUTRAL,
                            "Near ADR high — avoid new buys", details)
    if proposed_direction == Direction.SELL and snap.near_adr_low:
        return ModuleResult("adr", 0, MAX_POINTS, Direction.NEUTRAL,
                            "Near ADR low — avoid new sells", details)
    if snap.exhausted:
        return ModuleResult("adr", MAX_POINTS // 2, MAX_POINTS, proposed_direction,
                            f"ADR {snap.percent_used:.0f}% used — reduced confidence", details)
    if snap.percent_used < 50:
        return ModuleResult("adr", MAX_POINTS, MAX_POINTS, proposed_direction,
                            f"ADR {snap.percent_used:.0f}% used — continuation valid", details)
    return ModuleResult("adr", MAX_POINTS, MAX_POINTS, proposed_direction,
                        f"ADR {snap.percent_used:.0f}% used — room to run", details)
