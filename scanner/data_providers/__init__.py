"""External data providers for the institutional Phase 2 modules.

This subpackage wraps the small number of free, keyless public APIs the
Phase 2 modules call for on-chain, sentiment, fundamental, and
correlation data. Every wrapper here is:

  - stdlib-only (urllib.request, urllib.error)
  - retry-on-transient-error (3 attempts with exponential backoff)
  - bounded timeout (default 8 seconds per request)
  - returning structured results so the calling institutional module
    can decide whether to surface the value or report ``available: False``

When a provider is geo-blocked or auth-walled the wrapper surfaces the
exact reason so the institutional block can render the gap honestly
rather than fabricate values.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from ._http import get_json, get_text, HttpError
from . import (
    binance_futures,
    bybit,
    coindesk_rss,
    coingecko,
    defillama,
    fear_greed,
    github,
)

__all__ = [
    "get_json",
    "get_text",
    "HttpError",
    "binance_futures",
    "bybit",
    "coindesk_rss",
    "coingecko",
    "defillama",
    "fear_greed",
    "github",
]