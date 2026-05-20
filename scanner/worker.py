"""Background-worker entrypoint for Render.

Usage (locally):
    TWELVE_DATA_API_KEY=xxx python -m scanner.worker

Usage (Render): set the start command on the background worker service to
`python -m scanner.worker`. Required env vars: TWELVE_DATA_API_KEY.
"""
from __future__ import annotations

import logging
import sys

from .config import load_from_env
from .data_provider import TwelveDataClient
from .news_filter import NewsFilter
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
    scanner = Scanner(
        config=cfg,
        client=client,
        news=news,
        emit_threshold=cfg.good_threshold,
    )
    scanner.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
