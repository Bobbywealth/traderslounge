"""Section 15 (Correlation Analysis) — Phase 2.

Computes pairwise log-return correlations across the assets the
scanner can fetch OHLCV for. With our existing providers that
means:

  - Crypto vs crypto: BTC vs ETH, BTC vs XRP, BTC vs LTC, ...
    (computed from existing candle snapshots).
  - Crypto vs fiat (USD proxy) is implicit (USD is the quote).
  - Crypto vs SPX / NASDAQ / Gold / DXY / UST yields — NOT available
    without a paid reference-data provider, so this section reports
    those rows as ``unavailable`` with explicit reasons.

We deliberately compute correlations from log returns over the last
N closes of an aligned timeframe (default 1h, 240 bars = ~10 days)
to keep the result stable and reproducible.

Report-only — never feeds the BWTS score or Signals gate.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from scanner.data_types import Candle


def _log_returns(closes: List[float]) -> List[float]:
    out: List[float] = []
    for i in range(1, len(closes)):
        a, b = closes[i - 1], closes[i]
        if a > 0 and b > 0:
            out.append(math.log(b / a))
    return out


def _mean(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = _mean(values)
    var = sum((v - m) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def _correlation(a: List[float], b: List[float]) -> Optional[float]:
    n = min(len(a), len(b))
    if n < 30:
        return None
    a_tail = a[-n:]
    b_tail = b[-n:]
    ma, mb = _mean(a_tail), _mean(b_tail)
    sa, sb = _std(a_tail), _std(b_tail)
    if sa == 0 or sb == 0:
        return None
    cov = sum((x - ma) * (y - mb) for x, y in zip(a_tail, b_tail)) / (n - 1)
    return round(cov / (sa * sb), 3)


def _pair_returns(client, pair_a: str, pair_b: str,
                  timeframe: str = "1h", limit: int = 240) -> Optional[float]:
    """Best-effort log-return correlation between two pairs at one TF."""
    try:
        ca = client.fetch_candles(pair_a, timeframe, limit=limit)
        cb = client.fetch_candles(pair_b, timeframe, limit=limit)
    except Exception:
        return None
    closes_a = [c.close for c in ca if c.close > 0]
    closes_b = [c.close for c in cb if c.close > 0]
    return _correlation(_log_returns(closes_a), _log_returns(closes_b))


def compute(analysis: Dict[str, Any], snapshot: Any = None,
            market_client: Any = None) -> Dict[str, Any]:
    pair = analysis.get("pair") or ""

    matrix: Dict[str, Any] = {}
    unavailable: Dict[str, str] = {}

    if market_client is not None and pair:
        # BTC is always in our pair list; compute correlations vs BTC.
        other_crypto = ["ETHUSD", "XRPUSD", "LTCUSD", "DOTUSD", "XLMUSD",
                        "BATUSD", "NEOUSD"]
        for other in other_crypto:
            if other == pair:
                continue
            corr = _pair_returns(market_client, pair, other,
                                 timeframe="1h", limit=240)
            if corr is not None:
                matrix[f"{pair}_vs_{other}"] = corr
            else:
                matrix[f"{pair}_vs_{other}"] = None
        # FX via BTC vs USD pairs (USDJPY, EURUSD, GBPUSD, XAUUSD) is the
        # closest proxy we can compute without a paid reference feed.
        for fx in ("USDJPY", "EURUSD", "GBPUSD", "XAUUSD"):
            corr = _pair_returns(market_client, pair, fx,
                                 timeframe="1h", limit=240)
            if corr is not None:
                matrix[f"{pair}_vs_{fx}"] = corr
            else:
                matrix[f"{pair}_vs_{fx}"] = None
    else:
        unavailable["market_client"] = "not_provided"

    unavailable["spx_correlation"] = (
        "requires_paid_reference_feed (Twelve Data / Polygon)"
    )
    unavailable["nasdaq_correlation"] = (
        "requires_paid_reference_feed (Twelve Data / Polygon)"
    )
    unavailable["gold_correlation"] = (
        "free via XAUUSD pair if pair is not XAUUSD itself; otherwise "
        "requires paid reference feed"
    )
    unavailable["dxy_correlation"] = (
        "requires_paid_reference_feed (Twelve Data DXY index)"
    )
    unavailable["ust_yield_correlation"] = (
        "requires_paid_reference_feed (Twelve Data / FRED)"
    )

    available = bool(matrix)
    return {
        "available": available,
        "kind": "measured",
        "matrix": matrix,
        "unavailable": unavailable,
        "disclaimer": (
            "Correlations are Pearson on log returns over the last ~240 "
            "1-hour closes of the available scanner pairs. Rows are "
            "None where data was insufficient. SPX, NASDAQ, Gold, DXY, "
            "and UST-yield correlations require a paid reference-data "
            "provider and are reported as unavailable."
        ),
    }