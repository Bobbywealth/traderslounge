"""Core data types shared across scanner modules."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class Direction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    NEUTRAL = "NEUTRAL"


class Tier(str, Enum):
    STRONG = "STRONG"
    GOOD = "GOOD"
    WATCHLIST = "WATCHLIST"
    NO_TRADE = "NO_TRADE"


class Timeframe(str, Enum):
    D1 = "D1"
    H4 = "H4"
    H1 = "H1"
    M15 = "M15"
    M5 = "M5"
    M1 = "M1"


@dataclass
class Candle:
    time: int  # epoch seconds
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


@dataclass
class Swing:
    index: int
    time: int
    price: float
    type: str  # "high" or "low"
    label: Optional[str] = None  # HH / HL / LH / LL


@dataclass
class ModuleResult:
    """What every module returns to the scoring engine."""
    name: str
    points: int  # 0 .. module max
    max_points: int
    direction: Direction = Direction.NEUTRAL
    reason: str = ""
    details: dict = field(default_factory=dict)


@dataclass
class MarketSnapshot:
    """Bundle of candles per timeframe for one pair."""
    pair: str
    d1: List[Candle] = field(default_factory=list)
    h4: List[Candle] = field(default_factory=list)
    h1: List[Candle] = field(default_factory=list)
    m15: List[Candle] = field(default_factory=list)
    m5: List[Candle] = field(default_factory=list)
    m1: List[Candle] = field(default_factory=list)

    def ltf(self) -> List[Candle]:
        """Preferred LTF for entry detection (15M)."""
        return self.m15 or self.m5 or self.m1
