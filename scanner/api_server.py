"""HTTP API entrypoint — Render web service.

Usage (local):
    SIGNAL_DB_PATH=scanner.db python -m scanner.api_server

Usage (Render): set the start command on the web service to
`python -m scanner.api_server`. Reads the same SQLite file the
background worker writes to (mount a shared disk on Render or use
the Postgres backend in production).
"""
from __future__ import annotations

import logging
import os
import sys

from .api import ApiState, make_server, start_signal_monitor
from .binance_client import BinanceClient
from .config import load_from_env
from .data_provider import TwelveDataClient
from .fmp_client import FMPClient
from .kill_switch import KillSwitch
from .multi_source import MultiSourceClient
from .news_feed import ForexFactoryClient, refresh_filter
from .news_filter import NewsFilter
from .alert_preferences import AlertPreferencesStore
from .persistence import SQLiteUserRepository
from .repository_factory import (
    create_signal_repository,
    create_user_repository,
    create_position_repository,
    create_closed_trade_repository,
    create_trade_manager_state_repository,
    create_last_analysis_repository,
)
from .telegram_bot import TelegramBot
from .trade_repo import SQLiteClosedTradeRepository, SQLitePositionRepository


def main() -> int:
    cfg = load_from_env()
    
    # Configure structured JSON logging with environment context
    from .logging_config import setup_logging
    environment = os.environ.get("ENVIRONMENT", "development")
    app_version = os.environ.get("APPLICATION_VERSION", "unknown")
    setup_logging(level=cfg.log_level, environment=environment, application_version=app_version)
    repo = create_signal_repository()

    db_path_for_aux = os.environ.get("SIGNAL_DB_PATH", "scanner.db")
    # When DATABASE_URL is set, every repo here transparently swaps to its
    # Postgres adapter via the factory. SQLite stays as the local-dev fallback.
    position_repo = create_position_repository(db_path_for_aux)
    closed_trade_repo = create_closed_trade_repository(db_path_for_aux)
    user_repo = create_user_repository(db_path_for_aux)
    trade_manager_state_repo = create_trade_manager_state_repository()
    last_analysis_repo = create_last_analysis_repository()
    kill_switch = KillSwitch()
    scan_request_path = os.environ.get("SCAN_REQUEST_PATH", "/tmp/bwts.scan_request")
    news = NewsFilter(blackout_minutes=cfg.news_blackout_minutes)
    refresh_filter(ForexFactoryClient(), news)

    # Market-data client used by the on-demand /api/analysis, /api/candles,
    # /api/adr, /api/harmonics and /api/backtest/v2 endpoints. Crypto runs on
    # keyless Binance; FX/gold/indices route to Twelve Data (needs
    # TWELVE_DATA_API_KEY). Without the key, crypto still works and FX degrades
    # gracefully per request rather than 503-ing every call.
    fx = TwelveDataClient(
        api_key=cfg.twelve_data_api_key,
        requests_per_minute=cfg.twelve_data_rpm,
    )
    # Equities/ETFs route to FMP (needs FMP_API_KEY). Without it, equity
    # requests degrade to empty per request; crypto/FX keep working.
    fmp = (
        FMPClient(api_key=cfg.fmp_api_key, requests_per_minute=cfg.fmp_rpm)
        if cfg.fmp_api_key else None
    )
    market_client = MultiSourceClient(fx=fx, crypto=BinanceClient(), fmp=fmp)

    host = os.environ.get("API_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    alert_store = AlertPreferencesStore(repository=repo)
    state = ApiState(
        repository=repo, config=cfg,
        position_repo=position_repo,
        closed_trade_repo=closed_trade_repo,
        user_repo=user_repo,
        kill_switch=kill_switch,
        scan_request_path=scan_request_path,
        news_filter=news,
        market_client=market_client,
        alert_preferences_store=alert_store,
        alert_repo=repo,
    )
    # Wire the Telegram bot handle into API state. Constructing the
    # handle is safe even when TELEGRAM_BOT_TOKEN is unset; every
    # send_message / set_webhook call will be a logged no-op until a
    # token is provided.
    telegram_bot = TelegramBot()
    state.telegram_bot = telegram_bot
    if telegram_bot.is_configured:
        # Rebuild the chat_id -> user_id reverse index from persisted
        # preferences so an API restart does not require every user to
        # re-link their Telegram chat.
        store = state.alert_preferences_store
        if store is None:
            store = AlertPreferencesStore()
            state.alert_preferences_store = store
        for uid in store.all_user_ids():
            prefs = store.get(int(uid))
            chat_id = getattr(prefs, "telegram_chat_id", None) if prefs else None
            if chat_id:
                try:
                    telegram_bot.remember_chat_link(chat_id, int(uid))
                except (TypeError, ValueError):
                    continue
    server = make_server(state, host=host, port=port)
    monitor_stop = start_signal_monitor(state)
    print(f"API listening on http://{host}:{port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        monitor_stop.set()
        server.server_close()
        repo.close()
    return 0


def _redact(url: str) -> str:
    """Hide password in a libpq DSN/URL for log output."""
    if "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    if "@" not in rest:
        return url
    creds, host = rest.split("@", 1)
    if ":" in creds:
        user = creds.split(":", 1)[0]
        creds = f"{user}:***"
    return f"{scheme}://{creds}@{host}"


if __name__ == "__main__":
    raise SystemExit(main())
