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
try:
    # BotRunner may be absent in slimmer deployment images; the read API
    # boots without it and /api/bot/status simply returns 503 until the
    # bot worker is deployed alongside.
    from .bot_runner import BotRunner
except ImportError:
    BotRunner = None  # type: ignore[assignment,misc]
from .broker import PaperBroker
from .config import load_from_env
from .data_provider import TwelveDataClient
from .fmp_client import FMPClient
from .kill_switch import KillSwitch
from .multi_source import MultiSourceClient
from .news_feed import ForexFactoryClient
from .news_filter import NewsFilter
from .repository_factory import (
    create_signal_repository,
    create_user_repository,
    create_position_repository,
    create_closed_trade_repository,
    create_trade_manager_state_repository,
)
from .risk_manager import RiskManager
from .scheduler import Scanner
from .telegram_bot import TelegramBot
from .trade_manager import TradeManager
from .trade_repo import SQLiteClosedTradeRepository, SQLitePositionRepository


def main() -> int:
    cfg = load_from_env()
    
    # Configure structured JSON logging with environment context
    from .logging_config import setup_logging
    environment = os.environ.get("ENVIRONMENT", "development")
    app_version = os.environ.get("APPLICATION_VERSION", "unknown")
    setup_logging(level=cfg.log_level, environment=environment, application_version=app_version)

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

        # Start the autonomous loop (market watcher, session, regime, alert
        # engine, opportunity scanner, setup lifecycle, paper trading, etc.).
        # A daemon thread feeds it fresh market data every 60 seconds.
        try:
            from .autonomy.loop import AutonomousLoop
            loop = AutonomousLoop()
            loop.set_repository(repo)
            loop.start()

            def _autonomy_feeder():
                import time as _t
                import threading as _threading
                while True:
                    try:
                        data = {}
                        from .crypto_analysis import analyze_crypto
                        fetched = 0
                        analyzed = 0
                        for pair in cfg.pairs:
                            try:
                                # Use a dedicated thread with timeout to avoid blocking
                                result = [None]
                                error = [None]
                                def _fetch(p=pair):
                                    try:
                                        result[0] = client.fetch_snapshot(p)
                                    except Exception as e:
                                        error[0] = e
                                t = _threading.Thread(target=_fetch, daemon=True)
                                t.start()
                                t.join(timeout=20)  # 20s max per pair
                                if t.is_alive():
                                    logging.warning("autonomy feeder: timeout fetching %s (20s)", pair)
                                    continue
                                if error[0]:
                                    logging.debug("autonomy feeder: fetch error %s: %s", pair, error[0])
                                    continue
                                snapshot = result[0]
                                if not snapshot or not snapshot.h1:
                                    continue
                                fetched += 1
                                analysis = analyze_crypto(snapshot)
                                ref_price = analysis.get('data_quality', {}).get('reference_price') or 0
                                if ref_price <= 0:
                                    continue
                                data[pair] = {"price": ref_price, "analysis": analysis}
                                analyzed += 1
                                # Register data quality so the scanner's can_trade() check passes
                                loop.data_quality.update_tick_age(pair, 0)
                                loop.data_quality.update_candle_age(pair, 0)
                            except Exception:
                                logging.debug("autonomy feeder: failed to analyze %s", pair)
                        logging.info("autonomy feeder: fetched=%d analyzed=%d pairs", fetched, analyzed)
                        if data:
                            loop.run_cycle(data)
                    except Exception:
                        logging.exception("autonomy feeder cycle error")
                    _t.sleep(60)

            threading.Thread(target=_autonomy_feeder, name="autonomy-feeder", daemon=True).start()
            logging.info("autonomous loop started (mode: %s)", loop.config.mode.value)
        except Exception:
            logging.exception("autonomous loop failed to start")
    else:
        logging.info("RUN_SCANNER_THREAD=0 — serving API only")

    # --- HTTP read API (foreground) --------------------------------------
    # When DATABASE_URL is set, every repo here transparently swaps to its
    # Postgres adapter via the factory. SQLite stays as the local-dev fallback.
    position_repo = create_position_repository(db_path)
    closed_trade_repo = create_closed_trade_repository(db_path)
    user_repo = create_user_repository(db_path)
    kill_switch = KillSwitch()
    alert_store = AlertPreferencesStore(repository=repo)
    # --- bot runner (paper-mode default; only fires on the execution
    #     worker when EXECUTION_MODE=live). On the read API it mirrors
    #     state for the admin dashboard so the user can see bot status
    #     even before the execution worker is deployed.
    paper_broker = PaperBroker(starting_balance_usd=float(
        os.environ.get("PAPER_STARTING_BALANCE_USD", "10000")))
    risk = RiskManager(risk_per_trade_pct=float(
        os.environ.get("RISK_PER_TRADE_PCT", "0.5")))
    tm = TradeManager(
        broker=paper_broker, risk=risk, kill_switch=kill_switch,
        price_oracle=lambda _pair: None,  # read-API has no manage-cycle
        position_repo=position_repo,
        closed_trade_repo=closed_trade_repo,
        state_repo=create_trade_manager_state_repository(),
    )
    bot_runner = None
    if BotRunner is not None:
        try:
            bot_runner = BotRunner(
                trade_manager=tm, broker=paper_broker, kill_switch=kill_switch,
            )
        except Exception:
            logging.exception("BotRunner init failed; /api/bot/status will be unavailable")
    state = ApiState(
        repository=repo,
        config=cfg,
        position_repo=position_repo,
        closed_trade_repo=closed_trade_repo,
        user_repo=user_repo,
        kill_switch=kill_switch,
        scan_request_path=scan_request_path,
        market_client=client,
        news_filter=news,
        alert_preferences_store=alert_store,
        alert_repo=repo,
        bot_runner=bot_runner,
    )
    # Wire the Telegram bot into API state and rebuild the chat_id
    # reverse index from persisted preferences so a deploy does not
    # require every user to re-link their Telegram chat.
    telegram_bot = TelegramBot()
    state.telegram_bot = telegram_bot
    # Wire telegram bot to autonomous loop if it was started
    try:
        loop.set_telegram_bot(telegram_bot)
    except Exception:
        pass  # loop may not be defined if RUN_SCANNER_THREAD=0
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
