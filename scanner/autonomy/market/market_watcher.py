"""
Market Watcher Agent for Confluence X.

Maintains real-time market data, candle streams, and market state.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional

log = logging.getLogger(__name__)


class MarketState(Enum):
    """Market state for an instrument."""
    CLOSED = 'closed'
    PRE_MARKET = 'pre_market'
    OPEN = 'open'
    POST_MARKET = 'post_market'
    HOLIDAY = 'holiday'


@dataclass
class MarketTick:
    """A single market tick."""
    symbol: str
    bid: float
    ask: float
    mid: float
    spread: float
    timestamp: float
    provider: str
    provider_timestamp: Optional[float] = None
    received_timestamp: float = field(default_factory=time.time)
    is_stale: bool = False


@dataclass
class Candle:
    """A single OHLCV candle."""
    symbol: str
    timeframe: str
    open_time: float
    close_time: float
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    is_closed: bool = False
    provider: str = ''


@dataclass
class SymbolState:
    """Current state for a symbol."""
    symbol: str
    last_tick: Optional[MarketTick] = None
    last_candle: Dict[str, Candle] = field(default_factory=dict)  # timeframe -> candle
    candles: Dict[str, List[Candle]] = field(default_factory=dict)  # timeframe -> list
    market_state: MarketState = MarketState.CLOSED
    last_update: float = 0.0
    
    @property
    def tick_age(self) -> float:
        """Age of last tick in seconds."""
        if self.last_tick is None:
            return float('inf')
        return time.time() - self.last_tick.received_timestamp
    
    @property
    def is_stale(self, max_age: float = 60.0) -> bool:
        """Check if market data is stale."""
        return self.tick_age > max_age


class MarketWatcher:
    """
    Market Watcher Agent.
    
    Maintains real-time market data and emits events on state changes.
    """
    
    def __init__(self):
        self._symbols: Dict[str, SymbolState] = {}
        self._callbacks: List[Callable] = []
        self._last_prices: Dict[str, float] = {}
    
    def register_symbol(self, symbol: str):
        """Register a symbol for tracking."""
        if symbol not in self._symbols:
            self._symbols[symbol] = SymbolState(symbol=symbol)
            log.info("Registered symbol: %s", symbol)
    
    def register_callback(self, callback: Callable):
        """Register a callback for market events."""
        self._callbacks.append(callback)
    
    def update_tick(self, tick: MarketTick):
        """Update market state with a new tick."""
        symbol = tick.symbol
        
        # Ensure symbol is registered
        if symbol not in self._symbols:
            self.register_symbol(symbol)
        
        state = self._symbols[symbol]
        state.last_tick = tick
        state.last_update = time.time()
        
        # Check for significant price change
        last_price = self._last_prices.get(symbol)
        if last_price and last_price > 0:
            change_pct = abs(tick.mid - last_price) / last_price * 100
            if change_pct > 0.1:  # 0.1% threshold
                self._emit_event('PRICE_UPDATED', {
                    'symbol': symbol,
                    'price': tick.mid,
                    'change_pct': change_pct,
                })
        
        self._last_prices[symbol] = tick.mid
    
    def update_candle(self, candle: Candle):
        """Update market state with a new candle."""
        symbol = candle.symbol
        timeframe = candle.timeframe
        
        # Ensure symbol is registered
        if symbol not in self._symbols:
            self.register_symbol(symbol)
        
        state = self._symbols[symbol]
        
        # Store candle
        if timeframe not in state.candles:
            state.candles[timeframe] = []
        state.candles[timeframe].append(candle)
        
        # Keep only last 500 candles per timeframe
        if len(state.candles[timeframe]) > 500:
            state.candles[timeframe] = state.candles[timeframe][-500:]
        
        # Update last candle
        state.last_candle[timeframe] = candle
        state.last_update = time.time()
        
        # Emit event for closed candles
        if candle.is_closed:
            self._emit_event('CANDLE_CLOSED', {
                'symbol': symbol,
                'timeframe': timeframe,
                'open': candle.open,
                'high': candle.high,
                'low': candle.low,
                'close': candle.close,
                'volume': candle.volume,
            })
    
    def get_symbol_state(self, symbol: str) -> Optional[SymbolState]:
        """Get current state for a symbol."""
        return self._symbols.get(symbol)
    
    def get_all_symbols(self) -> List[str]:
        """Get all registered symbols."""
        return list(self._symbols.keys())
    
    def get_stale_symbols(self, max_age: float = 60.0) -> List[str]:
        """Get symbols with stale data."""
        return [
            symbol for symbol, state in self._symbols.items()
            if state.tick_age > max_age
        ]
    
    def get_market_summary(self) -> Dict[str, dict]:
        """Get market summary for all symbols."""
        summary = {}
        for symbol, state in self._symbols.items():
            summary[symbol] = {
                'symbol': symbol,
                'market_state': state.market_state.value,
                'last_price': state.last_tick.mid if state.last_tick else None,
                'spread': state.last_tick.spread if state.last_tick else None,
                'tick_age': state.tick_age,
                'is_stale': state.is_stale,
                'last_update': state.last_update,
            }
        return summary
    
    def _emit_event(self, event_type: str, data: dict):
        """Emit a market event to all callbacks."""
        event = {
            'type': event_type,
            'timestamp': time.time(),
            **data,
        }
        for callback in self._callbacks:
            try:
                callback(event)
            except Exception as e:
                log.error("Error in market event callback: %s", e)
