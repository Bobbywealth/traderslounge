"""Twelve Data HTTP client + MarketSnapshot builder.

Stdlib only (urllib). The free tier is capped at 800 requests/day AND
8 requests/minute. A full scan of 7 FX/gold pairs across 4 timeframes is
28 calls per scan; at a 5-minute interval that is 28 * 288 = ~8,064
calls/day, about 10x the free quota. To stay within budget we
(1) cache each candle series for roughly the duration of its bar so
repeated scans within a bar are free, and (2) cap FX background snapshots
to D1/H4/H1 in multi_source.py, reserving M15/M1 for on-demand chart
requests. A sliding 8 req/min limiter also prevents burst 429s.

Symbol + timeframe maps mirror server/services/marketData.js so Python
and Node read the same data.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import urllib.error
import urllib.parse
import threading
import time
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

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
    # Higher timeframes feed the monthly/weekly/daily S/R overlays. Monthly
    # history is capped lower because most symbols simply do not have 250
    # months of data.
    "MN1": ("1month", 120),
    "W1":  ("1week", 250),
    "D1":  ("1day", 250),   # 200+ bars for EMA200 in HTF bias
    "H4":  ("4h",   250),
    "H1":  ("1h",   250),
    "M15": ("15min", 200),
    "M5":  ("5min", 200),
    "M1":  ("1min", 200),
}

# Bar-aligned cache TTL (seconds). A series is reused until its bar would
# have rolled, so a 5-minute scan cadence does not multiply API usage.
# At these TTLs, 8 FX pairs on D1/H4/H1 cost ~34 calls/day/pair (~270/day).
TF_CACHE_TTL: Dict[str, int] = {
    "MN1": 24 * 3600,
    "W1":  12 * 3600,
    "D1":  6 * 3600,
    "H4":  4 * 3600,
    "H1":      3600,
    "M15":       900,
    "M5":        300,
    "M1":         60,
}


class DataProviderError(RuntimeError):
    pass


class _RateLimiter:
    """Sliding-window requests-per-minute cap (Twelve Data free tier = 8/min)."""

    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self._stamps: "deque[float]" = deque()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        if self.per_minute <= 0:
            return
        while True:
            with self._lock:
                now = time.monotonic()
                while self._stamps and now - self._stamps[0] >= 60.0:
                    self._stamps.popleft()
                if len(self._stamps) < self.per_minute:
                    self._stamps.append(now)
                    return
                wait = 60.0 - (now - self._stamps[0]) + 0.05
            time.sleep(max(0.05, wait))


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
    requests_per_minute: int = 8  # free-tier cap; raise after upgrade
    _limiter: Optional[Any] = field(default=None, init=False, repr=False)
    _cache: Dict[Tuple[str, str], Tuple[float, List[Candle]]] = field(
        default_factory=dict, init=False, repr=False
    )
    _cache_lock: Any = field(default_factory=threading.Lock, init=False, repr=False)

    def __post_init__(self) -> None:
        self._limiter = _RateLimiter(self.requests_per_minute)

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
        key = (pair, timeframe)
        ttl = TF_CACHE_TTL.get(timeframe, 300)
        now = time.monotonic()
        with self._cache_lock:
            hit = self._cache.get(key)
            if hit is not None and hit[0] > now:
                return list(hit[1])
        interval, outputsize = tf
        self._limiter.acquire()
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
        candles = _parse_values_to_candles(values) if values else []
        with self._cache_lock:
            self._cache[key] = (now + ttl, candles)
        return list(candles)

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
