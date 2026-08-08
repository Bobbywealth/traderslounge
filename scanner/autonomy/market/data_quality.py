"""
Data Quality Engine for Confluence X.

Tracks data quality metrics and blocks trading when data is unreliable.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class DataQualityStatus(Enum):
    """Data quality status."""
    HEALTHY = 'healthy'
    DEGRADED = 'degraded'
    STALE = 'stale'
    UNAVAILABLE = 'unavailable'


@dataclass
class QualityMetrics:
    """Data quality metrics for a symbol."""
    symbol: str
    last_tick_age: float = float('inf')
    last_candle_age: float = float('inf')
    missing_candles: int = 0
    duplicate_candles: int = 0
    out_of_order_candles: int = 0
    provider_disagreements: int = 0
    abnormal_spreads: int = 0
    provider_latency_ms: float = 0.0
    
    @property
    def status(self) -> DataQualityStatus:
        """Calculate overall data quality status."""
        # Unavailable if no data
        if self.last_tick_age == float('inf') and self.last_candle_age == float('inf'):
            return DataQualityStatus.UNAVAILABLE
        
        # Stale if data is too old
        if self.last_tick_age > 300 or self.last_candle_age > 600:  # 5min tick, 10min candle
            return DataQualityStatus.STALE
        
        # Degraded if multiple quality issues
        issues = sum([
            self.missing_candles > 0,
            self.duplicate_candles > 0,
            self.out_of_order_candles > 0,
            self.abnormal_spreads > 5,
            self.provider_latency_ms > 5000,
        ])
        
        if issues >= 3:
            return DataQualityStatus.DEGRADED
        if issues >= 1:
            return DataQualityStatus.DEGRADED
        
        return DataQualityStatus.HEALTHY
    
    @property
    def can_trade(self) -> bool:
        """Check if data quality allows trading."""
        return self.status in (DataQualityStatus.HEALTHY, DataQualityStatus.DEGRADED)


class DataQualityEngine:
    """
    Data Quality Engine.
    
    Monitors data quality and blocks trading when data is unreliable.
    """
    
    def __init__(self):
        self._metrics: Dict[str, QualityMetrics] = {}
        self._candle_history: Dict[str, Dict[str, List[float]]] = {}  # symbol -> timeframe -> [open_times]
    
    def update_tick_age(self, symbol: str, age_seconds: float):
        """Update last tick age for a symbol."""
        if symbol not in self._metrics:
            self._metrics[symbol] = QualityMetrics(symbol=symbol)
        self._metrics[symbol].last_tick_age = age_seconds
    
    def update_candle_age(self, symbol: str, age_seconds: float):
        """Update last candle age for a symbol."""
        if symbol not in self._metrics:
            self._metrics[symbol] = QualityMetrics(symbol=symbol)
        self._metrics[symbol].last_candle_age = age_seconds
    
    def record_candle(self, symbol: str, timeframe: str, open_time: float):
        """Record a candle and check for quality issues."""
        if symbol not in self._metrics:
            self._metrics[symbol] = QualityMetrics(symbol=symbol)
        
        if symbol not in self._candle_history:
            self._candle_history[symbol] = {}
        if timeframe not in self._candle_history[symbol]:
            self._candle_history[symbol][timeframe] = []
        
        history = self._candle_history[symbol][timeframe]
        
        # Check for duplicate
        if open_time in history:
            self._metrics[symbol].duplicate_candles += 1
            log.warning("Duplicate candle for %s %s at %s", symbol, timeframe, open_time)
        
        # Check for out-of-order
        if history and open_time < history[-1]:
            self._metrics[symbol].out_of_order_candles += 1
            log.warning("Out-of-order candle for %s %s at %s", symbol, timeframe, open_time)
        
        # Record candle
        history.append(open_time)
        
        # Keep only last 1000 candles
        if len(history) > 1000:
            self._metrics[symbol].candle_history[symbol][timeframe] = history[-1000:]
    
    def record_spread(self, symbol: str, spread: float, typical_spread: float):
        """Record spread and check for abnormal values."""
        if symbol not in self._metrics:
            self._metrics[symbol] = QualityMetrics(symbol=symbol)
        
        if spread > typical_spread * 3:  # 3x typical spread is abnormal
            self._metrics[symbol].abnormal_spreads += 1
            log.warning("Abnormal spread for %s: %.2f (typical: %.2f)", symbol, spread, typical_spread)
    
    def record_provider_latency(self, symbol: str, latency_ms: float):
        """Record provider latency."""
        if symbol not in self._metrics:
            self._metrics[symbol] = QualityMetrics(symbol=symbol)
        self._metrics[symbol].provider_latency_ms = latency_ms
    
    def get_quality(self, symbol: str) -> QualityMetrics:
        """Get quality metrics for a symbol."""
        if symbol not in self._metrics:
            self._metrics[symbol] = QualityMetrics(symbol=symbol)
        return self._metrics[symbol]
    
    def can_trade(self, symbol: str) -> bool:
        """Check if data quality allows trading for a symbol."""
        return self.get_quality(symbol).can_trade
    
    def get_all_quality(self) -> Dict[str, dict]:
        """Get quality metrics for all symbols."""
        return {
            symbol: {
                'symbol': metrics.symbol,
                'status': metrics.status.value,
                'can_trade': metrics.can_trade,
                'last_tick_age': metrics.last_tick_age,
                'last_candle_age': metrics.last_candle_age,
                'missing_candles': metrics.missing_candles,
                'duplicate_candles': metrics.duplicate_candles,
                'out_of_order_candles': metrics.out_of_order_candles,
                'abnormal_spreads': metrics.abnormal_spreads,
                'provider_latency_ms': metrics.provider_latency_ms,
            }
            for symbol, metrics in self._metrics.items()
        }
    
    def reset_metrics(self, symbol: Optional[str] = None):
        """Reset quality metrics."""
        if symbol:
            self._metrics.pop(symbol, None)
            self._candle_history.pop(symbol, None)
        else:
            self._metrics.clear()
            self._candle_history.clear()
