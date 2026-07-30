"""CoinGecko public provider — coin metadata, supply, market data.

Free, no API key needed for the public endpoints used here. Rate
limit on the free tier is undocumented but conservative; we only call
this once per pair per analysis. CoinGecko returns rich metadata
including circulating_supply, total_supply, max_supply, market_data
(price, market_cap, total_volume), categories, and links.

Used by §13 fundamentals for supply schedule and by §15 correlation
when comparing across crypto assets.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from ._http import HttpError, get_json

BASE = "https://api.coingecko.com/api/v3"

# Internal canonical pair name → CoinGecko coin id. Limited set — only
# the pairs we actively trade. Extend as new pairs are added.
_COINGECKO_IDS = {
    "BTCUSD": "bitcoin",
    "ETHUSD": "ethereum",
    "XRPUSD": "ripple",
    "LTCUSD": "litecoin",
    "DOTUSD": "polkadot",
    "XLMUSD": "stellar",
    "BATUSD": "basic-attention-token",
    "NEOUSD": "neo",
}


def coin_id_for(pair: str) -> Optional[str]:
    """Return the CoinGecko coin id for a scanner pair, or ``None``."""
    if not pair:
        return None
    return _COINGECKO_IDS.get(pair.strip().upper().replace("USDT", "USD"))


def fetch_coin(pair: str) -> Dict[str, Any]:
    """Return full CoinGecko /coins/{id} payload.

    Includes market_data (price, cap, volume), supply (max/total/circulating),
    categories, description, links. Raises :class:`HttpError` on transport
    failure or unknown pair.
    """
    coin_id = coin_id_for(pair)
    if not coin_id:
        raise HttpError(0, "coingecko", f"unknown pair: {pair!r}")
    return get_json(f"{BASE}/coins/{coin_id}?localization=false&tickers=false"
                    "&community_data=false&developer_data=false")