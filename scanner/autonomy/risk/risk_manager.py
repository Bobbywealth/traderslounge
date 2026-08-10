"""
Risk Manager for Confluence X.

Consumes account state + setup + news risk + data quality + current portfolio
and returns APPROVED or REJECTED with structured reasons.

Rules (evaluated in order — first rejection wins):
1.  Setup must have valid entry, stop, and at least TP1
2.  Score must meet minimum threshold
3.  News risk must not be BLOCKED or POST_NEWS
4.  Data quality must be healthy (not stale or degraded)
5.  No opposing position on the same symbol
6.  Max concurrent open positions not exceeded
7.  Max risk-per-trade (percent of account equity) not exceeded
8.  Max daily drawdown not exceeded
9.  Minimum R:R (net of costs) must be met
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class RiskDecision(Enum):
    APPROVED = 'approved'
    REJECTED = 'rejected'
    REDUCED = 'reduced'


@dataclass
class RiskConfig:
    """Risk management configuration."""
    max_concurrent_positions: int = 3
    max_risk_per_trade_pct: float = 1.0   # percent of equity
    max_daily_drawdown_pct: float = 3.0   # percent of equity
    minimum_rr: float = 2.0               # net R:R
    minimum_score: int = 50
    allow_opposing_positions: bool = False


@dataclass
class RiskAssessment:
    """Result of a risk evaluation."""
    decision: RiskDecision
    reasons: List[str] = field(default_factory=list)
    risk_per_trade_pct: float = 0.0
    position_size_lots: float = 0.0
    approved_at: Optional[float] = None

    @property
    def approved(self) -> bool:
        return self.decision == RiskDecision.APPROVED

    @property
    def reduced(self) -> bool:
        return self.decision == RiskDecision.REDUCED

    def to_dict(self) -> dict:
        return {
            'decision': self.decision.value,
            'reasons': self.reasons,
            'risk_per_trade_pct': self.risk_per_trade_pct,
            'position_size_lots': self.position_size_lots,
            'approved_at': self.approved_at,
        }


@dataclass
class PositionInfo:
    """Lightweight representation of an open position for risk checks."""
    position_id: str
    symbol: str
    direction: str  # BUY or SELL
    entry_price: float = 0.0
    stop_loss: float = 0.0
    quantity: float = 0.0
    unrealized_pnl: float = 0.0


class RiskManager:
    """
    Risk Manager.

    Stateless evaluator: every call receives full context and returns a
    fresh assessment.  No internal position tracking — the caller passes
    the current portfolio snapshot.
    """

    def __init__(self, config: Optional[RiskConfig] = None):
        self.config = config or RiskConfig()
        # Track daily P&L for drawdown limit
        self._daily_realized_pnl: float = 0.0
        self._daily_reset_date: str = ''

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def evaluate(
        self,
        setup_symbol: str,
        setup_direction: str,
        setup_score: int,
        setup_entry: float,
        setup_stop: float,
        setup_tp1: float,
        setup_net_rr: float = 0.0,
        # Account
        account_equity: float = 10000.0,
        account_balance: float = 10000.0,
        # News
        news_status: str = 'CLEAR',
        # Data quality
        data_quality_status: str = 'healthy',
        # Portfolio
        open_positions: Optional[List[PositionInfo]] = None,
        daily_realized_pnl: float = 0.0,
    ) -> RiskAssessment:
        """
        Evaluate whether a setup should be executed.

        Returns RiskAssessment with APPROVED or REJECTED.
        """
        open_positions = open_positions or []
        reasons: List[str] = []

        # 1. Valid trade levels
        if not setup_entry or setup_entry <= 0:
            reasons.append('No valid entry price')
        if not setup_stop or setup_stop <= 0:
            reasons.append('No valid stop loss')
        if not setup_tp1 or setup_tp1 <= 0:
            reasons.append('No valid TP1')

        # 2. Score threshold
        if setup_score < self.config.minimum_score:
            reasons.append(f'Score {setup_score}/100 below minimum {self.config.minimum_score}')

        # 3. News gate
        news_upper = (news_status or '').upper()
        if news_upper in ('BLOCKED', 'POST_NEWS'):
            reasons.append(f'News risk {news_status} — entry blocked')

        # 4. Data quality
        dq = (data_quality_status or '').lower()
        if dq in ('stale', 'degraded', 'insufficient', 'unavailable'):
            reasons.append(f'Data quality {data_quality_status} — cannot trust signals')

        # 5. Opposing position
        if not self.config.allow_opposing_positions:
            for pos in open_positions:
                if pos.symbol == setup_symbol and pos.direction != setup_direction:
                    reasons.append(f'Opposing {pos.direction} position already open on {setup_symbol}')
                    break

        # 6. Max concurrent positions
        if len(open_positions) >= self.config.max_concurrent_positions:
            reasons.append(f'Max {self.config.max_concurrent_positions} concurrent positions reached ({len(open_positions)} open)')

        # 7. Risk per trade
        equity = max(account_equity, 1.0)
        if setup_entry and setup_stop and setup_stop != setup_entry:
            risk_distance = abs(setup_entry - setup_stop)
            risk_pct = (risk_distance / setup_entry) * 100
            if risk_pct > self.config.max_risk_per_trade_pct:
                reasons.append(f'Risk {risk_pct:.2f}% exceeds max {self.config.max_risk_per_trade_pct}% per trade')

        # 8. Daily drawdown
        daily_dd = (daily_realized_pnl / equity) * 100 if equity else 0
        if daily_dd < -self.config.max_daily_drawdown_pct:
            reasons.append(f'Daily drawdown {daily_dd:.1f}% exceeds limit -{self.config.max_daily_drawdown_pct}%')

        # 9. Minimum R:R
        if setup_net_rr > 0 and setup_net_rr < self.config.minimum_rr:
            reasons.append(f'Net R:R {setup_net_rr:.2f}R below minimum {self.config.minimum_rr}R')

        # Decision
        if reasons:
            log.info("Risk REJECTED %s %s: %s", setup_symbol, setup_direction, '; '.join(reasons))
            return RiskAssessment(
                decision=RiskDecision.REJECTED,
                reasons=reasons,
            )

        # Approved — calculate position size
        risk_amount = equity * (self.config.max_risk_per_trade_pct / 100)
        risk_distance = abs(setup_entry - setup_stop) if setup_stop and setup_entry else 1.0
        position_size = risk_amount / risk_distance if risk_distance > 0 else 0.0

        log.info("Risk APPROVED %s %s (size=%.2f, risk=%.2f%%)",
                setup_symbol, setup_direction, position_size, self.config.max_risk_per_trade_pct)

        return RiskAssessment(
            decision=RiskDecision.APPROVED,
            risk_per_trade_pct=self.config.max_risk_per_trade_pct,
            position_size_lots=position_size,
            approved_at=time.time(),
        )
