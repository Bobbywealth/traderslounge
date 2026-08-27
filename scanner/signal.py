"""Signal output object — matches spec §5 Signal Output Format."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from .data_types import Direction, Tier


class LifecycleState(Enum):
    OBSERVING = "observing"
    DEVELOPING = "developing"
    NEAR_TRIGGER = "near_trigger"
    READY = "ready"
    ACTIVE = "active"
    TP1_REACHED = "tp1_reached"
    TP2_REACHED = "tp2_reached"
    TP3_REACHED = "tp3_reached"
    BREAK_EVEN = "break_even"
    STOPPED = "stopped"
    EXPIRED = "expired"
    INVALIDATED = "invalidated"
    BLOCKED_BY_NEWS = "blocked_by_news"
    BLOCKED_BY_DATA = "blocked_by_data"
    BLOCKED_BY_SPREAD = "blocked_by_spread"
    BLOCKED_BY_RISK = "blocked_by_risk"
    CLOSED = "closed"


@dataclass
class Signal:
    pair: str
    direction: Direction
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    tp3: float
    confidence_score: int  # 0..80
    tier: Tier
    reasons: List[str] = field(default_factory=list)
    risk_level: str = "Medium"  # Low / Medium / High
    session: str = "Unknown"
    adr_status: str = ""
    htf_bias: str = "Neutral"
    pattern: str = ""
    coverage: float = 0.0  # 0-1
    confidence_tier: str = "watch"  # high / qualified / developing / watch
    missing_categories: List[str] = field(default_factory=list)

    def telegram_card(self) -> str:
        return (
            f"[{self.tier.value}] {self.pair} {self.direction.value}\n"
            f"Score: {self.confidence_score}/80\n"
            f"Entry: {self.entry:.5f}\n"
            f"SL:    {self.stop_loss:.5f}\n"
            f"TP1:   {self.tp1:.5f}\n"
            f"TP2:   {self.tp2:.5f}\n"
            f"TP3:   {self.tp3:.5f}\n"
            f"HTF Bias: {self.htf_bias}\n"
            f"ADR: {self.adr_status}\n"
            f"Session: {self.session}\n"
            f"Pattern: {self.pattern}\n"
            f"Risk: {self.risk_level}\n"
            f"Reasons: {'; '.join(self.reasons)}"
        )


def tier_for(score: int) -> Tier:
    if score >= 65:
        return Tier.STRONG
    if score >= 50:
        return Tier.GOOD
    if score >= 35:
        return Tier.WATCHLIST
    return Tier.NO_TRADE


def session_for(epoch_seconds: int) -> str:
    """Return the trading session tag for ``epoch_seconds`` (UTC).

    Sessions are defined as the open hours when each market actively
    trades, with overlaps where liquidity is highest. XAUUSD trades
    23h/day with thin liquidity 21:00–00:00 UTC, so we label that
    After Hours rather than claiming an "Asian" open that doesn't
    match the real volumes.

    Boundaries (UTC):
      - Asian         : 00:00 - 06:59
      - London        : 07:00 - 11:59
      - London/NY     : 12:00 - 16:59  (highest liquidity for FX/gold)
      - New York      : 17:00 - 20:59
      - After Hours   : 21:00 - 23:59
    """
    import datetime as _dt
    dt = _dt.datetime.fromtimestamp(epoch_seconds, tz=_dt.timezone.utc)
    h = dt.hour
    if 0 <= h < 7:
        return "Asian"
    if 7 <= h < 12:
        return "London"
    if 12 <= h < 17:
        return "London/NY"
    if 17 <= h < 21:
        return "New York"
    return "After Hours"


def is_high_impact_session(epoch_seconds: int) -> bool:
    """True if the bar time lands in the London/NY overlap window.

    The overlap is when most USD/CAD/EUR/GBP pairs see their biggest
    moves, and the XAUUSD ADR is most likely to exhaust. ConfluenceX
    uses this to weight timing-readiness scores for short-term plays.
    """
    import datetime as _dt
    dt = _dt.datetime.fromtimestamp(epoch_seconds, tz=_dt.timezone.utc)
    return 12 <= dt.hour < 17
