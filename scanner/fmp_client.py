"""Financial Modeling Prep (FMP) HTTP client for equities, ETFs, FX, and
commodities OHLCV.

Stdlib only (urllib). FMP exposes 70k+ securities, 4.5k cryptos, 1.5k forex
pairs and 40 commodities behind a single apikey-authenticated REST API.

    Base: https://financialmodelingprep.com/stable/
    Auth: ?apikey=KEY  (passed on every request)

Free-tier limits are tight, so this client (1) bar-aligns the per-timeframe
cache exactly like the Twelve Data client so repeated scans within a bar are
free, and (2) wraps every call in a sliding-window requests-per-minute limiter
to avoid 429s.

Routing: MultiSourceClient sends equity/ETF/commodity symbols here. FMP
intervals map cleanly to the scanner's internal timeframe codes:

    D1  -> historical-price-eod/full   (daily EOD, ~30y history)
    W1  -> historical-price-eod/full   (daily EOD, downsampled client-side)
    H4  -> historical-chart/4hour
    H1  -> historical-chart/1hour
    M30 -> historical-chart/30min
    M15 -> historical-chart/15min
    M5  -> historical-chart/5min
    M1  -> historical-chart/1min

NOTE: intraday (`historical-chart/*`) may require a paid plan on FMP. The
caller (MultiSourceClient) treats a per-timeframe fetch failure as an empty
series, so a free-tier account still delivers daily OHLCV cleanly and simply
lacks intraday bars until the plan is upgraded.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .data_types import Candle

log = logging.getLogger(__name__)

FMP_BASE = "https://financialmodelingprep.com/stable"

# Internal timeframe -> FMP intraday interval string. D1/W1 use the EOD
# endpoint, not this map.
FMP_INTRADAY_TF: Dict[str, str] = {
    "H4":  "4hour",
    "H1":  "1hour",
    "M30": "30min",
    "M15": "15min",
    "M5":  "5min",
    "M1":  "1min",
}

# (interval, outputsize) per timeframe — sized to give modules enough history.
# These mirror the Twelve Data / Binance sizing so scoring uses the same depth.
TF_MAP: Dict[str, Tuple[str, int]] = {
    "D1":  ("1day",   250),   # EOD endpoint; 200+ bars for EMA200 HTF bias
    "H4":  ("4hour",  250),
    "H1":  ("1hour",  250),
    "M30": ("30min",  200),
    "M15": ("15min",  200),
    "M5":  ("5min",   200),
    "M1":  ("1min",   200),
}

# Bar-aligned cache TTL (seconds). A series is reused until its bar would
# have rolled, so a 5-minute scan cadence does not multiply API usage.
TF_CACHE_TTL: Dict[str, int] = {
    "D1":  6 * 3600,
    "H4":  4 * 3600,
    "H1":      3600,
    "M30":      1800,
    "M15":       900,
    "M5":        300,
    "M1":         60,
}

# Asset-class hint for symbol normalization. FMP uses plain tickers for
# equities (AAPL), "USDX" style for some commodities, and forex/crypto in
# the same namespace. Equities pass through unchanged.
SYMBOL_MAP: Dict[str, str] = {
    # Commodities that trade under different FMP tickers can be added here.
    "XAUUSD": "GCUSD",   # gold spot -> FMP gold
    "XAGUSD": "SIUSD",   # silver spot -> FMP silver
}


class FMPError(RuntimeError):
    pass


class _RateLimiter:
    """Sliding-window requests-per-minute cap."""

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


def resolve_symbol(pair: str) -> str:
    """Map an internal symbol to its FMP ticker. Unknown symbols pass through
    unchanged (equity tickers like AAPL/SPY need no mapping)."""
    if not isinstance(pair, str):
        return ""
    key = pair.strip().upper().replace(" ", "")
    return SYMBOL_MAP.get(key, key)


def supports(pair: str) -> bool:
    """Heuristic: a symbol routes to FMP when it is NOT a Binance crypto pair.
    The authoritative routing lives in MultiSourceClient; this is a convenience
    used by asset-class detection."""
    return False  # MultiSourceClient decides routing explicitly.


@dataclass
class FMPClient:
    api_key: str
    base_url: str = FMP_BASE
    timeout_seconds: float = 15.0
    http: HttpFn = _default_http
    requests_per_minute: int = 5  # free-tier conservative default; raise after upgrade
    _limiter: Optional[Any] = field(default=None, init=False, repr=False)
    _cache: Dict[Tuple[str, str], Tuple[float, List[Candle]]] = field(
        default_factory=dict, init=False, repr=False
    )
    _cache_lock: Any = field(default_factory=threading.Lock, init=False, repr=False)

    def __post_init__(self) -> None:
        self._limiter = _RateLimiter(self.requests_per_minute)

    def _request(self, path: str, extra: Optional[Dict[str, str]] = None) -> Any:
        if not self.api_key:
            raise FMPError("FMP_API_KEY is not set")
        params = {"apikey": self.api_key}
        if extra:
            params.update(extra)
        url = f"{self.base_url}/{path}?{urllib.parse.urlencode(params)}"
        try:
            body = self.http(url, self.timeout_seconds)
        except urllib.error.URLError as exc:
            raise FMPError(f"HTTP error: {exc}") from exc
        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            raise FMPError(f"Invalid JSON from FMP: {exc}") from exc
        # FMP surfaces errors as {"Error Message": "..."} or {"Error": "..."}.
        if isinstance(data, dict):
            for k in ("Error Message", "Error"):
                if k in data and data[k]:
                    raise FMPError(f"FMP error: {data[k]}")
        return data

    def fetch_candles(
        self, pair: str, timeframe: str,
        limit: Optional[int] = None, end_time_ms: Optional[int] = None,
    ) -> List[Candle]:
        symbol = resolve_symbol(pair)
        tf = TF_MAP.get(timeframe)
        if tf is None:
            raise FMPError(f"Unknown timeframe: {timeframe}")
        key = (pair, timeframe)
        ttl = TF_CACHE_TTL.get(timeframe, 300)
        now = time.monotonic()
        with self._cache_lock:
            hit = self._cache.get(key)
            cached = list(hit[1]) if hit is not None and hit[0] > now else None
        if cached is None:
            self._limiter.acquire()
            if timeframe in ("D1", "W1"):
                data = self._request(
                    "historical-price-eod/full", {"symbol": symbol}
                )
                outputsize = tf[1]
                candles = _parse_eod(data, limit=outputsize)
                if timeframe == "W1":
                    candles = _downsample_to_weekly(candles)[-outputsize:]
            else:
                interval = FMP_INTRADAY_TF.get(timeframe)
                if interval is None:
                    raise FMPError(f"Unknown intraday timeframe: {timeframe}")
                outputsize = tf[1]
                data = self._request(
                    f"historical-chart/{interval}",
                    {"symbol": symbol, "outputsize": str(outputsize)},
                )
                candles = _parse_intraday(data)
            with self._cache_lock:
                self._cache[key] = (now + ttl, candles)
            cached = list(candles)
        # Apply scroll-back (candles strictly before end_time_ms) and a
        # trailing limit. Done on a copy so the cached full set is untouched.
        result = cached
        if end_time_ms is not None:
            boundary = end_time_ms // 1000
            result = [c for c in result if c.time < boundary]
        if limit is not None and limit > 0:
            result = result[-limit:]
        return result

    def fetch_quote(self, pair: str) -> Dict[str, Any]:
        """Real-time quote (price, day range, volume, market cap, etc.)."""
        symbol = resolve_symbol(pair)
        self._limiter.acquire()
        data = self._request("quote", {"symbol": symbol})
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    def fetch_snapshot(
        self,
        pair: str,
        timeframes: Optional[List[str]] = None,
    ):
        """Fetch the timeframes needed by the scoring engine. Imported lazily
        to avoid a circular import with data_types at module load."""
        from .data_types import MarketSnapshot
        timeframes = timeframes or ["D1", "H4", "H1", "M15"]
        snap = MarketSnapshot(pair=pair)
        bucket = {
            "D1": "d1", "H4": "h4", "H1": "h1",
            "M30": "m30", "M15": "m15", "M5": "m5", "M1": "m1",
        }
        for tf in timeframes:
            attr = bucket.get(tf)
            if attr is None:
                continue
            try:
                candles = self.fetch_candles(pair, tf)
            except FMPError as exc:
                log.warning("FMP fetch failed for %s %s: %s", pair, tf, exc)
                candles = []
            setattr(snap, attr, candles)
        return snap


def _parse_eod(data: Any, limit: int) -> List[Candle]:
    """Parse the historical-price-eod response.

    FMP returns either a bare array of bars or {"historical": [...]}. Each
    bar uses an ISO date string (daily granularity) plus OHLCV. Bars arrive
    newest-first, so we reverse to chronological and cap to ``limit``.
    """
    rows = _extract_rows(data, "historical")
    out: List[Candle] = []
    for r in rows:
        try:
            ts = _to_epoch(r.get("date") or r.get("timestamp"))
            if ts is None:
                continue
            out.append(Candle(
                time=ts,
                open=float(r["open"]),
                high=float(r["high"]),
                low=float(r["low"]),
                close=float(r["close"]),
                volume=float(r.get("volume") or 0),
            ))
        except (KeyError, ValueError, TypeError) as exc:
            log.warning("skipping malformed FMP EOD bar %r: %s", r, exc)
    out.sort(key=lambda c: c.time)
    return out[-limit:]


def _parse_intraday(data: Any) -> List[Candle]:
    """Parse historical-chart/* intraday response.

    FMP returns either a bare array or {"historical": [...]} of bars keyed by
    an ISO datetime (e.g. "2024-01-02 09:30:00"). Bars arrive newest-first.
    """
    rows = _extract_rows(data, "historical")
    out: List[Candle] = []
    for r in rows:
        try:
            ts = _to_epoch(r.get("date") or r.get("datetime") or r.get("timestamp"))
            if ts is None:
                continue
            out.append(Candle(
                time=ts,
                open=float(r["open"]),
                high=float(r["high"]),
                low=float(r["low"]),
                close=float(r["close"]),
                volume=float(r.get("volume") or 0),
            ))
        except (KeyError, ValueError, TypeError) as exc:
            log.warning("skipping malformed FMP intraday bar %r: %s", r, exc)
    out.sort(key=lambda c: c.time)
    return out


def _extract_rows(data: Any, key: str) -> List[dict]:
    """Return the list of bar dicts whether FMP nested it under ``key`` or
    returned a bare array."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        rows = data.get(key)
        if isinstance(rows, list):
            return rows
        # Some FMP payloads wrap a single symbol: {"symbol": ..., "historical": [...]}
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []


def _to_epoch(value: Any) -> Optional[int]:
    """Coerce an FMP date/datetime value to a UTC epoch second timestamp."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Some payloads return epoch seconds; treat large numbers as ms.
        v = float(value)
        return int(v / 1000) if v > 1e12 else int(v)
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    try:
        # Accept "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS".
        dt = _dt.datetime.fromisoformat(s.replace(" ", "T"))
        return int(dt.replace(tzinfo=_dt.timezone.utc).timestamp())
    except ValueError:
        return None


def _downsample_to_weekly(daily: List[Candle]) -> List[Candle]:
    """Aggregate daily candles into weekly (Monday-anchored) bars."""
    if not daily:
        return []
    buckets: Dict[_dt.date, dict] = {}
    for c in daily:
        day = _dt.datetime.utcfromtimestamp(c.time).date()
        monday = day - _dt.timedelta(days=day.weekday())
        b = buckets.setdefault(monday, {
            "time": int(_dt.datetime(monday.year, monday.month, monday.day,
                                     tzinfo=_dt.timezone.utc).timestamp()),
            "open": c.open, "high": c.high, "low": c.low,
            "close": c.close, "volume": 0.0,
        })
        b["high"] = max(b["high"], c.high)
        b["low"] = min(b["low"], c.low)
        b["close"] = c.close
        b["volume"] += c.volume
    out = [Candle(**vals) for vals in buckets.values()]
    out.sort(key=lambda c: c.time)
    return out
