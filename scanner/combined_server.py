"""Combined entrypoint: scanner loop (background thread) + HTTP read API.

Runs on a SINGLE Render web service. In production, DATABASE_URL selects
managed Postgres so scanner output survives deploys and restarts. Without a
DATABASE_URL it uses a local SQLite file for development.

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

from .api import ApiState, make_server, start_signal_monitor
from .alert_preferences import AlertPreferencesStore
from .binance_client import BinanceClient
from .config import load_from_env
from .data_provider import TwelveDataClient
from .fmp_client import FMPClient
from .kill_switch import KillSwitch
from .multi_source import MultiSourceClient
from .news_feed import ForexFactoryClient
from .news_filter import NewsFilter
from .repository_factory import create_signal_repository
from .scheduler import Scanner
from .telegram_bot import TelegramBot
from .trade_repo import SQLiteClosedTradeRepository, SQLitePositionRepository


def main() -> int:
    cfg = load_from_env()
    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    db_path = os.environ.get("SIGNAL_DB_PATH", "scanner.db")
    repo = create_signal_repository()

    # --- scanner (background thread) -------------------------------------
    fx = TwelveDataClient(api_key=cfg.twelve_data_api_key)
    crypto = BinanceClient()  # default base = api.binance.us (US-legal)
    fmp = (
        FMPClient(api_key=cfg.fmp_api_key, requests_per_minute=cfg.fmp_rpm)
        if cfg.fmp_api_key else None
    )
    client = MultiSourceClient(fx=fx, crypto=crypto, fmp=fmp)
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
    alert_store = AlertPreferencesStore(repository=repo)
    state = ApiState(
        repository=repo,
        config=cfg,
        position_repo=position_repo,
        closed_trade_repo=closed_trade_repo,
        kill_switch=kill_switch,
        scan_request_path=scan_request_path,
        market_client=client,
        news_filter=news,
        alert_preferences_store=alert_store,
        alert_repo=repo,
    )
    # Wire the Telegram bot into API state and rebuild the chat_id
    # reverse index from persisted preferences so a deploy does not
    # require every user to re-link their Telegram chat.
    telegram_bot = TelegramBot()
    state.telegram_bot = telegram_bot
    if telegram_bot.is_configured:
        for uid in state.alert_preferences_store.all_user_ids():
            prefs = state.alert_preferences_store.get(int(uid))
            chat_id = getattr(prefs, "telegram_chat_id", None) if prefs else None
            if chat_id:
                try:
                    telegram_bot.remember_chat_link(chat_id, int(uid))
                except (TypeError, ValueError):
                    continue
    host = os.environ.get("API_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = make_server(state, host=host, port=port)
    monitor_stop = start_signal_monitor(state)
    print(f"combined API listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        monitor_stop.set()
        server.server_close()
        repo.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
