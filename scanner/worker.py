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

from .config import load_from_env
from .data_provider import TwelveDataClient
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
        print("ERROR: TWELVE_DATA_API_KEY env var not set", file=sys.stderr)
        return 1
    client = TwelveDataClient(api_key=cfg.twelve_data_api_key)
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
    )
    scanner.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
