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
    portfolio_heat_limit_pct: float = 6.0  # total open risk across the portfolio
    portfolio_heat_min_reduction_pct: float = 0.1  # below this, refuse instead of REDUCED


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

        # 7b. Portfolio heat (institutional-style cluster risk)
        # Approximate current open risk as len(open_positions) *
        # max_risk_per_trade_pct — conservative upper bound; each paper
        # position was sized at the per-trade cap.  If the proposed
        # setup would push total heat past the limit, return REDUCED
        # with a shrink-to-fit size so the trader still gets the setup,
        # just smaller.  If the shrink would be below the minimum
        # reduction, REJECT instead.
        current_heat_pct = float(len(open_positions)) * float(self.config.max_risk_per_trade_pct)
        proposed_setup_risk_pct = float(risk_pct) if 'risk_pct' in dir() else 0.0
        # Recompute risk_pct when entry/stop were missing above (default 0)
        if not (setup_entry and setup_stop and setup_stop != setup_entry):
            proposed_setup_risk_pct = 0.0
        else:
            proposed_setup_risk_pct = (abs(setup_entry - setup_stop) / setup_entry) * 100.0
        projected_heat_pct = current_heat_pct + proposed_setup_risk_pct
        portfolio_heat_limit = float(self.config.portfolio_heat_limit_pct)
        portfolio_warnings: List[str] = []
        portfolio_reduce_to_pct: Optional[float] = None
        if projected_heat_pct > portfolio_heat_limit and proposed_setup_risk_pct > 0:
            available_pct = max(0.0, portfolio_heat_limit - current_heat_pct)
            if available_pct < float(self.config.portfolio_heat_min_reduction_pct):
                reasons.append(
                    f'Portfolio heat {projected_heat_pct:.2f}% exceeds limit '
                    f'{portfolio_heat_limit:.2f}% — only {available_pct:.2f}% headroom, '
                    f'below min reduction {self.config.portfolio_heat_min_reduction_pct}%'
                )
            else:
                portfolio_reduce_to_pct = available_pct
                portfolio_warnings.append(
                    f'⚠ CORRELATION RISK: portfolio heat {projected_heat_pct:.2f}% '
                    f'exceeds limit {portfolio_heat_limit:.2f}%; '
                    f'reducing setup from {proposed_setup_risk_pct:.2f}% to {available_pct:.2f}% '
                    f'to keep heat at the limit.'
                )

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

        # Portfolio heat REDUCED — proceed but shrink to fit.
        if portfolio_reduce_to_pct is not None:
            risk_amount = equity * (portfolio_reduce_to_pct / 100)
            risk_distance = abs(setup_entry - setup_stop) if setup_stop and setup_entry else 1.0
            reduced_size = risk_amount / risk_distance if risk_distance > 0 else 0.0
            log.info(
                "Risk REDUCED %s %s (heat=%.2f%%, size=%.2f, reduced_to=%.2f%%)",
                setup_symbol, setup_direction, projected_heat_pct,
                reduced_size, portfolio_reduce_to_pct,
            )
            return RiskAssessment(
                decision=RiskDecision.REDUCED,
                reasons=portfolio_warnings,
                risk_per_trade_pct=float(portfolio_reduce_to_pct),
                position_size_lots=reduced_size,
                approved_at=time.time(),
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
