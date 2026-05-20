"""Signal output object — matches spec §5 Signal Output Format."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from .data_types import Direction, Tier


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
    """Crude UTC-hour session tagger. Spec calls for Asian/London/NY."""
    import datetime as _dt
    h = _dt.datetime.utcfromtimestamp(epoch_seconds).hour
    if 0 <= h < 7:
        return "Asian"
    if 7 <= h < 12:
        return "London"
    if 12 <= h < 16:
        return "London/NY Overlap"
    if 16 <= h < 21:
        return "New York"
    return "After Hours"
