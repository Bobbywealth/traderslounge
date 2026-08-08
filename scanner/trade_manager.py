"""Trade manager — opens trades from signals, manages exits.

Responsibilities (spec §6):
- Receive STRONG signals from the scanner
- Run them through the risk manager to compute lot size
- Place market orders via the broker (unless kill switch is engaged)
- Watch open positions:
    * TP1 hit → close `partial_close_fraction` (default 50%), move SL to BE
    * TP2 hit (after TP1) → close the remaining position
    * SL hit (or BE stop after TP1) → close the position
- Persist every position state transition + every closed trade.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .broker import Broker, Position
from .data_types import Direction
from .kill_switch import KillSwitch
from .risk_manager import (
    PIP_VALUE_PER_LOT_USD,
    RiskManager,
    TradePlan,
    TradeRejection,
    pip_size_for,
)
from .signal import Signal, Tier
from .trade_repo import ClosedTradeRepository, PositionRepository

log = logging.getLogger(__name__)

PriceOracle = Callable[[str], Optional[float]]


@dataclass
class ExecutionDecision:
    accepted: bool
    reason: str
    position: Optional[Position] = None


@dataclass
class TradeManager:
    broker: Broker
    risk: RiskManager
    kill_switch: KillSwitch
    price_oracle: PriceOracle
    position_repo: Optional[PositionRepository] = None
    closed_trade_repo: Optional[ClosedTradeRepository] = None
    # Optional persistence hook for TP1 + original-sizing state. When set,
    # every TP1 / close transitions write to the repo so partial-close P&L
    # math survives a Render free-tier restart. When None, state stays in
    # the in-memory `_tp1_taken` / `_opened_state` containers (legacy
    # behaviour, used by unit tests).
    state_repo: Optional["TradeManagerStateRepository"] = None
    min_tier_to_execute: Tier = Tier.STRONG
    partial_close_fraction: float = 0.5

    _tp1_taken: set = field(default_factory=set)
    # Track original lot size + risk per position so P&L math survives the
    # TP1 lot-size halving in PaperBroker.
    _opened_state: Dict[str, dict] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Pull whatever persisted state the repo has (e.g. across a restart)
        # into the in-memory dicts so the manage-cycle sees the right TP1 +
        # sizing bookkeeping immediately.
        if self.state_repo is None:
            return
        try:
            persisted = self.state_repo.load_all()
        except Exception:
            log.exception("failed to restore trade-manager state from repo; continuing in-memory only")
            return
        for position_id, (tp1_taken, opened_state) in persisted.items():
            if tp1_taken:
                self._tp1_taken.add(position_id)
            # Drop nulls so P&L math doesn't trip on a None original_sl.
            cleaned = {k: v for k, v in (opened_state or {}).items() if v is not None}
            if cleaned:
                self._opened_state[position_id] = cleaned
        if persisted:
            log.info("restored %d trade-manager state rows from repo", len(persisted))

    # ---- entry --------------------------------------------------------

    def on_signal(self, sig: Signal) -> ExecutionDecision:
        if self.kill_switch.is_engaged():
            reason = f"Kill switch engaged: {self.kill_switch.reason()}"
            log.warning("rejecting %s — %s", sig.pair, reason)
            return ExecutionDecision(False, reason)

        if not _tier_meets(sig.tier, self.min_tier_to_execute):
            return ExecutionDecision(
                False, f"Tier {sig.tier.value} below execution threshold "
                       f"{self.min_tier_to_execute.value}"
            )

        balance = self.broker.get_balance()
        plan = self.risk.plan_trade(sig, balance)
        if isinstance(plan, TradeRejection):
            log.info("risk reject %s — %s", sig.pair, plan.reason)
            return ExecutionDecision(False, plan.reason)

        try:
            pos = self.broker.place_market_order(plan)
        except Exception as exc:
            log.exception("broker order failed for %s", sig.pair)
            return ExecutionDecision(False, f"Broker error: {exc}")

        self._opened_state[pos.id] = {
            "original_lots": plan.lot_size,
            "risk_usd": plan.risk_usd,
            "sl_pips": plan.sl_pips,
            "original_sl": pos.stop_loss,
        }
        self._persist_state(pos.id, tp1_taken=False)
        self._persist_position(pos)
        return ExecutionDecision(True, "Order placed", position=pos)

    # ---- management ---------------------------------------------------

    def manage_open_positions(self) -> List[str]:
        actions: List[str] = []
        for pos in list(self.broker.list_positions()):
            price = self.price_oracle(pos.pair)
            if price is None:
                continue
            outcome = self._evaluate_exit(pos, price)
            if outcome == "tp1":
                self._take_tp1(pos, price)
                actions.append(
                    f"{pos.id}: TP1 hit @ {price}, "
                    f"closed {self.partial_close_fraction*100:.0f}%, SL→BE"
                )
            elif outcome in ("sl", "tp1_then_be", "tp2"):
                self._close_full(pos, price, outcome)
                actions.append(f"{pos.id}: {outcome} @ {price}")
        return actions

    def _evaluate_exit(self, pos: Position, price: float) -> Optional[str]:
        already_tp1 = pos.id in self._tp1_taken
        sl_hit = price <= pos.stop_loss if pos.direction == Direction.BUY else price >= pos.stop_loss
        tp1_hit = price >= pos.tp1 if pos.direction == Direction.BUY else price <= pos.tp1
        tp2_hit = price >= pos.tp2 if pos.direction == Direction.BUY else price <= pos.tp2
        # SL takes precedence (same-bar conservatism)
        if sl_hit:
            return "tp1_then_be" if already_tp1 else "sl"
        if already_tp1 and tp2_hit:
            return "tp2"
        if not already_tp1 and tp1_hit:
            return "tp1"
        return None

    def _take_tp1(self, pos: Position, price: float) -> None:
        try:
            self.broker.close_position(pos.id, self.partial_close_fraction)
            self.broker.modify_stop_loss(pos.id, pos.entry)
            # The broker mutates pos in place (PaperBroker); for live we re-read.
            pos.stop_loss = pos.entry
            self._tp1_taken.add(pos.id)
            self._persist_state(pos.id, tp1_taken=True)
            self._persist_position(pos)
        except Exception:
            log.exception("TP1 management failed for %s", pos.id)

    def _close_full(self, pos: Position, exit_price: float, outcome: str) -> None:
        try:
            self.broker.close_position(pos.id, 1.0)
        except Exception:
            log.exception("close_position failed for %s", pos.id)
            return
        # Record closed trade.
        opened = self._opened_state.pop(pos.id, None)
        original_lots = opened["original_lots"] if opened else pos.lot_size
        risk_usd = opened["risk_usd"] if opened else 0.0
        sl_pips = opened["sl_pips"] if opened else 0.0
        original_sl = opened["original_sl"] if opened else pos.stop_loss
        pnl = self._calc_pnl(pos, original_lots, original_sl, exit_price, outcome)
        r = pnl / risk_usd if risk_usd > 0 else 0.0
        record = {
            "position_id": pos.id,
            "pair": pos.pair,
            "direction": pos.direction.value,
            "opened_at": pos.opened_at,
            "closed_at": time.time(),
            "entry": pos.entry,
            "exit_price": exit_price,
            "stop_loss": original_sl,
            "tp1": pos.tp1,
            "tp2": pos.tp2,
            "lot_size": original_lots,
            "sl_pips": sl_pips,
            "pnl_usd": pnl,
            "r_multiple": r,
            "outcome": outcome,
        }
        if self.closed_trade_repo is not None:
            try:
                self.closed_trade_repo.save(record)
            except Exception:
                log.exception("closed_trade save failed for %s", pos.id)
        if self.position_repo is not None:
            try:
                self.position_repo.close(pos.id, record["closed_at"])
            except Exception:
                log.exception("position close-mark failed for %s", pos.id)
        self._tp1_taken.discard(pos.id)
        # Drop the row from the persisted state map so a stale TP1 row
        # can't resurrect on the next restart after the position is closed.
        self._persist_clear(pos.id)

    # ---- helpers ------------------------------------------------------

    def _persist_position(self, pos: Position) -> None:
        if self.position_repo is None:
            return
        try:
            self.position_repo.upsert(pos)
        except Exception:
            log.exception("position upsert failed for %s", pos.id)

    def _persist_state(self, position_id: str, tp1_taken: bool) -> None:
        if self.state_repo is None:
            return
        opened = self._opened_state.get(position_id, {})
        try:
            self.state_repo.upsert_state(position_id, tp1_taken, opened)
        except Exception:
            log.exception("trade-manager state upsert failed for %s", position_id)

    def _persist_clear(self, position_id: str) -> None:
        if self.state_repo is None:
            return
        try:
            self.state_repo.clear_state(position_id)
        except Exception:
            log.exception("trade-manager state clear failed for %s", position_id)

    def _calc_pnl(
        self, pos: Position, original_lots: float, original_sl: float,
        exit_price: float, outcome: str,
    ) -> float:
        """Total P&L across the position lifecycle.

        - sl: entire `original_lots` closed at original SL.
        - tp1_then_be: half closed at TP1, other half at entry (BE).
        - tp2: half at TP1, other half at TP2.
        """
        pip_value = PIP_VALUE_PER_LOT_USD.get(pos.pair, 10.0)
        pip_size = pip_size_for(pos.pair)
        sign = 1.0 if pos.direction == Direction.BUY else -1.0

        def leg(exit_p: float, lots: float) -> float:
            diff = (exit_p - pos.entry) * sign
            return (diff / pip_size) * pip_value * lots

        if outcome == "sl":
            return leg(original_sl, original_lots)
        if outcome == "tp1_then_be":
            half = original_lots * self.partial_close_fraction
            return leg(pos.tp1, half) + leg(pos.entry, original_lots - half)
        if outcome == "tp2":
            half = original_lots * self.partial_close_fraction
            return leg(pos.tp1, half) + leg(pos.tp2, original_lots - half)
        return leg(exit_price, original_lots)


_TIER_RANK = {Tier.NO_TRADE: 0, Tier.WATCHLIST: 1, Tier.GOOD: 2, Tier.STRONG: 3}


def _tier_meets(actual: Tier, required: Tier) -> bool:
    return _TIER_RANK[actual] >= _TIER_RANK[required]
