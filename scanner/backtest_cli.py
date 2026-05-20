"""Backtest CLI.

Usage:
    python -m scanner.backtest_cli --pair XAUUSD --fixture path/to/candles.csv

CSV format (same as scanner.run):
    timeframe,time,open,high,low,close,volume
where timeframe ∈ {D1, H4, H1, M15, M5, M1}.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from .backtester import run_backtest
from .data_types import Candle


def load_fixture(path: Path) -> dict[str, list[Candle]]:
    buckets: dict[str, list[Candle]] = {
        "D1": [], "H4": [], "H1": [], "M15": [], "M5": [], "M1": [],
    }
    with path.open() as f:
        for row in csv.DictReader(f):
            tf = row["timeframe"].strip().upper()
            if tf not in buckets:
                continue
            buckets[tf].append(Candle(
                time=int(float(row["time"])),
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row.get("volume") or 0),
            ))
    return buckets


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--pair", required=True)
    p.add_argument("--fixture", required=True, type=Path)
    p.add_argument("--balance", type=float, default=10_000.0)
    p.add_argument("--risk-pct", type=float, default=0.5)
    p.add_argument("--stride", type=int, default=4,
                   help="score every Nth M15 bar (4 ≈ hourly)")
    args = p.parse_args(argv)

    buckets = load_fixture(args.fixture)
    result = run_backtest(
        pair=args.pair,
        d1=buckets["D1"], h4=buckets["H4"], h1=buckets["H1"], m15=buckets["M15"],
        starting_balance_usd=args.balance,
        risk_per_trade_pct=args.risk_pct,
        stride=args.stride,
    )
    print(result.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
