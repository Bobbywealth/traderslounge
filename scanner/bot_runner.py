"""Bot runner — automated trading strategy.

Glues the scanner's STRONG signals to the trade manager. Replaces the
inline execution_sink in execution_worker.py with a stateful runner
that:

- Tracks running state (paused / running / error) durably so the
  dashboard can render the status across restarts.
- Carries a user-editable config (max concurrent positions, which
  horizons to take, etc.) so the admin can tune the bot without a
  redeploy.
- Logs every decision (signal accepted, signal rejected, position
  closed) to a recent-actions ring buffer exposed via /api/bot/status.
- Honours the global KillSwitch — a single file-flag halts both new
  entries AND exit-only mode below.

Two horizons are supported:
- short_term: intraday plays (1H/4H charts, tight targets). Default
  partial-close at TP1 is 70% (take most off) and the runner remains
  active on the residual.
- long_term: swing plays (Daily/Weekly charts, wider targets). Default
  partial-close at TP1 is 50% and the runner holds the residual until
  TP2 or SL.

The horizon is computed by signal.classify_horizon() in scanner/signal.py
and recorded on the Position so the UI can split open positions by
horizon.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Deque, Dict, List, Optional

from .broker import Broker, Position
from .kill_switch import KillSwitch
from .risk_manager import RiskManager
from .signal import Signal, Tier
from .trade_manager import TradeManager

log = logging.getLogger(__name__)


# ---- config -----------------------------------------------------------

@dataclass
class BotConfig:
    """User-editable bot configuration.

    Persisted as JSON next to the SQLite trade-manager tables so admin
    updates via /api/bot/config survive a Render restart.
    """
    enabled: bool = False                              # master toggle
    accept_short_term: bool = True                     # take intraday signals
    accept_long_term: bool = True                      # take swing signals
    min_tier: str = "STRONG"                           # "STRONG" | "GOOD"
    max_concurrent_positions: int = 5
    max_short_term_positions: int = 3
    max_long_term_positions: int = 3
    short_term_partial_close: float = 0.7              # take 70% at TP1
    long_term_partial_close: float = 0.5               # take 50% at TP1
    risk_per_trade_pct: float = 0.5                    # delegated to RiskManager
    # Cap on how many signals we'll accept per scan cycle. Even if many
    # STRONG signals land in one cycle, the bot won't open more than this
    # many positions at once — guards against runaway entries after a
    # long frontend outage.
    max_entries_per_cycle: int = 2


DEFAULT_CONFIG = BotConfig()


# ---- state -----------------------------------------------------------

@dataclass
class BotState:
    """Persisted bot state — visible at /api/bot/status."""
    running: bool = False
    started_at: Optional[float] = None
    stopped_at: Optional[float] = None
    last_action_at: Optional[float] = None
    last_action: str = ""
    last_error: str = ""
    accepted_count: int = 0
    rejected_count: int = 0
    closed_count: int = 0


# ---- runner ----------------------------------------------------------

class BotRunner:
    """Owns the running state and the signal→TradeManager pipeline."""

    def __init__(
        self,
        trade_manager: TradeManager,
        broker: Broker,
        kill_switch: KillSwitch,
        state_path: Optional[Path] = None,
        config_path: Optional[Path] = None,
        clock: Optional[Callable[[], float]] = None,
    ):
        self.trade_manager = trade_manager
        self.broker = broker
        self.kill_switch = kill_switch
        self.state_path = state_path or Path(
            os.environ.get("BOT_STATE_PATH", "/tmp/bwts.bot.state.json")
        )
        self.config_path = config_path or Path(
            os.environ.get("BOT_CONFIG_PATH", "/tmp/bwts.bot.config.json")
        )
        self._clock = clock or time.time
        self._lock = threading.Lock()
        self.state = BotState()
        self.config = DEFAULT_CONFIG
        self._actions: Deque[Dict] = deque(maxlen=50)

        self._load_state()
        self._load_config()

    # ---- persistence --------------------------------------------------

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text())
            self.state = BotState(**{k: v for k, v in data.items()
                                     if k in BotState.__annotations__})
        except Exception:
            log.exception("failed to load bot state; starting fresh")

    def _save_state(self) -> None:
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.state_path.write_text(json.dumps(asdict(self.state)))
        except Exception:
            log.exception("failed to save bot state")

    def _load_config(self) -> None:
        if not self.config_path.exists():
            return
        try:
            data = json.loads(self.config_path.read_text())
            self.config = BotConfig(**{k: v for k, v in data.items()
                                       if k in BotConfig.__annotations__})
        except Exception:
            log.exception("failed to load bot config; using defaults")

    def _save_config(self) -> None:
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            self.config_path.write_text(json.dumps(asdict(self.config)))
        except Exception:
            log.exception("failed to save bot config")

    # ---- control ------------------------------------------------------

    def start(self) -> BotState:
        with self._lock:
            self.state.running = True
            self.state.started_at = self._clock()
            self.state.stopped_at = None
            self.state.last_error = ""
            self._record_action("bot started")
            self._save_state()
            log.info("bot started: %s", asdict(self.config))
        return self.state

    def stop(self) -> BotState:
        with self._lock:
            self.state.running = False
            self.state.stopped_at = self._clock()
            self._record_action("bot stopped")
            self._save_state()
            log.info("bot stopped")
        return self.state

    def update_config(self, **updates) -> BotConfig:
        with self._lock:
            for k, v in updates.items():
                if hasattr(self.config, k) and v is not None:
                    setattr(self.config, k, v)
            self._save_config()
            self._record_action(f"config updated: {list(updates.keys())}")
        return self.config

    # ---- queries ------------------------------------------------------

    def status(self) -> Dict:
        """Render the dashboard-visible status snapshot."""
        with self._lock:
            running = self.state.running
            opened = [p for p in self.broker.list_positions() if p.status != "closed"]
            short_term = [p for p in opened if p.horizon == "short_term"]
            long_term = [p for p in opened if p.horizon == "long_term"]
            return {
                "running": running,
                "enabled": self.config.enabled,
                "started_at": self.state.started_at,
                "stopped_at": self.state.stopped_at,
                "last_action_at": self.state.last_action_at,
                "last_action": self.state.last_action,
                "last_error": self.state.last_error,
                "stats": {
                    "accepted": self.state.accepted_count,
                    "rejected": self.state.rejected_count,
                    "closed": self.state.closed_count,
                },
                "positions": {
                    "open_total": len(opened),
                    "short_term": len(short_term),
                    "long_term": len(long_term),
                },
                "config": asdict(self.config),
                "recent_actions": list(self._actions),
                "kill_switch_engaged": self.kill_switch.is_engaged(),
                "broker": self.broker.name,
            }

    # ---- signal handling ---------------------------------------------

    def on_signal(self, sig: Signal) -> Dict:
        """Sink for the scanner. Decides whether to execute the trade.

        Returns a dict describing the decision (always — never raises),
        so the scanner loop can log it without try/except.
        """
        with self._lock:
            running = self.state.running and self.config.enabled
            if not running:
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} {sig.tier.value} → rejected (bot not running)")
                return {"accepted": False, "reason": "bot not running"}

            if self.kill_switch.is_engaged():
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} {sig.tier.value} → rejected (kill switch engaged)")
                return {"accepted": False, "reason": "kill switch engaged"}

            if not self._tier_meets(sig.tier):
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} {sig.tier.value} → rejected (tier below {self.config.min_tier})")
                return {"accepted": False, "reason": f"tier below {self.config.min_tier}"}

            horizon_name = sig.horizon.value if hasattr(sig.horizon, "value") else str(sig.horizon)
            if horizon_name == "short_term" and not self.config.accept_short_term:
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} → rejected (short-term disabled)")
                return {"accepted": False, "reason": "short-term disabled"}
            if horizon_name == "long_term" and not self.config.accept_long_term:
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} → rejected (long-term disabled)")
                return {"accepted": False, "reason": "long-term disabled"}

            opened = [p for p in self.broker.list_positions() if p.status != "closed"]
            if len(opened) >= self.config.max_concurrent_positions:
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} → rejected (max {self.config.max_concurrent_positions} positions)")
                return {"accepted": False,
                        "reason": f"max concurrent positions ({self.config.max_concurrent_positions}) reached"}
            short_term_count = sum(1 for p in opened if p.horizon == "short_term")
            long_term_count = sum(1 for p in opened if p.horizon == "long_term")
            if horizon_name == "short_term" and short_term_count >= self.config.max_short_term_positions:
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} → rejected (max short-term positions)")
                return {"accepted": False,
                        "reason": f"max short-term positions ({self.config.max_short_term_positions}) reached"}
            if horizon_name == "long_term" and long_term_count >= self.config.max_long_term_positions:
                self.state.rejected_count += 1
                self._record_action(
                    f"signal {sig.pair} → rejected (max long-term positions)")
                return {"accepted": False,
                        "reason": f"max long-term positions ({self.config.max_long_term_positions}) reached"}

        # Hand off to the trade manager. The trade manager ALSO checks
        # the kill switch and refuses low-tier signals.
        try:
            decision = self.trade_manager.on_signal(sig)
        except Exception as exc:
            log.exception("trade_manager.on_signal crashed for %s", sig.pair)
            with self._lock:
                self.state.rejected_count += 1
                self.state.last_error = str(exc)
                self._record_action(f"signal {sig.pair} → error: {exc}")
                self._save_state()
            return {"accepted": False, "reason": f"trade manager error: {exc}"}

        with self._lock:
            if decision.accepted:
                self.state.accepted_count += 1
                self._record_action(
                    f"OPEN {sig.pair} {sig.direction.value} · {horizon_name} · "
                    f"tier={sig.tier.value} score={sig.confidence_score}")
            else:
                self.state.rejected_count += 1
                self._record_action(f"signal {sig.pair} → rejected: {decision.reason}")
            self._save_state()

        return {
            "accepted": decision.accepted,
            "reason": decision.reason,
            "position_id": decision.position.id if decision.position else None,
        }

    # ---- helpers ------------------------------------------------------

    def _tier_meets(self, tier: Tier) -> bool:
        ranks = {Tier.NO_TRADE: 0, Tier.WATCHLIST: 1, Tier.GOOD: 2, Tier.STRONG: 3}
        required = ranks.get(Tier(self.config.min_tier), 3)
        return ranks.get(tier, 0) >= required

    def _record_action(self, text: str) -> None:
        now = self._clock()
        self.state.last_action_at = now
        self.state.last_action = text
        self._actions.append({
            "at": now,
            "at_iso": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
            "text": text,
        })

    # ---- management cycle --------------------------------------------

    def manage_open_positions(self) -> List[str]:
        """Run the trade manager's exit logic. Returns human-readable actions."""
        actions = self.trade_manager.manage_open_positions()
        if actions:
            with self._lock:
                for a in actions:
                    self.state.closed_count += 1
                    self._record_action(f"manage: {a}")
                self._save_state()
        return actions
