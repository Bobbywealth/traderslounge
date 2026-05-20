"""CLI: load a CSV of candles for one pair, run the scoring engine.

Usage:
    python -m scanner.run --pair XAUUSD --fixture path/to/candles.csv

The CSV expects columns: timeframe,time,open,high,low,close,volume
where timeframe is one of D1,H4,H1,M15,M5,M1.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from .data_types import Candle, MarketSnapshot
from .scoring_engine import score


def load_fixture(path: Path, pair: str) -> MarketSnapshot:
    snap = MarketSnapshot(pair=pair)
    bucket = {
        "D1": snap.d1, "H4": snap.h4, "H1": snap.h1,
        "M15": snap.m15, "M5": snap.m5, "M1": snap.m1,
    }
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            tf = row["timeframe"].strip().upper()
            if tf not in bucket:
                continue
            bucket[tf].append(Candle(
                time=int(float(row["time"])),
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row.get("volume") or 0),
            ))
    return snap


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--pair", required=True)
    p.add_argument("--fixture", required=True, type=Path)
    args = p.parse_args(argv)
    snap = load_fixture(args.fixture, args.pair)
    sig = score(snap)
    print(sig.telegram_card())
    return 0


if __name__ == "__main__":
    sys.exit(main())
