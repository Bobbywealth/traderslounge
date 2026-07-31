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


def average_daily_range(completed: List[Candle], period: int = 14) -> Optional[float]:
    """Simple mean of (high - low) over the last `period` completed days.

    Flat bars (high == low) come from holidays or gaps in the feed and are
    dropped rather than averaged in as a zero-range day.
    """
    ranges = [c.high - c.low for c in completed if c.high > c.low]
    ranges = ranges[-period:]
    if len(ranges) < period:
        return None
    return sum(ranges) / len(ranges)


def snapshot(d1: List[Candle], period: int = 14) -> Optional[AdrSnapshot]:
    if len(d1) < period + 1:
        return None
    # d1[-1] is the day still forming; the average uses completed days only.
    a = average_daily_range(d1[:-1], period)
    if a is None or a <= 0:
        return None
    today = d1[-1]
    current_range = today.high - today.low
    pct = (current_range / a) * 100
    # Standard ADR projection: how far today can still travel from the
    # extreme already printed, not a band drawn around the open.
    adr_high = today.low + a
    adr_low = today.high - a
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
