"""Broker abstraction + paper-trade implementation.

The Broker protocol is what the trade manager calls. PaperBroker is the
default — it never hits the network, just records orders in memory and
simulates fills. TradeLockerBroker (in tradelocker_broker.py) implements
the same protocol against the live REST API; it is only invoked when
EXECUTION_MODE=live is set explicitly.
"""
from __future__ import annotations

import itertools
import logging
import time
from dataclasses import dataclass, field
from typing import List, Optional, Protocol

from .data_types import Direction
from .risk_manager import TradePlan

log = logging.getLogger(__name__)


@dataclass
class Position:
    id: str
    pair: str
    direction: Direction
    lot_size: float
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    tp3: float
    opened_at: float
    status: str = "open"        # open / closed / partially_closed
    closed_pnl_usd: float = 0.0  # realized P&L from any partial closes


class Broker(Protocol):
    name: str

    def place_market_order(self, plan: TradePlan) -> Position: ...
    def modify_stop_loss(self, position_id: str, new_sl: float) -> None: ...
    def close_position(self, position_id: str, fraction: float = 1.0) -> None: ...
    def list_positions(self) -> List[Position]: ...
    def get_balance(self) -> float: ...


@dataclass
class PaperBroker:
    """In-memory simulator. Never touches the network."""

    name: str = "paper"
    starting_balance_usd: float = 10_000.0
    _positions: dict = field(default_factory=dict)
    _ids = itertools.count(1)

    def place_market_order(self, plan: TradePlan) -> Position:
        pid = f"paper-{next(self._ids)}"
        pos = Position(
            id=pid,
            pair=plan.pair,
            direction=plan.direction,
            lot_size=plan.lot_size,
            entry=plan.entry,
            stop_loss=plan.stop_loss,
            tp1=plan.tp1,
            tp2=plan.tp2,
            tp3=plan.tp3,
            opened_at=time.time(),
        )
        self._positions[pid] = pos
        log.info("paper open %s %s %.2f lots @ %s SL=%s TP1=%s",
                 plan.pair, plan.direction.value, plan.lot_size, plan.entry,
                 plan.stop_loss, plan.tp1)
        return pos

    def modify_stop_loss(self, position_id: str, new_sl: float) -> None:
        pos = self._positions.get(position_id)
        if pos is None:
            raise KeyError(position_id)
        log.info("paper modify SL %s: %s → %s", position_id, pos.stop_loss, new_sl)
        pos.stop_loss = new_sl

    def close_position(self, position_id: str, fraction: float = 1.0) -> None:
        pos = self._positions.get(position_id)
        if pos is None:
            raise KeyError(position_id)
        if not 0 < fraction <= 1:
            raise ValueError("fraction must be in (0, 1]")
        if fraction >= 1.0:
            pos.status = "closed"
            log.info("paper close %s (full)", position_id)
        else:
            pos.lot_size *= (1 - fraction)
            pos.status = "partially_closed"
            log.info("paper close %s (%.0f%% partial, %.2f lots remaining)",
                     position_id, fraction * 100, pos.lot_size)

    def list_positions(self) -> List[Position]:
        return [p for p in self._positions.values() if p.status != "closed"]

    def get_balance(self) -> float:
        return self.starting_balance_usd


@dataclass
class NullBroker:
    """Used when execution is disabled entirely. All methods are no-ops."""
    name: str = "disabled"

    def place_market_order(self, plan: TradePlan) -> Position:
        raise RuntimeError("Execution is disabled (set EXECUTION_MODE=paper or live)")

    def modify_stop_loss(self, position_id: str, new_sl: float) -> None:
        pass

    def close_position(self, position_id: str, fraction: float = 1.0) -> None:
        pass

    def list_positions(self) -> List[Position]:
        return []

    def get_balance(self) -> float:
        return 0.0
