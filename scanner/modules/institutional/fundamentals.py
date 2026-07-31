"""Section 13 (Fundamentals) — Phase 2.

Pulls what we can from free, keyless providers:

  - CoinGecko: supply (max / total / circulating), market cap,
    24h volume, project categories.
  - DefiLlama: TVL for the underlying protocol when the symbol
    maps to a known DeFi protocol (e.g., ETHUSD → ethereum).

What this module deliberately does NOT provide without a paid
provider:

  - Detailed token-unlock schedules (TokenUnlocksApp / Messari).
  - ETF flows (Coinglass Pro / Farside Investors paid tier).
  - Regulatory news aggregation (Curated regulatory RSS would close
    most of this for free; deferred).
  - Developer activity / commit cadence (GitHub API is rate-limited
    and the scanner is stdlib-only).

Report-only — never feeds the BWTS score or Signals gate. Missing
data is reported as ``unavailable`` with the explicit reason.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from scanner.data_providers import coingecko, defillama, github
from scanner.data_providers._http import HttpError

log = logging.getLogger(__name__)


def _try(fn, *args, **kwargs):
    try:
        return {"ok": True, "data": fn(*args, **kwargs)}
    except HttpError as exc:
        return {"ok": False, "status": exc.status, "reason": exc.reason}
    except Exception as exc:  # pragma: no cover - defensive
        return {"ok": False, "status": 0, "reason": str(exc)}


def compute(analysis: Dict[str, Any], snapshot: Any = None,
            github_token: str = ""
            ) -> Dict[str, Any]:
    pair = analysis.get("pair") or ""

    fundamentals: Dict[str, Any] = {}
    unavailable: Dict[str, str] = {}

    # 1. CoinGecko — supply, market cap, categories.
    cg = _try(coingecko.fetch_coin, pair)
    if cg["ok"]:
        d = cg["data"]
        md = d.get("market_data") or {}
        supply = d.get("supply") or {}
        fundamentals["coin_metadata"] = {
            "name": d.get("name"),
            "symbol": d.get("symbol"),
            "categories": d.get("categories") or [],
            "genesis_date": d.get("genesis_date"),
            "hashing_algorithm": d.get("hashing_algorithm"),
            "source": "coingecko",
        }
        fundamentals["supply_schedule"] = {
            "circulating": supply.get("circulating"),
            "total": supply.get("total"),
            "max": supply.get("max"),
            "infinite_max": bool(supply.get("infinite_max", False)),
            "source": "coingecko",
        }
        fundamentals["market_data"] = {
            "market_cap_usd": (md.get("market_cap") or {}).get("usd"),
            "fully_diluted_valuation_usd":
                (md.get("fully_diluted_valuation") or {}).get("usd"),
            "total_volume_24h_usd":
                (md.get("total_volume") or {}).get("usd"),
            "circulating_supply": md.get("circulating_supply"),
            "source": "coingecko",
        }
    else:
        unavailable["coingecko"] = cg.get("reason") or "unreachable"

    # 2. DefiLlama — TVL when the pair maps to a known DeFi protocol.
    sym = str(fundamentals.get("coin_metadata", {}).get("symbol") or "").upper()
    if sym:
        proto = _try(defillama.find_protocol_by_symbol, sym)
        if proto["ok"] and proto["data"]:
            row = proto["data"]
            fundamentals["tvl"] = {
                "protocol": row.get("name"),
                "slug": row.get("slug"),
                "category": row.get("category"),
                "tvl_usd": row.get("tvl"),
                "chains": list((row.get("chainTvls") or {}).keys())[:10],
                "source": "defillama",
            }
        else:
            unavailable["defillama"] = (
                "no protocol match" if proto["ok"]
                else proto.get("reason") or "unreachable"
            )

    # 3. GitHub — developer activity and commit cadence.
    gh = _try(github.fetch_repo, pair, github_token)
    if gh["ok"]:
        repo_data = gh["data"]
        fundamentals["developer_activity"] = {
            "repository": repo_data.get("repository", ""),
            "url": repo_data.get("url", ""),
            "description": repo_data.get("description", ""),
            "popularity": repo_data.get("popularity", {}),
            "activity": repo_data.get("activity", {}),
            "source": "github",
        }
    else:
        unavailable["developer_activity"] = gh.get("reason") or "unreachable"

    # Explicit gaps that need a paid provider.
    if "tvl" not in fundamentals and "defillama" not in unavailable:
        unavailable["tvl"] = "no_defillama_protocol_match"
    unavailable["token_unlock_schedule"] = (
        "requires_paid_provider (TokenUnlocksApp / Messari)"
    )
    unavailable["etf_flows"] = (
        "requires_paid_provider (Coinglass Pro / Farside Investors)"
    )

    available = bool(fundamentals)
    return {
        "available": available,
        "kind": "measured",
        "fundamentals": fundamentals,
        "unavailable": unavailable,
        "disclaimer": (
            "Fundamentals are limited to what free, keyless providers "
            "(CoinGecko, DefiLlama) expose. Token unlock schedules, ETF "
            "flows, regulatory news, and developer activity require "
            "paid providers or curated feeds that are out of scope for "
            "this phase. Missing data is reported, not fabricated."
        ),
    }