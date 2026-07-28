"""Binance public REST client for OHLCV bars (klines).

Stdlib `urllib` only. The /api/v3/klines endpoint is unauthenticated
(no API key needed) and rate-limited to 1200 requests/minute per IP,
which is far more than we need: 8 pairs × 4 timeframes per scan = 32
calls per cycle.

Symbol format: BTCUSDT, ETHUSDT, etc. We strip "USD" and append "USDT"
because Binance only lists USDT/BUSD quote stables, not USD.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from .data_provider import DataProviderError
from .data_types import Candle

log = logging.getLogger(__name__)

# Public market-data-only endpoint. Unlike api.binance.com it is reachable
# from the US, and unlike Binance.US it has the global market's liquidity.
# It exposes no account/trading endpoints and requires no API key.
BINANCE_BASE = os.environ.get(
    "BINANCE_BASE_URL", "https://data-api.binance.vision"
)

# Internal pair → Binance symbol. USDT is the de-facto USD stable.
BINANCE_SYMBOL_MAP: Dict[str, str] = {
    "BTCUSD": "BTCUSDT",
    "ETHUSD": "ETHUSDT",
    "XRPUSD": "XRPUSDT",
    "LTCUSD": "LTCUSDT",
    "DOTUSD": "DOTUSDT",
    "XLMUSD": "XLMUSDT",
    "BATUSD": "BATUSDT",
    # NEO lists against USDT on Binance under "NEOUSDT" (delisted on
    # some exchanges; verify availability before enabling in prod).
    "NEOUSD": "NEOUSDT",
}

# Internal timeframe → Binance interval string + outputsize.
BINANCE_TF_MAP: Dict[str, tuple[str, int]] = {
    "D1":  ("1d",  250),
    "H4":  ("4h",  250),
    "H1":  ("1h",  250),
    "M30": ("30m", 200),
    "M15": ("15m", 200),
    "M5":  ("5m",  200),
    "M1":  ("1m",  200),
    "W1":  ("1w",  250),
}

HttpFn = Callable[[str, float], str]


def _default_http(url: str, timeout: float) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "bwts-scanner/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read().decode("utf-8")


def supports(pair: str) -> bool:
    return pair in BINANCE_SYMBOL_MAP


@dataclass
class BinanceClient:
    base_url: str = BINANCE_BASE
    timeout_seconds: float = 15.0
    http: HttpFn = _default_http

    def fetch_candles(
        self, pair: str, timeframe: str, limit: Optional[int] = None
    ) -> List[Candle]:
        sym = BINANCE_SYMBOL_MAP.get(pair)
        if sym is None:
            raise DataProviderError(f"Unknown crypto pair: {pair}")
        tf = BINANCE_TF_MAP.get(timeframe)
        if tf is None:
            raise DataProviderError(f"Unknown timeframe: {timeframe}")
        interval, default_limit = tf
        request_limit = max(1, min(int(limit or default_limit), 1000))
        params = urllib.parse.urlencode({
            "symbol": sym, "interval": interval, "limit": str(request_limit),
        })
        url = f"{self.base_url}/api/v3/klines?{params}"
        try:
            body = self.http(url, self.timeout_seconds)
        except urllib.error.URLError as exc:
            raise DataProviderError(f"binance HTTP error: {exc}") from exc
        try:
            rows = json.loads(body)
        except json.JSONDecodeError as exc:
            raise DataProviderError(f"binance invalid JSON: {exc}") from exc
        if isinstance(rows, dict) and "code" in rows:
            raise DataProviderError(f"binance error: {rows.get('msg', rows)}")
        return _parse_klines(rows)


def _parse_klines(rows: list) -> List[Candle]:
    """Each kline row is:
        [ openTime_ms, open, high, low, close, volume, closeTime_ms, ... ]
    Binance returns oldest-first already.
    """
    out: List[Candle] = []
    for r in rows:
        try:
            out.append(Candle(
                time=int(r[0]) // 1000,
                open=float(r[1]),
                high=float(r[2]),
                low=float(r[3]),
                close=float(r[4]),
                volume=float(r[5]),
            ))
        except (IndexError, ValueError, TypeError) as exc:
            log.warning("skipping malformed kline %r: %s", r, exc)
    return out
