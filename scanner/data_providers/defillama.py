"""DefiLlama provider — TVL, chain TVL, and protocol metadata.

DefiLlama (https://api.llama.fi/) is a free, keyless aggregator that
exposes protocol TVL across chains. Useful for §13 fundamentals when
analyzing ETH (which anchors DeFi liquidity) and any token whose
underlying protocol has a listed slug.

Endpoints used:
  GET /protocols                 — every protocol, TVL, slug, category
  GET /tvl/{slug}                — historical TVL for a single protocol
  GET /v2/historicalChainTvl/{chain} — historical chain TVL

All endpoints are free, no auth, no documented rate limits. Defensive
parsing only — DefiLlama occasionally returns rows with missing fields
which we silently drop.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ._http import HttpError, get_json

BASE = "https://api.llama.fi"


def fetch_protocols() -> List[Dict[str, Any]]:
    """Return the full list of protocols (~150KB JSON).

    Each row: ``{id, name, slug, symbol, category, tvl, chainTvls}``.
    """
    return get_json(f"{BASE}/protocols")


def fetch_protocol_tvl(slug: str) -> Dict[str, Any]:
    """Historical TVL for one protocol.

    Returns ``{name, symbol, slug, tvl, chainTvls, tokens}``.
    """
    slug = slug.strip().lower().replace(" ", "-")
    if not slug:
        raise HttpError(0, "defillama", "empty slug")
    return get_json(f"{BASE}/tvl/{slug}")


def find_protocol_by_symbol(symbol: str) -> Optional[Dict[str, Any]]:
    """Return the highest-TVL protocol row matching a coin symbol.

    Useful for ETH ("ethereum") and any other token whose primary
    DeFi protocol is the canonical TVL anchor. Returns ``None`` if
    no match.
    """
    if not symbol:
        return None
    symbol = symbol.strip().upper()
    protocols = fetch_protocols()
    matches = [
        p for p in protocols
        if (p.get("symbol") or "").upper() == symbol and (p.get("tvl") or 0) > 0
    ]
    if not matches:
        return None
    matches.sort(key=lambda p: float(p.get("tvl") or 0), reverse=True)
    return matches[0]