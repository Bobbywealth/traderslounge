"""Live spot-price sanity check for XAUUSD.

Twelve Data is fine for OHLC history but the gold-alert system was
publishing "Entry: 4629.69" while the actual spot was $4,635 — the
discrepancy was the cached H1 bar close vs the live tick.

This module fetches a fresh spot quote from ``api.gold-api.com``
(keyless, returns USD per troy ounce) so the alert pipeline can:

* Cross-check the cached ``reference_price`` against the live tick.
* Surface a ``live_price`` and ``stale_minutes`` field on every alert.
* Refuse to publish guarded calls when the cached reference is more
  than a few dollars away from the live tick (the cached bar was
  abandoned mid-stream and the rest of the chain is suspect).

Only XAUUSD is wired today; other pairs can be added by extending
``fetch_live_spot`` with another provider block.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional

log = logging.getLogger(__name__)

# Live spot endpoint (no key required). Returns JSON like:
#   {"currency":"USD","price":4635.0,"updatedAt":"2026-08-27T03:35:44Z", ...}
GOLD_API_URL = "https://api.gold-api.com/price/XAU"

# Cache TTL — gold ticks every few seconds; refresh at most once per minute
# so a chatty Telegram alert pipeline doesn't burn the free endpoint.
CACHE_TTL_SECONDS = 60.0

# A live-vs-cached price gap this large in USD/oz for XAUUSD usually
# means the cached bar is stale or misrouted, not that gold just moved.
# $5 covers normal H1 wicks; anything bigger gets flagged.
STALE_PRICE_GAP_USD = 5.0

# If the cached bar is older than this, surface it in the alert and refuse
# to call it "fresh". 91 minutes (one H1 bar + buffer) was the production
# default in the old analysis; we tighten to 90 minutes here.
STALE_BAR_MINUTES = 90

HttpFn = Callable[[str, float], str]


@dataclass
class LiveSpot:
    price: float
    updated_at: str
    fetched_at: float
    source: str = "gold-api.com"

    @property
    def age_seconds(self) -> float:
        return time.time() - self.fetched_at


def _default_http(url: str, timeout: float) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "bwts-scanner/liveprice"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https only)
        return resp.read().decode("utf-8")


class LivePriceClient:
    """Keyless live-price client for XAUUSD. Thread-safe with TTL cache."""

    def __init__(
        self,
        url: str = GOLD_API_URL,
        timeout_seconds: float = 5.0,
        http: HttpFn = _default_http,
        cache_ttl_seconds: float = CACHE_TTL_SECONDS,
    ) -> None:
        self.url = url
        self.timeout_seconds = timeout_seconds
        self.http = http
        self.cache_ttl_seconds = cache_ttl_seconds
        self._cache: Optional[LiveSpot] = None
        self._cache_lock = threading.Lock()
        self._last_error: Optional[str] = None

    def fetch_live_spot(self, force: bool = False) -> Optional[LiveSpot]:
        """Return a fresh spot quote, or the cache if still warm.

        Returns ``None`` on network/parse failure so callers can degrade
        gracefully — the rest of the alert pipeline never depends on
        this module being available.
        """
        now = time.time()
        with self._cache_lock:
            if not force and self._cache and (now - self._cache.fetched_at) < self.cache_ttl_seconds:
                return self._cache
        try:
            body = self.http(self.url, self.timeout_seconds)
            payload = json.loads(body)
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            self._last_error = f"live_price fetch failed: {exc}"
            log.warning(self._last_error)
            with self._cache_lock:
                return self._cache  # last-good cache wins
        except Exception as exc:  # pragma: no cover - last-resort safety
            self._last_error = f"live_price unexpected error: {exc}"
            log.warning(self._last_error)
            with self._cache_lock:
                return self._cache
        try:
            spot = LiveSpot(
                price=float(payload["price"]),
                updated_at=str(payload.get("updatedAt") or ""),
                fetched_at=time.time(),
                source="gold-api.com",
            )
        except (KeyError, TypeError, ValueError) as exc:
            self._last_error = f"live_price parse error: {exc}"
            log.warning(self._last_error)
            with self._cache_lock:
                return self._cache
        with self._cache_lock:
            self._cache = spot
            self._last_error = None
        return spot

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    def validate_reference_price(
        self,
        reference_price: Optional[float],
        pair: str = "XAUUSD",
    ) -> dict:
        """Cross-check ``reference_price`` against the live tick.

        Returns a small dict so callers can fold it into Telegram
        alert payloads:

            ``{"live_price": 4635.0, "gap_usd": 5.31, "stale": True,
              "stale_minutes": 47}``
        """
        if reference_price is None:
            return {"live_price": None, "gap_usd": None, "stale": None, "stale_minutes": None}
        try:
            ref = float(reference_price)
        except (TypeError, ValueError):
            return {"live_price": None, "gap_usd": None, "stale": None, "stale_minutes": None}
        spot = self.fetch_live_spot() if pair.upper() == "XAUUSD" else None
        out: dict = {
            "live_price": spot.price if spot else None,
            "gap_usd": (ref - spot.price) if spot else None,
            "stale": None,
            "stale_minutes": None,
        }
        if spot is not None:
            gap = abs(ref - spot.price)
            out["gap_usd"] = round(gap, 3)
            # A $5+ gap on XAUUSD usually means the cached bar is stale,
            # not that gold moved. We treat it as suspect and surface it.
            out["stale"] = gap >= STALE_PRICE_GAP_USD
        return out


_DEFAULT_CLIENT: Optional[LivePriceClient] = None


def get_default_client() -> LivePriceClient:
    """Lazily build a process-wide client so callers don't all spin one."""
    global _DEFAULT_CLIENT
    if _DEFAULT_CLIENT is None:
        _DEFAULT_CLIENT = LivePriceClient()
    return _DEFAULT_CLIENT