"""
Market Watcher Agent for Confluence X.

Responsibilities:
- Maintain supported instrument universe
- Receive real-time price data
- Maintain candle streams
- Normalize symbols
- Track market open/close
- Determine stale feeds
- Maintain session status
- Monitor spreads
- Compute basic market-state metrics
- Emit events when material market state changes
"""
from .market_watcher import MarketWatcher, MarketTick, Candle, MarketState
from .data_quality import DataQualityEngine, DataQualityStatus

__all__ = [
    'MarketWatcher',
    'MarketTick',
    'Candle',
    'MarketState',
    'DataQualityEngine',
    'DataQualityStatus',
]
