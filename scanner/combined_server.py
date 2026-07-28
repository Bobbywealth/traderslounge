"""Combined entrypoint: scanner loop (background thread) + HTTP read API.

Runs on a SINGLE Render web service and shares one SQLite file on that
service's filesystem, so the worker that writes signals and the API that
reads them see the same database without needing Postgres or a shared
Disk. This is the Path A deployment target (crypto-only, zero API keys).

Usage (local):
    SCANNER_PAIRS=BTCUSD,ETHUSD python -m scanner.combined_server

Usage (Render): set the web service start command to
    python -m scanner.combined_server
and set SCANNER_PAIRS to the crypto pairs you want scanned. PORT is set
automatically by Render.
"""
from __future__ import annotations

import logging
import os
import threading

from .api import ApiState, make_server
from .binance_client import BinanceClient
from .config import load_from_env
from .data_provider import TwelveDataClient
from .kill_switch import KillSwitch
from .multi_source import MultiSourceClient
from .news_feed import ForexFactoryClient
from .news_filter import NewsFilter
from .persistence import SQLiteRepository
from .scheduler import Scanner
from .trade_repo import SQLiteClosedTradeRepository, SQLitePositionRepository


def main() -> int:
    cfg = load_from_env()
    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    db_path = os.environ.get("SIGNAL_DB_PATH", "scanner.db")
    repo = SQLiteRepository(db_path)

    # --- scanner (background thread) -------------------------------------
    fx = TwelveDataClient(api_key=cfg.twelve_data_api_key)
    crypto = BinanceClient()  # default base = api.binance.us (US-legal)
    client = MultiSourceClient(fx=fx, crypto=crypto)
    news = NewsFilter(blackout_minutes=cfg.news_blackout_minutes)
    news_client = ForexFactoryClient()
    scan_request_path = os.environ.get("SCAN_REQUEST_PATH", "/tmp/bwts.scan_request")
    scanner = Scanner(
        config=cfg,
        client=client,
        news=news,
        news_client=news_client,
        repository=repo,
        emit_threshold=cfg.good_threshold,
        scan_request_path=scan_request_path,
    )

    run_scanner = os.environ.get("RUN_SCANNER_THREAD", "1") == "1"
    if run_scanner:
        t = threading.Thread(
            target=scanner.run_forever, name="bwts-scanner", daemon=True
        )
        t.start()
        logging.info("scanner thread started (%d pairs, %ds interval)",
                     len(cfg.pairs), cfg.scan_interval_seconds)
    else:
        logging.info("RUN_SCANNER_THREAD=0 — serving API only")

    # --- HTTP read API (foreground) --------------------------------------
    position_repo = SQLitePositionRepository(db_path)
    closed_trade_repo = SQLiteClosedTradeRepository(db_path)
    kill_switch = KillSwitch()
    state = ApiState(
        repository=repo,
        config=cfg,
        position_repo=position_repo,
        closed_trade_repo=closed_trade_repo,
        kill_switch=kill_switch,
        scan_request_path=scan_request_path,
        market_client=client,
        news_filter=news,
    )
    host = os.environ.get("API_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = make_server(state, host=host, port=port)
    print(f"combined API listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        repo.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
