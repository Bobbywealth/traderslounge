"""Section 16 (Relative Strength) — Phase 2.

Computes relative-strength vs a benchmark and a leadership ranking
across the pairs we can fetch OHLCV for.

Benchmark selection:
  - For a crypto pair: BTCUSD.
  - For an FX pair: USDJPY (the most-traded FX proxy).

Relative strength is defined here as:

  rs_pct = (pair_return_n_bars - benchmark_return_n_bars) * 100

over the last N closes (default N = 24, default TF = 1h, so ~1 day
of outperformance).

Leadership ranking:
  - Sort all available pairs by rs_pct descending.
  - The current pair's rank within that list becomes its
    ``leadership`` value: "leader" (top quartile), "average",
    "laggard" (bottom quartile).

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _pct_return(closes: List[float], n: int) -> Optional[float]:
    if len(closes) < n + 1:
        return None
    start = closes[-n - 1]
    end = closes[-1]
    if start <= 0 or end <= 0:
        return None
    return (end - start) / start


def _returns_for(client, pair: str, tf: str, limit: int) -> Optional[float]:
    try:
        candles = client.fetch_candles(pair, tf, limit=limit)
    except Exception:
        return None
    closes = [c.close for c in candles if c.close > 0]
    return _pct_return(closes, limit - 1)


def _benchmark_for(pair: str) -> Optional[str]:
    p = (pair or "").upper()
    if p in ("BTCUSD", "ETHUSD", "XRPUSD", "LTCUSD", "DOTUSD",
             "XLMUSD", "BATUSD", "NEOUSD"):
        return "BTCUSD"
    if p in ("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD",
             "USDCAD", "NZDUSD", "XAUUSD", "XAGUSD"):
        return "USDJPY"
    return None


_CRYPTO_PAIRS = ["BTCUSD", "ETHUSD", "XRPUSD", "LTCUSD", "DOTUSD",
                 "XLMUSD", "BATUSD", "NEOUSD"]
_FX_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"]


def compute(analysis: Dict[str, Any], snapshot: Any = None,
            market_client: Any = None) -> Dict[str, Any]:
    pair = (analysis.get("pair") or "").upper()
    benchmark = _benchmark_for(pair)

    rs_pct: Optional[float] = None
    leadership: Optional[str] = None
    ranking: Dict[str, Optional[float]] = {}

    if market_client is not None and benchmark and pair:
        lookback_bars = 24
        pair_ret = _returns_for(market_client, pair, "1h", lookback_bars + 1)
        bench_ret = _returns_for(market_client, benchmark, "1h", lookback_bars + 1)
        if pair_ret is not None and bench_ret is not None:
            rs_pct = round((pair_ret - bench_ret) * 100, 3)

        # Leadership ranking across all available pairs in the same class.
        target_list = _CRYPTO_PAIRS if pair in _CRYPTO_PAIRS else _FX_PAIRS
        for p in target_list:
            ret = _returns_for(market_client, p, "1h", lookback_bars + 1)
            if ret is None:
                ranking[p] = None
                continue
            bench_for_p = _benchmark_for(p)
            if not bench_for_p:
                ranking[p] = None
                continue
            bench_ret_p = _returns_for(
                market_client, bench_for_p, "1h", lookback_bars + 1
            )
            if bench_ret_p is None:
                ranking[p] = None
                continue
            ranking[p] = round((ret - bench_ret_p) * 100, 3)

        ranked = sorted(
            ((p, r) for p, r in ranking.items() if r is not None),
            key=lambda kv: kv[1],
            reverse=True,
        )
        if ranked:
            n = len(ranked)
            top_quartile = max(1, n // 4)
            bottom_quartile_start = n - top_quartile
            for idx, (p, _) in enumerate(ranked):
                if p != pair:
                    continue
                if idx < top_quartile:
                    leadership = "leader"
                elif idx >= bottom_quartile_start:
                    leadership = "laggard"
                else:
                    leadership = "average"
                break

    return {
        "available": rs_pct is not None,
        "kind": "measured",
        "pair": pair,
        "benchmark": benchmark,
        "rs_pct_24h": rs_pct,
        "leadership": leadership,
        "ranking": ranking,
        "notes": (
            "RS pct = (pair_return_24h - benchmark_return_24h) * 100. "
            "Benchmark is BTCUSD for crypto pairs, USDJPY for FX/metal. "
            "Leadership rank is computed within the asset class; pairs "
            "with insufficient data are excluded from the ranking."
        ),
    }