"""Trade manager — opens trades from signals, manages exits.

Responsibilities (spec §6):
- Receive STRONG signals from the scanner
- Run them through the risk manager to compute lot size
- Place market orders via the broker (unless kill switch is engaged)
- Watch open positions: when current price reaches TP1, close 50% and
  move SL to break-even; let TP2 and TP3 run.

The price oracle is injected so the same code is paper- and live-tradeable.
In production the trade manager will poll the data provider for fresh
prices; tests inject a synthetic oracle.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from .broker import Broker, Position
from .data_types import Direction
from .kill_switch import KillSwitch
from .risk_manager import RiskManager, TradePlan, TradeRejection
from .signal import Signal, Tier

log = logging.getLogger(__name__)

# Caller-supplied: given a pair, return the latest mid price.
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
    # Only act on signals at or above this tier
    min_tier_to_execute: Tier = Tier.STRONG
    # Once price hits TP1, close this fraction and trail SL to entry
    partial_close_fraction: float = 0.5
    # Track which positions have already taken their TP1 partial so we
    # don't double-close.
    _tp1_taken: set = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self._tp1_taken is None:
            self._tp1_taken = set()

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
        return ExecutionDecision(True, "Order placed", position=pos)

    # ---- management ---------------------------------------------------

    def manage_open_positions(self) -> List[str]:
        """Check every open position against the price oracle and act on
        TP1 hits. Returns a list of human-readable actions taken."""
        actions: List[str] = []
        for pos in self.broker.list_positions():
            price = self.price_oracle(pos.pair)
            if price is None:
                continue
            if self._hit_tp1(pos, price) and pos.id not in self._tp1_taken:
                try:
                    self.broker.close_position(pos.id, self.partial_close_fraction)
                    self.broker.modify_stop_loss(pos.id, pos.entry)
                    self._tp1_taken.add(pos.id)
                    actions.append(f"{pos.id}: TP1 hit @ {price}, "
                                   f"closed {self.partial_close_fraction*100:.0f}%, "
                                   f"SL→BE")
                except Exception as exc:
                    log.exception("manage error for %s", pos.id)
                    actions.append(f"{pos.id}: ERROR {exc}")
        return actions

    @staticmethod
    def _hit_tp1(pos: Position, price: float) -> bool:
        if pos.direction == Direction.BUY:
            return price >= pos.tp1
        return price <= pos.tp1


_TIER_RANK = {Tier.NO_TRADE: 0, Tier.WATCHLIST: 1, Tier.GOOD: 2, Tier.STRONG: 3}


def _tier_meets(actual: Tier, required: Tier) -> bool:
    return _TIER_RANK[actual] >= _TIER_RANK[required]
