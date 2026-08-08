"""
Persistent Market Memory for Confluence X.

Stores market snapshots and changes over time to enable
historical context queries.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


@dataclass
class MarketSnapshot:
    """A snapshot of market state at a point in time."""
    symbol: str
    timestamp: float = field(default_factory=time.time)
    
    # Price
    price: float = 0.0
    bid: float = 0.0
    ask: float = 0.0
    spread: float = 0.0
    
    # Regime
    regime: str = 'neutral'
    trend: str = ''
    volatility: str = 'normal'
    
    # Structure
    last_bos: Optional[str] = None  # Break of structure
    last_choch: Optional[str] = None  # Change of character
    key_support: List[float] = field(default_factory=list)
    key_resistance: List[float] = field(default_factory=list)
    
    # Liquidity
    liquidity_highs: List[float] = field(default_factory=list)
    liquidity_lows: List[float] = field(default_factory=list)
    swept_highs: List[float] = field(default_factory=list)
    swept_lows: List[float] = field(default_factory=list)
    
    # Session
    session: str = ''
    session_high: float = 0.0
    session_low: float = 0.0
    
    # Indicators
    ema_20: float = 0.0
    ema_50: float = 0.0
    rsi: float = 50.0
    adx: float = 0.0
    atr: float = 0.0
    
    # News
    news_state: str = ''
    next_event: Optional[str] = None
    
    # Fibonacci
    active_fib_leg: Optional[dict] = None
    
    def to_dict(self) -> dict:
        return {
            'symbol': self.symbol,
            'timestamp': self.timestamp,
            'price': self.price,
            'bid': self.bid,
            'ask': self.ask,
            'spread': self.spread,
            'regime': self.regime,
            'trend': self.trend,
            'volatility': self.volatility,
            'last_bos': self.last_bos,
            'last_choch': self.last_choch,
            'key_support': self.key_support,
            'key_resistance': self.key_resistance,
            'liquidity_highs': self.liquidity_highs,
            'liquidity_lows': self.liquidity_lows,
            'swept_highs': self.swept_highs,
            'swept_lows': self.swept_lows,
            'session': self.session,
            'session_high': self.session_high,
            'session_low': self.session_low,
            'ema_20': self.ema_20,
            'ema_50': self.ema_50,
            'rsi': self.rsi,
            'adx': self.adx,
            'atr': self.atr,
            'news_state': self.news_state,
            'next_event': self.next_event,
            'active_fib_leg': self.active_fib_leg,
        }


class MarketMemory:
    """
    Persistent Market Memory.
    
    Stores market snapshots and changes over time to enable
    historical context queries.
    """
    
    def __init__(self, max_snapshots_per_symbol: int = 1000):
        self._snapshots: Dict[str, List[MarketSnapshot]] = {}
        self._max_snapshots = max_snapshots_per_symbol
    
    def record_snapshot(self, snapshot: MarketSnapshot):
        """Record a market snapshot."""
        symbol = snapshot.symbol
        
        if symbol not in self._snapshots:
            self._snapshots[symbol] = []
        
        self._snapshots[symbol].append(snapshot)
        
        # Trim to max snapshots
        if len(self._snapshots[symbol]) > self._max_snapshots:
            self._snapshots[symbol] = self._snapshots[symbol][-self._max_snapshots:]
    
    def get_latest(self, symbol: str) -> Optional[MarketSnapshot]:
        """Get the latest snapshot for a symbol."""
        snapshots = self._snapshots.get(symbol, [])
        return snapshots[-1] if snapshots else None
    
    def get_history(self, symbol: str, limit: int = 100) -> List[MarketSnapshot]:
        """Get snapshot history for a symbol."""
        snapshots = self._snapshots.get(symbol, [])
        return snapshots[-limit:]
    
    def get_snapshot_at(self, symbol: str, timestamp: float) -> Optional[MarketSnapshot]:
        """Get the snapshot closest to a timestamp."""
        snapshots = self._snapshots.get(symbol, [])
        if not snapshots:
            return None
        
        # Find closest snapshot
        closest = min(snapshots, key=lambda s: abs(s.timestamp - timestamp))
        return closest
    
    def get_snapshots_in_range(self, symbol: str, 
                               start_time: float, end_time: float) -> List[MarketSnapshot]:
        """Get snapshots within a time range."""
        snapshots = self._snapshots.get(symbol, [])
        return [
            s for s in snapshots
            if start_time <= s.timestamp <= end_time
        ]
    
    def get_changes(self, symbol: str, 
                    since_timestamp: float) -> Dict[str, any]:
        """Get changes since a timestamp."""
        snapshots = self._snapshots.get(symbol, [])
        if not snapshots:
            return {}
        
        # Get latest snapshot
        latest = snapshots[-1]
        
        # Get snapshot at since_timestamp
        old = self.get_snapshot_at(symbol, since_timestamp)
        if not old:
            return {'new_data': True}
        
        changes = {}
        
        # Price changes
        if latest.price != old.price:
            changes['price_change'] = latest.price - old.price
            changes['price_change_pct'] = (latest.price - old.price) / old.price * 100 if old.price > 0 else 0
        
        # Regime changes
        if latest.regime != old.regime:
            changes['regime_change'] = {'from': old.regime, 'to': latest.regime}
        
        # Trend changes
        if latest.trend != old.trend:
            changes['trend_change'] = {'from': old.trend, 'to': latest.trend}
        
        # Structure changes
        if latest.last_bos != old.last_bos:
            changes['bos_change'] = latest.last_bos
        
        if latest.last_choch != old.last_choch:
            changes['choch_change'] = latest.last_choch
        
        # Liquidity changes
        new_swept_highs = [h for h in latest.swept_highs if h not in old.swept_highs]
        new_swept_lows = [l for l in latest.swept_lows if l not in old.swept_lows]
        
        if new_swept_highs:
            changes['new_swept_highs'] = new_swept_highs
        if new_swept_lows:
            changes['new_swept_lows'] = new_swept_lows
        
        return changes
    
    def get_summary(self, symbol: str) -> dict:
        """Get a summary of market memory for a symbol."""
        snapshots = self._snapshots.get(symbol, [])
        if not snapshots:
            return {'symbol': symbol, 'snapshots': 0}
        
        latest = snapshots[-1]
        first = snapshots[0]
        
        return {
            'symbol': symbol,
            'snapshots': len(snapshots),
            'first_snapshot': first.timestamp,
            'latest_snapshot': latest.timestamp,
            'current_price': latest.price,
            'current_regime': latest.regime,
            'current_trend': latest.trend,
            'price_range': {
                'min': min(s.price for s in snapshots if s.price > 0),
                'max': max(s.price for s in snapshots if s.price > 0),
            },
        }
    
    def cleanup(self, max_age_seconds: float = 86400):
        """Remove snapshots older than max_age_seconds."""
        cutoff = time.time() - max_age_seconds
        
        for symbol in list(self._snapshots.keys()):
            original_count = len(self._snapshots[symbol])
            self._snapshots[symbol] = [
                s for s in self._snapshots[symbol]
                if s.timestamp > cutoff
            ]
            removed = original_count - len(self._snapshots[symbol])
            if removed > 0:
                log.info("Cleaned up %d snapshots for %s", removed, symbol)
