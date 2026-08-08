"""
Session Intelligence Engine for Confluence X.

Provides session detection, session briefs, and session-aware context.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class TradingSession(Enum):
    """Major trading sessions (UTC hours)."""
    ASIAN = 'asian'  # 00:00 - 07:00 UTC
    LONDON = 'london'  # 07:00 - 12:00 UTC
    LONDON_NY_OVERLAP = 'london_ny_overlap'  # 12:00 - 16:00 UTC
    NEW_YORK = 'new_york'  # 16:00 - 21:00 UTC
    AFTER_HOURS = 'after_hours'  # 21:00 - 00:00 UTC


# Session time ranges (UTC hours)
SESSION_TIMES = {
    TradingSession.ASIAN: (0, 7),
    TradingSession.LONDON: (7, 12),
    TradingSession.LONDON_NY_OVERLAP: (12, 16),
    TradingSession.NEW_YORK: (16, 21),
    TradingSession.AFTER_HOURS: (21, 24),
}


@dataclass
class SessionRange:
    """Session price range."""
    session: TradingSession
    high: float = 0.0
    low: float = float('inf')
    open: float = 0.0
    close: float = 0.0
    
    @property
    def range(self) -> float:
        """Calculate session range."""
        if self.high == 0 or self.low == float('inf'):
            return 0.0
        return self.high - self.low
    
    @property
    def midpoint(self) -> float:
        """Calculate session midpoint."""
        if self.high == 0 or self.low == float('inf'):
            return 0.0
        return (self.high + self.low) / 2


@dataclass
class SessionContext:
    """Complete session context for a symbol."""
    symbol: str
    current_session: TradingSession
    previous_session: TradingSession
    session_range: SessionRange
    previous_session_range: Optional[SessionRange] = None
    prior_day_high: Optional[float] = None
    prior_day_low: Optional[float] = None
    prior_day_close: Optional[float] = None
    prior_week_high: Optional[float] = None
    prior_week_low: Optional[float] = None
    asian_range: Optional[SessionRange] = None
    london_range: Optional[SessionRange] = None
    ny_range: Optional[SessionRange] = None
    adr: Optional[float] = None
    atr: Optional[float] = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class SessionBrief:
    """A structured session brief."""
    session: TradingSession
    timestamp: float
    symbol: str
    direction_bias: str
    key_levels: Dict[str, float]
    liquidity_highs: List[float]
    liquidity_lows: List[float]
    session_range: float
    adr_usage_pct: float
    volatility_regime: str
    news_status: str
    summary: str


class SessionEngine:
    """
    Session Intelligence Engine.
    
    Detects trading sessions, generates session briefs, and provides
    session-aware context for trading decisions.
    """
    
    def __init__(self):
        self._session_ranges: Dict[str, Dict[TradingSession, SessionRange]] = {}
        self._session_prices: Dict[str, Dict[TradingSession, List[float]]] = {}
    
    @staticmethod
    def get_current_session(utc_hour: Optional[int] = None) -> TradingSession:
        """Get the current trading session based on UTC hour."""
        if utc_hour is None:
            utc_hour = datetime.now(timezone.utc).hour
        
        for session, (start, end) in SESSION_TIMES.items():
            if start <= utc_hour < end:
                return session
        
        return TradingSession.AFTER_HOURS
    
    @staticmethod
    def get_previous_session(current: TradingSession) -> TradingSession:
        """Get the previous trading session."""
        sessions = list(TradingSession)
        idx = sessions.index(current)
        return sessions[(idx - 1) % len(sessions)]
    
    def update_candle(self, symbol: str, session: TradingSession, 
                      open_price: float, high: float, low: float, close: float):
        """Update session range with a new candle."""
        if symbol not in self._session_ranges:
            self._session_ranges[symbol] = {}
        if session not in self._session_ranges[symbol]:
            self._session_ranges[symbol][session] = SessionRange(
                session=session,
                open=open_price,
                high=high,
                low=low,
                close=close,
            )
        else:
            rng = self._session_ranges[symbol][session]
            rng.high = max(rng.high, high)
            rng.low = min(rng.low, low)
            rng.close = close
        
        # Track prices for liquidity analysis
        if symbol not in self._session_prices:
            self._session_prices[symbol] = {}
        if session not in self._session_prices[symbol]:
            self._session_prices[symbol][session] = []
        self._session_prices[symbol][session].append(high)
        self._session_prices[symbol][session].append(low)
    
    def get_session_range(self, symbol: str, session: TradingSession) -> Optional[SessionRange]:
        """Get the price range for a session."""
        return self._session_ranges.get(symbol, {}).get(session)
    
    def get_session_context(self, symbol: str) -> SessionContext:
        """Get complete session context for a symbol."""
        current_session = self.get_current_session()
        previous_session = self.get_previous_session(current_session)
        
        session_range = self.get_session_range(symbol, current_session)
        previous_session_range = self.get_session_range(symbol, previous_session)
        
        return SessionContext(
            symbol=symbol,
            current_session=current_session,
            previous_session=previous_session,
            session_range=session_range or SessionRange(session=current_session),
            previous_session_range=previous_session_range,
        )
    
    def generate_brief(self, symbol: str, 
                       current_price: float,
                       adr: Optional[float] = None,
                       atr: Optional[float] = None,
                       news_status: str = 'UNKNOWN') -> SessionBrief:
        """Generate a structured session brief for a symbol."""
        context = self.get_session_context(symbol)
        current_session = context.current_session
        session_range = context.session_range
        
        # Calculate ADR usage
        adr_usage_pct = 0.0
        if adr and adr > 0:
            adr_usage_pct = (session_range.range / adr) * 100
        
        # Determine volatility regime
        volatility_regime = 'normal'
        if atr and current_price > 0:
            atr_pct = (atr / current_price) * 100
            if atr_pct > 2.0:
                volatility_regime = 'high'
            elif atr_pct < 0.5:
                volatility_regime = 'low'
        
        # Generate summary
        summary = self._generate_summary(
            symbol, current_session, session_range, 
            current_price, adr_usage_pct, volatility_regime, news_status
        )
        
        return SessionBrief(
            session=current_session,
            timestamp=time.time(),
            symbol=symbol,
            direction_bias='neutral',
            key_levels={
                'session_high': session_range.high,
                'session_low': session_range.low,
                'session_midpoint': session_range.midpoint,
            },
            liquidity_highs=[],
            liquidity_lows=[],
            session_range=session_range.range,
            adr_usage_pct=adr_usage_pct,
            volatility_regime=volatility_regime,
            news_status=news_status,
            summary=summary,
        )
    
    def _generate_summary(self, symbol: str, session: TradingSession,
                          session_range: SessionRange, current_price: float,
                          adr_usage_pct: float, volatility_regime: str,
                          news_status: str) -> str:
        """Generate a human-readable session summary."""
        lines = []
        lines.append(f"{symbol} - {session.value.upper()}")
        lines.append(f"Session Range: {session_range.range:.2f}")
        lines.append(f"Current Price: {current_price:.2f}")
        
        if session_range.high > 0:
            lines.append(f"Session High: {session_range.high:.2f}")
        if session_range.low < float('inf'):
            lines.append(f"Session Low: {session_range.low:.2f}")
        
        if adr_usage_pct > 0:
            lines.append(f"ADR Usage: {adr_usage_pct:.1f}%")
        
        lines.append(f"Volatility: {volatility_regime}")
        lines.append(f"News: {news_status}")
        
        return '\n'.join(lines)
    
    def reset_session(self, symbol: str, session: Optional[TradingSession] = None):
        """Reset session data for a symbol."""
        if session:
            if symbol in self._session_ranges:
                self._session_ranges[symbol].pop(session, None)
            if symbol in self._session_prices:
                self._session_prices[symbol].pop(session, None)
        else:
            self._session_ranges.pop(symbol, None)
            self._session_prices.pop(symbol, None)
