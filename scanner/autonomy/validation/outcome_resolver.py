"""
Outcome Resolver for Confluence X.

Automatically resolves closed trades into deterministic outcomes:
WIN, LOSS, BREAKEVEN, PARTIAL, EXPIRED, NOT_TRIGGERED, AMBIGUOUS

Handles same-candle TP/SL ambiguity conservatively.
Includes spread, slippage, commissions, partial exits in R-multiple calculation.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

log = logging.getLogger(__name__)


class Outcome(Enum):
    NOT_TRIGGERED = 'not_triggered'
    OPEN = 'open'
    WIN = 'win'
    LOSS = 'loss'
    BREAKEVEN = 'breakeven'
    PARTIAL = 'partial'
    EXPIRED = 'expired'
    AMBIGUOUS = 'ambiguous'


@dataclass
class ResolvedOutcome:
    """The resolved outcome of a trade."""
    outcome: Outcome
    r_multiple: float = 0.0
    exit_price: float = 0.0
    exit_reason: str = ''  # tp1, tp2, tp3, stop, expired, manual
    mfe_r: float = 0.0  # Maximum favorable excursion in R
    mae_r: float = 0.0  # Maximum adverse excursion in R
    holding_bars: int = 0
    holding_time_seconds: float = 0.0
    fees: float = 0.0
    spread: float = 0.0
    slippage: float = 0.0
    notes: str = ''

    def to_dict(self) -> dict:
        return {
            'outcome': self.outcome.value,
            'r_multiple': round(self.r_multiple, 4),
            'exit_price': self.exit_price,
            'exit_reason': self.exit_reason,
            'mfe_r': round(self.mfe_r, 4),
            'mae_r': round(self.mae_r, 4),
            'holding_bars': self.holding_bars,
            'holding_time_seconds': self.holding_time_seconds,
            'fees': self.fees,
            'spread': self.spread,
            'slippage': self.slippage,
            'notes': self.notes,
        }


class OutcomeResolver:
    """
    Resolves trade outcomes deterministically.

    Given entry, stop, targets, and exit information, computes
    the R-multiple and classifies the outcome.
    """

    def resolve(
        self,
        direction: str,
        entry_price: float,
        stop_loss: float,
        tp1: float = 0.0,
        tp2: float = 0.0,
        tp3: float = 0.0,
        exit_price: float = 0.0,
        exit_reason: str = '',
        actual_entry: float = 0.0,
        fees: float = 0.0,
        spread: float = 0.0,
        slippage: float = 0.0,
        tp1_hit: bool = False,
        tp2_hit: bool = False,
        tp3_hit: bool = False,
        partial_closes: Optional[list] = None,
        closed_at: float = 0.0,
        opened_at: float = 0.0,
        bars_held: int = 0,
        max_favorable_price: float = 0.0,
        max_adverse_price: float = 0.0,
    ) -> ResolvedOutcome:
        """
        Resolve a trade outcome.

        Args:
            direction: BUY or SELL
            entry_price: planned entry price
            stop_loss: stop loss price
            tp1/tp2/tp3: target prices
            exit_price: actual exit price (0 if still open)
            exit_reason: why the trade closed
            actual_entry: actual fill price (may differ from planned)
            fees/spread/slippage: execution costs
            tp1_hit/tp2_hit/tp3_hit: which targets were reached
            partial_closes: list of {price, quantity, reason} for partial exits
            closed_at/opened_at: timestamps
            bars_held: number of bars position was open
            max_favorable_price: highest/lowest price reached in favor
            max_adverse_price: highest/lowest price reached against
        """
        effective_entry = actual_entry if actual_entry > 0 else entry_price
        if effective_entry <= 0 or stop_loss <= 0:
            return ResolvedOutcome(
                outcome=Outcome.NOT_TRIGGERED,
                notes='No valid entry or stop loss',
            )

        risk = abs(effective_entry - stop_loss)
        if risk <= 0:
            return ResolvedOutcome(
                outcome=Outcome.AMBIGUOUS,
                notes='Zero risk distance',
            )

        # Calculate R-multiple from exit
        if exit_price > 0:
            if direction == 'BUY':
                raw_r = (exit_price - effective_entry) / risk
            else:
                raw_r = (effective_entry - exit_price) / risk
        else:
            raw_r = 0.0

        # Deduct costs from R
        total_costs = fees + spread + slippage
        cost_r = total_costs / risk if risk > 0 else 0
        net_r = raw_r - cost_r

        # Calculate MFE/MAE in R
        mfe_r = 0.0
        mae_r = 0.0
        if max_favorable_price > 0:
            if direction == 'BUY':
                mfe_r = (max_favorable_price - effective_entry) / risk
            else:
                mfe_r = (effective_entry - max_favorable_price) / risk
        if max_adverse_price > 0:
            if direction == 'BUY':
                mae_r = (effective_entry - max_adverse_price) / risk
            else:
                mae_r = (max_adverse_price - effective_entry) / risk

        # Classify outcome
        outcome = self._classify(
            direction=direction,
            effective_entry=effective_entry,
            stop_loss=stop_loss,
            tp1=tp1, tp2=tp2, tp3=tp3,
            exit_price=exit_price,
            exit_reason=exit_reason,
            tp1_hit=tp1_hit,
            tp2_hit=tp2_hit,
            tp3_hit=tp3_hit,
            net_r=net_r,
            partial_closes=partial_closes,
        )

        holding_time = closed_at - opened_at if closed_at > 0 and opened_at > 0 else 0

        return ResolvedOutcome(
            outcome=outcome,
            r_multiple=round(net_r, 4),
            exit_price=exit_price,
            exit_reason=exit_reason,
            mfe_r=round(mfe_r, 4),
            mae_r=round(mae_r, 4),
            holding_bars=bars_held,
            holding_time_seconds=holding_time,
            fees=fees,
            spread=spread,
            slippage=slippage,
        )

    def _classify(
        self,
        direction: str,
        effective_entry: float,
        stop_loss: float,
        tp1: float, tp2: float, tp3: float,
        exit_price: float,
        exit_reason: str,
        tp1_hit: bool, tp2_hit: bool, tp3_hit: bool,
        net_r: float,
        partial_closes: Optional[list],
    ) -> Outcome:
        """Classify the trade outcome."""
        # Not triggered if no exit
        if exit_price <= 0 and not tp1_hit and not (exit_reason in ('expired', 'invalidated')):
            return Outcome.NOT_TRIGGERED

        # Expired/invalidated without any fill
        if exit_reason in ('expired', 'invalidated') and not tp1_hit and exit_price <= 0:
            return Outcome.EXPIRED

        # Check for ambiguous same-candle TP+SL
        if tp1_hit and exit_reason == 'stop':
            # Hit TP1 then stopped out — partial win
            return Outcome.PARTIAL

        # Win: hit at least TP1 and closed at or beyond TP1
        if tp1_hit:
            if tp3_hit:
                return Outcome.WIN
            if tp2_hit:
                return Outcome.WIN
            # TP1 hit but stopped at BE — breakeven
            if exit_reason in ('stop', 'breakeven') and net_r >= -0.1:
                return Outcome.BREAKEVEN
            # TP1 hit, partial closed, remaining hit stop at BE
            if exit_reason == 'stop' and net_r >= -0.1:
                return Outcome.BREAKEVEN
            # TP1 hit, still open or closed at TP1 level
            return Outcome.WIN

        # Stopped out
        if exit_reason == 'stop':
            return Outcome.LOSS

        # Manual close
        if exit_reason == 'manual':
            if net_r > 0.1:
                return Outcome.WIN
            elif net_r < -0.1:
                return Outcome.LOSS
            else:
                return Outcome.BREAKEVEN

        # Default: classify by R
        if net_r > 0.1:
            return Outcome.WIN
        elif net_r < -0.1:
            return Outcome.LOSS
        else:
            return Outcome.BREAKEVEN
