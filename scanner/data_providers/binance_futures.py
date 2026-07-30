"""Binance USD-M futures provider.

Geo-restricted from the United States (HTTP 451). Render's Oregon
region is also geo-blocked, so these calls will fail in production
unless Render is moved to a non-US region OR a Binance.US / paid
alternative is wired in. The wrappers still exist so:

  - the §12 on-chain module has a clean home for these metrics when
    an alternative provider or non-US egress becomes available;
  - tests that stub the HTTP layer can exercise the parsing path;
  - the institutional block honestly reports ``available: False,
    reason: geo_blocked`` rather than fabricating values.

Endpoints (all GET, no auth):
  /fapi/v1/fundingRate?symbol=BTCUSDT&limit=N
  /fapi/v1/openInterest?symbol=BTCUSDT
  /futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=N
  /futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=N
"""
from __future__ import annotations

from typing import Any, Dict, List

from ._http import HttpError, get_json

BASE = "https://fapi.binance.com"


def _to_binance_symbol(pair: str) -> str:
    """Scanner pair → Binance USDT symbol (BTCUSD -> BTCUSDT)."""
    return pair.strip().upper().replace("USD", "USDT")


def fetch_funding_rate(pair: str, limit: int = 1) -> List[Dict[str, Any]]:
    """Return most recent funding-rate rows for a symbol."""
    sym = _to_binance_symbol(pair)
    return get_json(f"{BASE}/fapi/v1/fundingRate?symbol={sym}&limit={int(limit)}")


def fetch_open_interest(pair: str) -> Dict[str, Any]:
    """Return current open interest snapshot for a symbol."""
    sym = _to_binance_symbol(pair)
    return get_json(f"{BASE}/fapi/v1/openInterest?symbol={sym}")


def fetch_long_short_ratio(pair: str, period: str = "5m",
                           limit: int = 1) -> List[Dict[str, Any]]:
    """Return global long/short account ratio rows for a symbol/period."""
    sym = _to_binance_symbol(pair)
    return get_json(
        f"{BASE}/futures/data/globalLongShortAccountRatio"
        f"?symbol={sym}&period={period}&limit={int(limit)}"
    )


def fetch_top_trader_long_short(pair: str, period: str = "5m",
                                limit: int = 1) -> List[Dict[str, Any]]:
    """Return top-trader long/short position ratio rows."""
    sym = _to_binance_symbol(pair)
    return get_json(
        f"{BASE}/futures/data/topLongShortPositionRatio"
        f"?symbol={sym}&period={period}&limit={int(limit)}"
    )