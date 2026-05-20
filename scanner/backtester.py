"""Historical backtester.

Walks one pair's OHLCV history forward bar-by-bar, scoring every
`stride` bars on the LTF and simulating trade outcomes against the
spec §6 exit rules:

    - Entry: at the next bar's open after a STRONG signal
    - SL hit → full close (loss = -risk_usd)
    - TP1 hit → close half, move SL to break-even, continue tracking
    - TP2 hit (after TP1) → close the remaining half at TP2
    - SL hit after TP1 → close remaining at break-even (0 net)

Reports win rate, average R:R realized, gross profit/loss, profit
factor, and max drawdown. No external dependencies.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

from .data_types import Candle, Direction, MarketSnapshot, Tier
from .risk_manager import (
    PIP_VALUE_PER_LOT_USD,
    RiskManager,
    TradePlan,
    TradeRejection,
    pip_size_for,
)
from .scoring_engine import score
from .signal import Signal

log = logging.getLogger(__name__)


@dataclass
class ClosedTrade:
    pair: str
    direction: Direction
    entry_index: int
    exit_index: int
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    lot_size: float
    sl_pips: float
    pnl_usd: float
    r_multiple: float        # P&L expressed in R (risk units)
    outcome: str             # "tp2", "tp1_then_be", "tp1_then_sl", "sl", "open_at_end"


@dataclass
class BacktestResult:
    pair: str
    bars_processed: int
    signals_generated: int      # count of STRONG-tier scores
    trades_taken: int           # signals that survived risk manager
    trades: List[ClosedTrade] = field(default_factory=list)
    starting_balance: float = 10_000.0
    ending_balance: float = 10_000.0

    @property
    def wins(self) -> int:
        return sum(1 for t in self.trades if t.pnl_usd > 0)

    @property
    def losses(self) -> int:
        return sum(1 for t in self.trades if t.pnl_usd < 0)

    @property
    def breakevens(self) -> int:
        return sum(1 for t in self.trades if t.pnl_usd == 0)

    @property
    def win_rate(self) -> float:
        closed = self.wins + self.losses
        return self.wins / closed if closed else 0.0

    @property
    def gross_profit(self) -> float:
        return sum(t.pnl_usd for t in self.trades if t.pnl_usd > 0)

    @property
    def gross_loss(self) -> float:
        return abs(sum(t.pnl_usd for t in self.trades if t.pnl_usd < 0))

    @property
    def profit_factor(self) -> float:
        if self.gross_loss == 0:
            return float("inf") if self.gross_profit > 0 else 0.0
        return self.gross_profit / self.gross_loss

    @property
    def total_return_pct(self) -> float:
        if self.starting_balance == 0:
            return 0.0
        return (self.ending_balance / self.starting_balance - 1) * 100

    @property
    def avg_r_multiple(self) -> float:
        if not self.trades:
            return 0.0
        return sum(t.r_multiple for t in self.trades) / len(self.trades)

    @property
    def max_drawdown_pct(self) -> float:
        balance = self.starting_balance
        peak = balance
        max_dd = 0.0
        for t in self.trades:
            balance += t.pnl_usd
            peak = max(peak, balance)
            dd = (peak - balance) / peak * 100 if peak > 0 else 0
            max_dd = max(max_dd, dd)
        return max_dd

    def summary(self) -> str:
        return (
            f"Backtest: {self.pair}\n"
            f"  Bars processed:    {self.bars_processed}\n"
            f"  STRONG signals:    {self.signals_generated}\n"
            f"  Trades taken:      {self.trades_taken}\n"
            f"  Wins / Losses / BE: {self.wins} / {self.losses} / {self.breakevens}\n"
            f"  Win rate:          {self.win_rate * 100:.1f}%\n"
            f"  Avg R multiple:    {self.avg_r_multiple:+.2f}R\n"
            f"  Gross profit:      ${self.gross_profit:,.2f}\n"
            f"  Gross loss:        ${self.gross_loss:,.2f}\n"
            f"  Profit factor:     {self.profit_factor:.2f}\n"
            f"  Max drawdown:      {self.max_drawdown_pct:.1f}%\n"
            f"  Total return:      {self.total_return_pct:+.1f}% "
            f"(${self.starting_balance:,.0f} → ${self.ending_balance:,.2f})"
        )


@dataclass
class _OpenTrade:
    plan: TradePlan
    entry_index: int
    half_closed: bool = False  # True once TP1 has triggered the partial close
    risk_usd: float = 0.0      # USD amount at risk if SL hits


def run_backtest(
    pair: str,
    d1: List[Candle],
    h4: List[Candle],
    h1: List[Candle],
    m15: List[Candle],
    starting_balance_usd: float = 10_000.0,
    risk_per_trade_pct: float = 0.5,
    min_warmup_bars: int = 220,  # need ≥200 LTF bars for EMA200 in HTF bias
    stride: int = 4,             # score every Nth LTF bar (4 = hourly on M15)
) -> BacktestResult:
    """Replay history bar-by-bar and simulate trades.

    Assumes the input candles are time-aligned at the end (i.e., the
    most recent bar in each timeframe corresponds roughly to the same
    moment in time). For correct walk-forward, each TF's window is
    truncated to "the latest bar at or before the current M15 bar."
    To keep this simple and fast, we truncate by index ratio:
      - D1: every ~96 M15 bars
      - H4: every 16 M15 bars
      - H1: every 4 M15 bars
    This works when the input data has no gaps; real-world weekend
    gaps will introduce slight misalignment but won't change the broad
    statistics.
    """
    rm = RiskManager(risk_per_trade_pct=risk_per_trade_pct)
    result = BacktestResult(
        pair=pair,
        bars_processed=0,
        signals_generated=0,
        trades_taken=0,
        starting_balance=starting_balance_usd,
        ending_balance=starting_balance_usd,
    )
    balance = starting_balance_usd
    open_trade: Optional[_OpenTrade] = None

    # M15 is the LTF the spec scores against; everything else is derived
    # by index ratio (24h/15min = 96, 4h/15min = 16, 1h/15min = 4).
    n = len(m15)
    if n < min_warmup_bars + 2:
        log.warning("not enough M15 bars: %d < %d (warmup) — returning empty result",
                    n, min_warmup_bars + 2)
        return result

    for i in range(min_warmup_bars, n - 1):
        result.bars_processed += 1
        current_bar = m15[i]

        # ---- manage an open trade --------------------------------------
        if open_trade is not None:
            outcome = _check_exit(open_trade, current_bar)
            if outcome is not None:
                closed = _close_trade(open_trade, i, outcome, current_bar)
                result.trades.append(closed)
                balance += closed.pnl_usd
                open_trade = None
                # Don't open a new trade on the same bar
                continue

        # ---- look for a new entry --------------------------------------
        if open_trade is not None:
            continue
        if (i - min_warmup_bars) % stride != 0:
            continue

        snap = MarketSnapshot(
            pair=pair,
            d1=d1[:max(1, (i // 96) + 1)] if d1 else [],
            h4=h4[:max(1, (i // 16) + 1)] if h4 else [],
            h1=h1[:max(1, (i // 4) + 1)] if h1 else [],
            m15=m15[: i + 1],
        )
        sig = score(snap)
        if sig.tier != Tier.STRONG:
            continue
        result.signals_generated += 1

        plan = rm.plan_trade(sig, balance)
        if isinstance(plan, TradeRejection):
            continue
        result.trades_taken += 1

        # Enter at the next bar's open (no look-ahead).
        next_bar = m15[i + 1]
        entry_price = next_bar.open
        # Rebuild plan around the actual fill price so SL/TP distances stay
        # consistent (preserves R:R as scored).
        adjusted_plan = _retarget_plan(plan, entry_price)
        open_trade = _OpenTrade(
            plan=adjusted_plan,
            entry_index=i + 1,
            risk_usd=balance * risk_per_trade_pct / 100,
        )

    # Force-close any still-open trade at the final bar
    if open_trade is not None:
        last = m15[-1]
        closed = _close_trade(open_trade, n - 1, "open_at_end", last,
                              forced_price=last.close)
        result.trades.append(closed)
        balance += closed.pnl_usd

    result.ending_balance = balance
    return result


def _retarget_plan(plan: TradePlan, new_entry: float) -> TradePlan:
    """Shift the plan to a different entry price, preserving the
    SL/TP distances (so the R:R stays the same)."""
    if plan.direction == Direction.BUY:
        return TradePlan(
            pair=plan.pair, direction=plan.direction,
            entry=new_entry,
            stop_loss=new_entry - (plan.entry - plan.stop_loss),
            tp1=new_entry + (plan.tp1 - plan.entry),
            tp2=new_entry + (plan.tp2 - plan.entry),
            tp3=new_entry + (plan.tp3 - plan.entry),
            lot_size=plan.lot_size, risk_usd=plan.risk_usd,
            sl_pips=plan.sl_pips, rr_to_tp1=plan.rr_to_tp1, rr_to_tp2=plan.rr_to_tp2,
        )
    return TradePlan(
        pair=plan.pair, direction=plan.direction,
        entry=new_entry,
        stop_loss=new_entry + (plan.stop_loss - plan.entry),
        tp1=new_entry - (plan.entry - plan.tp1),
        tp2=new_entry - (plan.entry - plan.tp2),
        tp3=new_entry - (plan.entry - plan.tp3),
        lot_size=plan.lot_size, risk_usd=plan.risk_usd,
        sl_pips=plan.sl_pips, rr_to_tp1=plan.rr_to_tp1, rr_to_tp2=plan.rr_to_tp2,
    )


def _check_exit(t: _OpenTrade, bar: Candle) -> Optional[str]:
    """Return the exit outcome label if this bar hits SL/TP, else None.

    Conservative ordering: if both SL and TP touch within one bar, treat
    SL as hit first (assumes worst case — we can't tell from OHLC which
    came first intra-bar).
    """
    plan = t.plan
    if plan.direction == Direction.BUY:
        sl_hit = bar.low <= plan.stop_loss
        tp1_hit = bar.high >= plan.tp1
        tp2_hit = bar.high >= plan.tp2
    else:
        sl_hit = bar.high >= plan.stop_loss
        tp1_hit = bar.low <= plan.tp1
        tp2_hit = bar.low <= plan.tp2

    if t.half_closed:
        # SL is at break-even now; TP2 closes the rest
        if sl_hit:
            return "tp1_then_be"
        if tp2_hit:
            return "tp2"
        return None
    # First half: SL or TP1
    if sl_hit:
        return "sl"
    if tp1_hit:
        t.half_closed = True
        # Trail SL to entry on the next bar's check; for this bar, also
        # check if TP2 came within reach (unlikely but possible).
        # Override SL to entry now so subsequent checks treat it as BE.
        t.plan = _retarget_sl_to_entry(t.plan)
        if tp2_hit:
            return "tp2"
        return None
    return None


def _retarget_sl_to_entry(plan: TradePlan) -> TradePlan:
    return TradePlan(
        pair=plan.pair, direction=plan.direction,
        entry=plan.entry, stop_loss=plan.entry,
        tp1=plan.tp1, tp2=plan.tp2, tp3=plan.tp3,
        lot_size=plan.lot_size, risk_usd=plan.risk_usd,
        sl_pips=plan.sl_pips, rr_to_tp1=plan.rr_to_tp1, rr_to_tp2=plan.rr_to_tp2,
    )


def _close_trade(t: _OpenTrade, exit_index: int, outcome: str, bar: Candle,
                 forced_price: Optional[float] = None) -> ClosedTrade:
    pair = t.plan.pair
    pip_v = PIP_VALUE_PER_LOT_USD.get(pair, 10.0)
    pip_sz = pip_size_for(pair)
    lots = t.plan.lot_size

    def pnl_at(price: float, fraction: float = 1.0) -> float:
        diff = price - t.plan.entry
        if t.plan.direction == Direction.SELL:
            diff = -diff
        return (diff / pip_sz) * pip_v * lots * fraction

    if outcome == "sl":
        pnl = pnl_at(t.plan.stop_loss)
    elif outcome == "tp1_then_be":
        # Half closed at TP1, other half closed at break-even
        pnl = pnl_at(t.plan.tp1, fraction=0.5) + 0.0
    elif outcome == "tp1_then_sl":  # synonym, kept for clarity
        pnl = pnl_at(t.plan.tp1, fraction=0.5)
    elif outcome == "tp2":
        if t.half_closed:
            pnl = pnl_at(t.plan.tp1, fraction=0.5) + pnl_at(t.plan.tp2, fraction=0.5)
        else:
            # Hit TP2 directly without TP1? Only possible if a bar gapped
            # straight through TP1; treat as full TP2.
            pnl = pnl_at(t.plan.tp2, fraction=1.0)
    elif outcome == "open_at_end":
        price = forced_price if forced_price is not None else bar.close
        if t.half_closed:
            pnl = pnl_at(t.plan.tp1, fraction=0.5) + pnl_at(price, fraction=0.5)
        else:
            pnl = pnl_at(price, fraction=1.0)
    else:
        pnl = 0.0

    r = pnl / t.risk_usd if t.risk_usd > 0 else 0.0
    return ClosedTrade(
        pair=pair, direction=t.plan.direction,
        entry_index=t.entry_index, exit_index=exit_index,
        entry=t.plan.entry, stop_loss=t.plan.stop_loss,
        tp1=t.plan.tp1, tp2=t.plan.tp2,
        lot_size=lots, sl_pips=t.plan.sl_pips,
        pnl_usd=pnl, r_multiple=r, outcome=outcome,
    )
