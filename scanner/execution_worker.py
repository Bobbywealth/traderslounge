"""Execution worker — Render background service.

Wires the scanner's STRONG signals into the trade manager. Runs the scan
loop and, on every cycle, also manages open positions.

EXECUTION_MODE env var:
    "paper" (default) — uses PaperBroker, never touches the network
    "live"            — uses TradeLockerBroker; requires TRADELOCKER_API_KEY
                        and TRADELOCKER_API_SECRET

Defaulting to paper is intentional: a logic bug in live mode places real
orders. Don't set EXECUTION_MODE=live until you've verified a paper run
end-to-end on Render.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from typing import Optional

from .broker import Broker, NullBroker, PaperBroker
from .config import load_from_env
from .data_provider import TwelveDataClient
from .kill_switch import KillSwitch
from .news_feed import ForexFactoryClient
from .news_filter import NewsFilter
from .persistence import SQLiteRepository
from .risk_manager import RiskManager
from .scheduler import Scanner
from .signal import Signal
from .trade_manager import TradeManager


def _build_broker() -> Broker:
    mode = os.environ.get("EXECUTION_MODE", "paper").lower()
    if mode == "live":
        from .tradelocker_broker import TradeLockerBroker  # local import: only needed in live
        key = os.environ.get("TRADELOCKER_API_KEY", "")
        secret = os.environ.get("TRADELOCKER_API_SECRET", "")
        base = os.environ.get("TRADELOCKER_BASE_URL", "https://api.tradelocker.com")
        account = os.environ.get("TRADELOCKER_ACCOUNT_ID")
        if not key or not secret:
            raise SystemExit(
                "EXECUTION_MODE=live but TRADELOCKER_API_KEY/SECRET missing — refusing to start"
            )
        return TradeLockerBroker(api_key=key, api_secret=secret, base_url=base,
                                 account_id=account)
    if mode == "paper":
        starting = float(os.environ.get("PAPER_STARTING_BALANCE_USD", "10000"))
        return PaperBroker(starting_balance_usd=starting)
    if mode == "off":
        return NullBroker()
    raise SystemExit(f"Unknown EXECUTION_MODE: {mode}")


def _price_oracle_from(client: TwelveDataClient):
    """Use the M15 close as the manage-cycle price. One API call per pair."""
    def oracle(pair: str) -> Optional[float]:
        try:
            candles = client.fetch_candles(pair, "M15")
        except Exception:
            return None
        return candles[-1].close if candles else None
    return oracle


def main() -> int:
    cfg = load_from_env()
    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger("execution_worker")

    if not cfg.twelve_data_api_key:
        print("ERROR: TWELVE_DATA_API_KEY env var not set", file=sys.stderr)
        return 1

    client = TwelveDataClient(api_key=cfg.twelve_data_api_key)
    news = NewsFilter(blackout_minutes=cfg.news_blackout_minutes)
    news_client = ForexFactoryClient()
    repo = SQLiteRepository(os.environ.get("SIGNAL_DB_PATH", "scanner.db"))

    broker = _build_broker()
    log.info("broker=%s", broker.name)

    risk_pct = float(os.environ.get("RISK_PER_TRADE_PCT", "0.5"))
    risk = RiskManager(risk_per_trade_pct=risk_pct)
    kill = KillSwitch()
    tm = TradeManager(
        broker=broker, risk=risk, kill_switch=kill,
        price_oracle=_price_oracle_from(client),
    )

    def execution_sink(sig: Signal) -> None:
        decision = tm.on_signal(sig)
        log.info("signal %s/%s → %s (%s)",
                 sig.pair, sig.tier.value, "ACCEPTED" if decision.accepted else "REJECTED",
                 decision.reason)

    scanner = Scanner(
        config=cfg,
        client=client,
        news=news,
        news_client=news_client,
        repository=repo,
        sink=execution_sink,
        emit_threshold=cfg.strong_threshold,  # only STRONG signals get executed
    )

    log.info("execution worker starting: mode=%s pairs=%d interval=%ds risk=%.2f%%",
             os.environ.get("EXECUTION_MODE", "paper"), len(cfg.pairs),
             cfg.scan_interval_seconds, risk_pct)

    while True:
        started = time.monotonic()
        try:
            scanner.scan_once()
            actions = tm.manage_open_positions()
            for a in actions:
                log.info("manage: %s", a)
        except Exception:
            log.exception("execution cycle crashed")
        elapsed = time.monotonic() - started
        time.sleep(max(1.0, cfg.scan_interval_seconds - elapsed))


if __name__ == "__main__":
    raise SystemExit(main())
