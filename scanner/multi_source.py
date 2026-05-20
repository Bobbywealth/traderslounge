"""Routing data provider: picks Twelve Data for FX/indices, Binance for crypto.

The Scanner only knows how to ask for a MarketSnapshot — this client
hides the per-asset-class routing behind the same interface.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

from .binance_client import BinanceClient, supports as is_crypto
from .data_provider import DataProviderError, TwelveDataClient
from .data_types import MarketSnapshot

log = logging.getLogger(__name__)


@dataclass
class MultiSourceClient:
    fx: TwelveDataClient
    crypto: BinanceClient

    def fetch_snapshot(
        self,
        pair: str,
        timeframes: Optional[List[str]] = None,
    ) -> MarketSnapshot:
        timeframes = timeframes or ["D1", "H4", "H1", "M15"]
        snap = MarketSnapshot(pair=pair)
        bucket = {"D1": "d1", "H4": "h4", "H1": "h1",
                  "M15": "m15", "M5": "m5", "M1": "m1"}
        provider = self.crypto if is_crypto(pair) else self.fx
        provider_name = "binance" if is_crypto(pair) else "twelvedata"
        for tf in timeframes:
            attr = bucket.get(tf)
            if attr is None:
                continue
            try:
                candles = provider.fetch_candles(pair, tf)
            except DataProviderError as exc:
                log.warning("%s fetch failed for %s %s: %s",
                            provider_name, pair, tf, exc)
                candles = []
            setattr(snap, attr, candles)
        return snap

    # Forward fetch_candles for callers (price_oracle, etc.) that only
    # need a single timeframe.
    def fetch_candles(self, pair: str, timeframe: str):
        provider = self.crypto if is_crypto(pair) else self.fx
        return provider.fetch_candles(pair, timeframe)
