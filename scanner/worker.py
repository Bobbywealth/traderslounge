"""Background-worker entrypoint for Render.

Usage (locally):
    TWELVE_DATA_API_KEY=xxx python -m scanner.worker

Usage (Render): set the start command on the background worker service to
`python -m scanner.worker`. Required env vars: TWELVE_DATA_API_KEY.
"""
from __future__ import annotations

import logging
import sys

import os

from .binance_client import BinanceClient
from .config import load_from_env
from .data_provider import TwelveDataClient
from .multi_source import MultiSourceClient
from .news_feed import ForexFactoryClient
from .news_filter import NewsFilter
from .persistence import SQLiteRepository
from .scheduler import Scanner


def main() -> int:
    cfg = load_from_env()
    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if not cfg.twelve_data_api_key:
        # Crypto pairs (Binance, keyless) still work without a Twelve Data key;
        # forex/gold/index pairs are simply skipped. Warn instead of exiting
        # so a crypto-only scan can run with zero API keys.
        from .binance_client import supports as _is_crypto
        fx_pairs = [p for p in cfg.pairs if not _is_crypto(p)]
        if fx_pairs:
            print(
                "WARNING: TWELVE_DATA_API_KEY not set — forex/gold/index pairs "
                f"will be skipped: {fx_pairs}",
                file=sys.stderr,
            )
        else:
            print("INFO: running crypto-only (Binance, no API key required)",
                  file=sys.stderr)
    fx = TwelveDataClient(
        api_key=cfg.twelve_data_api_key,
        requests_per_minute=cfg.twelve_data_rpm,
    )
    crypto = BinanceClient()
    client = MultiSourceClient(fx=fx, crypto=crypto)
    news = NewsFilter(blackout_minutes=cfg.news_blackout_minutes)
    news_client = ForexFactoryClient()
    db_path = os.environ.get("SIGNAL_DB_PATH", "scanner.db")
    repo = SQLiteRepository(db_path)
    scanner = Scanner(
        config=cfg,
        client=client,
        news=news,
        news_client=news_client,
        repository=repo,
        emit_threshold=cfg.good_threshold,
        scan_request_path=os.environ.get("SCAN_REQUEST_PATH", "/tmp/bwts.scan_request"),
    )
    scanner.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
