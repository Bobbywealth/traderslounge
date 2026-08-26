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
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from ..data_types import Candle, Direction, ModuleResult
from ..indicators import atr

MAX_POINTS = 15

# NY session opens at 17:00 UTC during US summer (EDT) or 17:00 UTC during
# winter (EST) — both fall on 17:00 UTC for the major FX/indices we cover.
# Gold (XAUUSD) follows the same convention used by the MT4 Market Maker
# ADR 123 indicator.
NY_SESSION_OPEN_UTC_HOUR = 17


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


def _ny_session_window(now_utc: datetime) -> tuple[int, int]:
    """Return (session_open_epoch, session_close_epoch) for the NY session
    containing `now_utc`. NY session runs 17:00 UTC -> next-day 17:00 UTC.
    """
    if now_utc.hour >= NY_SESSION_OPEN_UTC_HOUR:
        open_dt = now_utc.replace(
            hour=NY_SESSION_OPEN_UTC_HOUR, minute=0, second=0, microsecond=0
        )
    else:
        open_dt = (now_utc - timedelta(days=1)).replace(
            hour=NY_SESSION_OPEN_UTC_HOUR, minute=0, second=0, microsecond=0
        )
    close_dt = open_dt + timedelta(days=1)
    return int(open_dt.timestamp()), int(close_dt.timestamp())


def _session_anchored_metrics(
    intraday: List[Candle], now_epoch: Optional[int] = None
) -> Optional[dict]:
    """Build today's NY-session open/high/low from intraday candles.

    Returns None when there isn't enough data to cover the current session.
    """
    if not intraday:
        return None
    now_epoch = now_epoch or int(datetime.now(timezone.utc).timestamp())
    open_ts, close_ts = _ny_session_window(
        datetime.fromtimestamp(now_epoch, tz=timezone.utc)
    )
    session_bars = [
        c for c in intraday
        if open_ts <= int(c.time) < close_ts and c.high > 0 and c.low > 0
    ]
    import logging
    logging.getLogger("adr").info(
        "NY session window: open=%s close=%s intraday_count=%d matched=%d first=%s last=%s",
        open_ts, close_ts, len(intraday), len(session_bars),
        session_bars[0].time if session_bars else None,
        session_bars[-1].time if session_bars else None,
    )
    if len(session_bars) < 2:
        return None
    # First bar's open anchors the session. High/low span the session so far.
    first_open = session_bars[0].open
    session_high = max(c.high for c in session_bars)
    session_low = min(c.low for c in session_bars)
    current_range = session_high - session_low
    return {
        "day_open": first_open,
        "day_high": session_high,
        "day_low": session_low,
        "current_range": current_range,
        "session_open_epoch": open_ts,
        "session_close_epoch": close_ts,
    }


def snapshot(
    d1: List[Candle],
    period: int = 5,
    intraday: Optional[List[Candle]] = None,
) -> Optional[AdrSnapshot]:
    if len(d1) < period + 2:
        return None
    a = atr(d1[:-1], period)  # ATR on completed days
    if a is None or a <= 0:
        return None
    today = d1[-1]
    metrics = _session_anchored_metrics(intraday) if intraday else None
    if metrics is not None:
        day_open = metrics["day_open"]
        day_high = metrics["day_high"]
        day_low = metrics["day_low"]
        current_range = metrics["current_range"]
    else:
        day_open = today.open
        day_high = today.high
        day_low = today.low
        current_range = today.high - today.low
    pct = (current_range / a) * 100
    adr_high = day_open + a / 2
    adr_low = day_open - a / 2
    tol = a * 0.15
    return AdrSnapshot(
        adr=a,
        day_open=day_open,
        day_high=day_high,
        day_low=day_low,
        current_range=current_range,
        percent_used=pct,
        adr_high=adr_high,
        adr_low=adr_low,
        near_adr_high=day_high >= adr_high - tol,
        near_adr_low=day_low <= adr_low + tol,
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
