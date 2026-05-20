"""Twelve Data HTTP client + MarketSnapshot builder.

Stdlib only (urllib). Free tier is 800 requests/day, so a full scan of
the 7 Forex/Gold pairs across 4 timeframes = 28 calls per scan. At a
5-minute interval that's ~336 calls/day — well within the limit.

Symbol + timeframe maps mirror server/services/marketData.js so Python
and Node read the same data.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from .data_types import Candle, MarketSnapshot

log = logging.getLogger(__name__)

TWELVE_BASE = "https://api.twelvedata.com"

SYMBOL_MAP: Dict[str, str] = {
    "EURUSD": "EUR/USD",
    "GBPUSD": "GBP/USD",
    "USDJPY": "USD/JPY",
    "GBPJPY": "GBP/JPY",
    "USDCAD": "USD/CAD",
    "USDCHF": "USD/CHF",
    "AUDUSD": "AUD/USD",
    "NZDUSD": "NZD/USD",
    "XAUUSD": "XAU/USD",
    "XAGUSD": "XAG/USD",
    # Indices: Twelve Data uses NDX / DJI tickers.
    "NAS100": "NDX",
    "US30": "DJI",
}

# (interval, outputsize) per timeframe — sized to give modules enough history.
TF_MAP: Dict[str, tuple[str, int]] = {
    "D1":  ("1day", 250),   # 200+ bars for EMA200 in HTF bias
    "H4":  ("4h",   250),
    "H1":  ("1h",   250),
    "M15": ("15min", 200),
    "M5":  ("5min", 200),
    "M1":  ("1min", 200),
}


class DataProviderError(RuntimeError):
    pass


HttpFn = Callable[[str, float], str]


def _default_http(url: str, timeout: float) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "bwts-scanner/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https only)
        return resp.read().decode("utf-8")


@dataclass
class TwelveDataClient:
    api_key: str
    base_url: str = TWELVE_BASE
    timeout_seconds: float = 15.0
    http: HttpFn = _default_http

    def _request(self, params: Dict[str, str]) -> dict:
        if not self.api_key:
            raise DataProviderError("TWELVE_DATA_API_KEY is not set")
        params = {**params, "apikey": self.api_key, "format": "JSON"}
        url = f"{self.base_url}/time_series?{urllib.parse.urlencode(params)}"
        try:
            body = self.http(url, self.timeout_seconds)
        except urllib.error.URLError as exc:
            raise DataProviderError(f"HTTP error: {exc}") from exc
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise DataProviderError(f"Invalid JSON from Twelve Data: {exc}") from exc

    def fetch_candles(self, pair: str, timeframe: str) -> List[Candle]:
        td_symbol = SYMBOL_MAP.get(pair)
        if td_symbol is None:
            raise DataProviderError(f"Unknown pair: {pair}")
        tf = TF_MAP.get(timeframe)
        if tf is None:
            raise DataProviderError(f"Unknown timeframe: {timeframe}")
        interval, outputsize = tf
        data = self._request({
            "symbol": td_symbol,
            "interval": interval,
            "outputsize": str(outputsize),
        })
        if data.get("status") == "error":
            raise DataProviderError(
                f"Twelve Data error for {pair} {timeframe}: {data.get('message')}"
            )
        values = data.get("values") or []
        if not values:
            return []
        return _parse_values_to_candles(values)

    def fetch_snapshot(
        self,
        pair: str,
        timeframes: Optional[List[str]] = None,
    ) -> MarketSnapshot:
        """Fetch the timeframes needed by the scoring engine and return a
        populated MarketSnapshot.
        """
        timeframes = timeframes or ["D1", "H4", "H1", "M15"]
        snap = MarketSnapshot(pair=pair)
        bucket = {
            "D1": "d1", "H4": "h4", "H1": "h1",
            "M15": "m15", "M5": "m5", "M1": "m1",
        }
        for tf in timeframes:
            attr = bucket.get(tf)
            if attr is None:
                continue
            try:
                candles = self.fetch_candles(pair, tf)
            except DataProviderError as exc:
                log.warning("fetch failed for %s %s: %s", pair, tf, exc)
                candles = []
            setattr(snap, attr, candles)
        return snap


def _parse_values_to_candles(values: list) -> List[Candle]:
    """Twelve Data returns newest-first; we reverse to chronological."""
    out: List[Candle] = []
    for v in reversed(values):
        try:
            dt = _dt.datetime.fromisoformat(v["datetime"].replace(" ", "T"))
            ts = int(dt.replace(tzinfo=_dt.timezone.utc).timestamp())
            out.append(Candle(
                time=ts,
                open=float(v["open"]),
                high=float(v["high"]),
                low=float(v["low"]),
                close=float(v["close"]),
                volume=float(v.get("volume") or 0),
            ))
        except (KeyError, ValueError, TypeError) as exc:
            log.warning("skipping malformed candle %r: %s", v, exc)
    return out
