"""Routing data provider: Binance for crypto, Twelve Data for FX/metals/indices,
FMP (Financial Modeling Prep) for equities/ETFs.

The Scanner only knows how to ask for a MarketSnapshot (or a single candle
series) — this client hides the per-asset-class routing behind the same
interface.

Routing precedence:
  1. crypto  (Binance symbol map)        -> BinanceClient
  2. FX/metals/indices (Twelve Data map) -> TwelveDataClient
  3. everything else (equities/ETFs)     -> FMPClient

If the FMP client is absent (no FMP_API_KEY), equity requests degrade
gracefully to an empty snapshot rather than erroring, so the rest of the
product keeps working.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

from .binance_client import BinanceClient, canonicalize, supports as is_crypto
from .data_provider import (
    DataProviderError,
    SYMBOL_MAP as TD_SYMBOL_MAP,
    TwelveDataClient,
)
from .data_types import MarketSnapshot
from .fmp_client import FMPClient, FMPError

log = logging.getLogger(__name__)


def get_asset_class(pair: str) -> str:
    pair = canonicalize(pair) or pair
    # Tolerate the FX-with-trailing-T form (e.g. "GBPUSDT") that some
    # callers pass even though our canonical forex symbols never end
    # in T. Strip the trailing T for non-crypto USDT inputs so Twelve
    # Data doesn't reject them with 401 and so we don't misroute to
    # FMP as an equity.
    if pair.endswith('USDT') and not supports(pair):
        pair = pair[:-1]
    CRYPTO_PAIRS = {'BTCUSD', 'ETHUSD', 'XRPUSD', 'LTCUSD'}
    JPY_PAIRS = {'USDJPY', 'GBPJPY', 'EURJPY'}
    METALS = {'XAUUSD', 'XAGUSD'}

    if pair in CRYPTO_PAIRS:
        return 'cryptocurrency'
    elif pair in JPY_PAIRS:
        return 'forex_jpy'
    elif pair in METALS:
        return 'metals'
    # Anything not crypto/FX/metal routes to FMP as an equity.
    elif pair in TD_SYMBOL_MAP:
        return 'forex'
    else:
        return 'equity'


@dataclass
class MultiSourceClient:
    fx: TwelveDataClient
    crypto: BinanceClient
    fmp: Optional[FMPClient] = None

    def _provider_for(self, pair: str) -> Tuple[object, str]:
        """Pick (provider, name) for a canonical pair. Equity symbols with no
        configured FMP client return (None, 'fmp') so callers can no-op."""
        if is_crypto(pair):
            return self.crypto, "binance"
        if pair in TD_SYMBOL_MAP:
            return self.fx, "twelvedata"
        return self.fmp, "fmp"

    def fetch_snapshot(
        self,
        pair: str,
        timeframes: Optional[List[str]] = None,
    ) -> MarketSnapshot:
        # Normalize the pair so "BTCUSDT", "btcusdt", and " btcusdt "
        # all route to the Binance provider and share a single cache key.
        pair = canonicalize(pair) or pair
        # Strip trailing T on FX USDT aliases so "GBPUSDT" reaches Twelve
        # Data as "GBPUSD" instead of being misrouted to FMP.
        if pair.endswith("USDT") and not is_crypto(pair):
            pair = pair[:-1]
        provider, provider_name = self._provider_for(pair)
        if timeframes is None:
            # FX/gold/indices cost against the Twelve Data free-tier quota, so
            # background scans use only the three higher timeframes; M15/M1 are
            # fetched on demand by the API/chart and served from the candle
            # cache. Crypto runs on keyless Binance, so it keeps all four.
            # Equities on FMP free tier only expose daily EOD, so the snapshot
            # is daily-only; the chart can still request other TFs on demand
            # (they will be empty until a paid plan unlocks intraday).
            if is_crypto(pair):
                timeframes = ["D1", "H4", "H1", "M15"]
            elif pair in TD_SYMBOL_MAP:
                timeframes = ["D1", "H4", "H1"]
            else:
                timeframes = ["D1"]
        snap = MarketSnapshot(pair=pair)
        bucket = {"D1": "d1", "W1": "w1", "H4": "h4", "H1": "h1",
                  "M30": "m30", "M15": "m15", "M5": "m5", "M1": "m1"}
        if provider is None:
            log.info("no FMP client configured; equity %s snapshot empty", pair)
            return snap
        for tf in timeframes:
            attr = bucket.get(tf)
            if attr is None:
                continue
            try:
                candles = provider.fetch_candles(pair, tf)
            except (DataProviderError, FMPError) as exc:
                log.warning("%s fetch failed for %s %s: %s",
                            provider_name, pair, tf, exc)
                candles = []
            setattr(snap, attr, candles)
        return snap

    # Forward fetch_candles for callers (price_oracle, /api/candles, etc.)
    # that only need a single timeframe.
    def fetch_candles(
        self, pair: str, timeframe: str, limit: Optional[int] = None,
        end_time_ms: Optional[int] = None,
    ):
        pair = canonicalize(pair) or pair
        provider, provider_name = self._provider_for(pair)
        if provider is None:
            log.info("no FMP client configured; equity %s candles empty", pair)
            return []
        if is_crypto(pair):
            if limit is None and end_time_ms is None:
                return self.crypto.fetch_candles(pair, timeframe)
            return self.crypto.fetch_candles(pair, timeframe, limit=limit, end_time_ms=end_time_ms)
        if provider_name == "fmp":
            return provider.fetch_candles(pair, timeframe, limit=limit, end_time_ms=end_time_ms)
        # Twelve Data's free-tier client has no pagination/limit knob — it
        # always returns a fixed-size window per timeframe (see TF_MAP). A
        # scroll-back request (end_time_ms set) has nothing further back to
        # give, so it returns the same window rather than erroring; the API
        # layer treats an unchanged oldest-candle timestamp as "no more
        # history" and stops paging.
        return self.fx.fetch_candles(pair, timeframe)

