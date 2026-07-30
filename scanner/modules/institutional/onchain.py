"""Section 12 (On-Chain) — Phase 2.

Tries the free, keyless Binance USD-M futures endpoints for funding
rate, open interest, global long/short ratio, and top trader
position ratio. Falls back gracefully:

  - Binance USD-M is geo-blocked from US egress (HTTP 451). The
    wrappers in :mod:`scanner.data_providers.binance_futures` raise
    :class:`HttpError` with status=451; we catch it and report
    ``available: False reason: geo_blocked`` so the renderer can
    show an honest gap rather than fabricated values.
  - When a non-US egress becomes available (Render region move,
    Binance.US integration, paid CryptoQuant, etc.) the same code
    lights up automatically — no change to this module required.

For metrics that have no free provider (whale alerts, MVRV, NVT,
active addresses, dormancy, miner flows), this module reports
``available: False`` with the explicit reason so the gap is visible.

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from scanner.data_providers import binance_futures, bybit, coingecko
from scanner.data_providers._http import HttpError

log = logging.getLogger(__name__)


def _try_provider(name: str, fn, *args, **kwargs):
    try:
        return {"provider": name, "data": fn(*args, **kwargs)}
    except HttpError as exc:
        return {"provider": name, "error": {"status": exc.status,
                                            "reason": exc.reason}}
    except Exception as exc:  # pragma: no cover - defensive
        return {"provider": name, "error": {"status": 0, "reason": str(exc)}}


def _shape_funding(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize Binance or Bybit funding-rate rows into one shape."""
    if not rows:
        return {}
    first = rows[0] if isinstance(rows[0], dict) else {}
    if "list" in first:
        first = first["list"][0] if first.get("list") else {}
    rate = first.get("fundingRate") or first.get("funding_rate") or first.get("fundingRate")
    try:
        rate_f = float(rate) if rate is not None else None
    except (TypeError, ValueError):
        rate_f = None
    return {
        "funding_rate": rate_f,
        "mark_price": first.get("markPrice") or first.get("mark_price"),
        "time": first.get("fundingTime") or first.get("time"),
    }


def compute(analysis: Dict[str, Any], snapshot: Any = None
            ) -> Dict[str, Any]:
    pair = analysis.get("pair") or "BTCUSD"

    metrics: Dict[str, Any] = {}
    unavailable: Dict[str, str] = {}

    # 1. Funding rate (try Binance USD-M first, then Bybit).
    binance_funding = _try_provider(
        "binance_usdm", binance_futures.fetch_funding_rate, pair, limit=1
    )
    if "data" in binance_funding:
        metrics["funding_rate"] = _shape_funding(binance_funding["data"])
        metrics["funding_rate"]["source"] = "binance_usdm"
    else:
        bybit_funding = _try_provider(
            "bybit", bybit.fetch_funding_history, pair, limit=1
        )
        if "data" in bybit_funding:
            row = (bybit_funding["data"].get("result") or {}).get("list") or []
            metrics["funding_rate"] = _shape_funding(row)
            metrics["funding_rate"]["source"] = "bybit"
        else:
            unavailable["funding_rate"] = "geo_blocked_or_unreachable"

    # 2. Open interest.
    binance_oi = _try_provider(
        "binance_usdm", binance_futures.fetch_open_interest, pair
    )
    if "data" in binance_oi:
        d = binance_oi["data"]
        try:
            metrics["open_interest"] = {
                "open_interest": float(d.get("openInterest") or 0),
                "symbol": d.get("symbol"),
                "time": d.get("time"),
                "source": "binance_usdm",
            }
        except (TypeError, ValueError):
            unavailable["open_interest"] = "invalid_response"
    else:
        unavailable["open_interest"] = "geo_blocked_or_unreachable"

    # 3. Long/short ratio.
    binance_ls = _try_provider(
        "binance_usdm", binance_futures.fetch_long_short_ratio, pair,
        period="5m", limit=1
    )
    if "data" in binance_ls:
        rows = binance_ls["data"]
        first = rows[0] if isinstance(rows, list) and rows else {}
        try:
            metrics["long_short_ratio"] = {
                "long_short_ratio": float(first.get("longShortRatio") or 0),
                "long_account": float(first.get("longAccount") or 0),
                "short_account": float(first.get("shortAccount") or 0),
                "source": "binance_usdm",
            }
        except (TypeError, ValueError, AttributeError):
            unavailable["long_short_ratio"] = "invalid_response"
    else:
        unavailable["long_short_ratio"] = "geo_blocked_or_unreachable"

    # 4. Top trader position ratio.
    binance_tt = _try_provider(
        "binance_usdm", binance_futures.fetch_top_trader_long_short, pair,
        period="5m", limit=1
    )
    if "data" in binance_tt:
        rows = binance_tt["data"]
        first = rows[0] if isinstance(rows, list) and rows else {}
        try:
            metrics["top_trader_long_short"] = {
                "long_short_ratio": float(first.get("longShortRatio") or 0),
                "long_account": float(first.get("longAccount") or 0),
                "short_account": float(first.get("shortAccount") or 0),
                "source": "binance_usdm",
            }
        except (TypeError, ValueError, AttributeError):
            unavailable["top_trader_long_short"] = "invalid_response"
    else:
        unavailable["top_trader_long_short"] = "geo_blocked_or_unreachable"

    # 5. Supply-side metrics from CoinGecko (free, no key, works from US).
    cg = _try_provider("coingecko", coingecko.fetch_coin, pair)
    if "data" in cg:
        md = cg["data"].get("market_data") or {}
        supply = cg["data"].get("supply") or {}
        metrics["supply"] = {
            "circulating": supply.get("circulating"),
            "total": supply.get("total"),
            "max": supply.get("max"),
            "infinite_max": supply.get("infinite_max", False),
            "market_cap_usd": (md.get("market_cap") or {}).get("usd"),
            "total_volume_24h_usd": (md.get("total_volume") or {}).get("usd"),
            "categories": cg["data"].get("categories") or [],
            "source": "coingecko",
        }

    # Metrics we explicitly cannot supply without a paid provider.
    # Always listed so the renderer can show the gap even when some free
    # metrics succeeded.
    unavailable.setdefault("exchange_inflows",
                           "requires_paid_provider (CryptoQuant/Glassnode)")
    unavailable.setdefault("whale_alerts",
                           "requires_paid_provider (Whale Alert)")
    unavailable.setdefault("mvrv",
                           "requires_paid_provider (Glassnode)")
    unavailable.setdefault("nvt",
                           "requires_paid_provider (Glassnode/CoinMetrics)")
    unavailable.setdefault("active_addresses",
                           "requires_paid_provider (Glassnode)")
    unavailable.setdefault("miner_activity",
                           "requires_paid_provider (Glassnode)")

    available = bool(metrics)
    return {
        "available": available,
        "kind": "measured",
        "metrics": metrics,
        "unavailable": unavailable,
        "disclaimer": (
            "Funding rate / OI / long-short ratio come from Binance USD-M "
            "futures, which is geo-blocked from US egress. When those "
            "endpoints return HTTP 451 we surface that explicitly rather "
            "than fabricating values. CoinGecko supply data is free and "
            "keyless. Other on-chain metrics (exchange inflows, whale "
            "alerts, MVRV, NVT, active addresses, miner activity) require "
            "a paid provider such as Glassnode, CoinMetrics, CryptoQuant, "
            "or Whale Alert."
        ),
    }