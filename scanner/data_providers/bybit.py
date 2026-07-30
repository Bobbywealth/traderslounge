"""Bybit v5 public provider — alternative for futures metrics.

Same geo-restriction caveat as Binance.US from US egress (Bybit blocks
US IPs). Useful as a fallback if the primary Binance provider is
unreachable for non-geo reasons. Endpoints used (all GET, no auth):

  /v5/market/funding/history?category=linear&symbol=BTCUSDT
  /v5/market/open-interest?category=linear&symbol=BTCUSDT
  /v5/market/account-ratio?category=linear&symbol=BTCUSDT
"""
from __future__ import annotations

from typing import Any, Dict, List

from ._http import HttpError, get_json

BASE = "https://api.bybit.com"


def _to_bybit_symbol(pair: str) -> str:
    return pair.strip().upper().replace("USD", "USDT")


def fetch_funding_history(pair: str, limit: int = 1) -> Dict[str, Any]:
    sym = _to_bybit_symbol(pair)
    return get_json(
        f"{BASE}/v5/market/funding/history"
        f"?category=linear&symbol={sym}&limit={int(limit)}"
    )


def fetch_open_interest(pair: str, interval: str = "5min",
                        limit: int = 1) -> Dict[str, Any]:
    sym = _to_bybit_symbol(pair)
    return get_json(
        f"{BASE}/v5/market/open-interest"
        f"?category=linear&symbol={sym}&intervalTime={interval}&limit={int(limit)}"
    )


def fetch_account_ratio(pair: str, period: str = "5min",
                        limit: int = 1) -> Dict[str, Any]:
    sym = _to_bybit_symbol(pair)
    return get_json(
        f"{BASE}/v5/market/account-ratio"
        f"?category=linear&symbol={sym}&period={period}&limit={int(limit)}"
    )