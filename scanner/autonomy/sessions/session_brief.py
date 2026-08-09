"""
Session Brief Generator for Confluence X.

Generates autonomous session briefs at session open/close:
- Pre-session brief: strongest setups, developing setups, blocked setups, news
- Session close report: what happened, trades taken, outcomes
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


@dataclass
class SessionBrief:
    """A generated session brief."""
    session_name: str       # london, new_york, asia, london_new_york_overlap
    brief_type: str         # pre_session, session_open, mid_session, session_close
    timestamp: float = field(default_factory=time.time)

    # Market overview
    strongest_setup: Optional[dict] = None
    developing_setups: List[dict] = field(default_factory=list)
    blocked_setups: List[dict] = field(default_factory=list)

    # News
    upcoming_news: List[dict] = field(default_factory=list)
    news_status: str = 'CLEAR'

    # Risk
    open_positions: int = 0
    open_risk_usd: float = 0.0
    daily_pnl: float = 0.0

    # Summary
    summary: str = ''

    def to_dict(self) -> dict:
        return {
            'session_name': self.session_name,
            'brief_type': self.brief_type,
            'timestamp': self.timestamp,
            'strongest_setup': self.strongest_setup,
            'developing_setups': self.developing_setups,
            'blocked_setups': self.blocked_setups,
            'upcoming_news': self.upcoming_news,
            'news_status': self.news_status,
            'open_positions': self.open_positions,
            'open_risk_usd': self.open_risk_usd,
            'daily_pnl': self.daily_pnl,
            'summary': self.summary,
        }


class SessionBriefGenerator:
    """
    Generates session briefs from current system state.
    """

    def generate_pre_session_brief(
        self,
        session_name: str,
        active_setups: list,
        upcoming_news: list = None,
        open_positions: int = 0,
        daily_pnl: float = 0.0,
    ) -> SessionBrief:
        """Generate a pre-session brief."""
        brief = SessionBrief(
            session_name=session_name,
            brief_type='pre_session',
            open_positions=open_positions,
            daily_pnl=daily_pnl,
        )

        # Classify setups
        for setup in active_setups:
            setup_dict = {
                'symbol': setup.get('symbol', ''),
                'direction': setup.get('direction', ''),
                'score': setup.get('score', 0),
                'state': setup.get('state', ''),
            }
            state = setup.get('state', '').lower()
            if state == 'ready':
                brief.strongest_setup = setup_dict
            elif state in ('detected', 'developing'):
                brief.developing_setups.append(setup_dict)
            elif state in ('watch',):
                brief.developing_setups.append(setup_dict)

        # News
        brief.upcoming_news = upcoming_news or []
        if upcoming_news:
            high_impact = [n for n in upcoming_news if n.get('impact', '').lower() in ('high', 'critical')]
            if high_impact:
                brief.news_status = 'BLOCKED'
                brief.blocked_setups = [{'symbol': n.get('affected_symbols', [''])[0],
                                         'reason': n.get('title', 'High-impact event')}
                                        for n in high_impact[:3]]

        # Generate summary text
        parts = [f"{session_name.upper()} PRE-SESSION BRIEF"]
        if brief.strongest_setup:
            s = brief.strongest_setup
            parts.append(f"Best setup: {s['symbol']} {s['direction']} (score {s['score']})")
        if brief.developing_setups:
            parts.append(f"Developing: {', '.join(s['symbol'] for s in brief.developing_setups[:3])}")
        if brief.blocked_setups:
            parts.append(f"Blocked: {', '.join(s['symbol'] for s in brief.blocked_setups[:3])}")
        if brief.news_status != 'CLEAR':
            parts.append(f"News: {brief.news_status}")
        parts.append(f"Open positions: {open_positions}")
        parts.append(f"Daily P&L: ${daily_pnl:+.2f}")
        brief.summary = '\n'.join(parts)

        return brief

    def generate_session_close_report(
        self,
        session_name: str,
        trades_taken: list = None,
        setups_detected: int = 0,
        setups_invalidated: int = 0,
        daily_pnl: float = 0.0,
    ) -> SessionBrief:
        """Generate a session close report."""
        brief = SessionBrief(
            session_name=session_name,
            brief_type='session_close',
            daily_pnl=daily_pnl,
        )

        trades = trades_taken or []
        wins = sum(1 for t in trades if t.get('outcome') == 'win')
        losses = sum(1 for t in trades if t.get('outcome') == 'loss')
        total_r = sum(t.get('r_multiple', 0) for t in trades)

        parts = [f"{session_name.upper()} SESSION CLOSE"]
        parts.append(f"Trades: {len(trades)} ({wins}W / {losses}L)")
        parts.append(f"Total R: {total_r:+.2f}R")
        parts.append(f"Setups detected: {setups_detected}")
        parts.append(f"Setups invalidated: {setups_invalidated}")
        parts.append(f"P&L: ${daily_pnl:+.2f}")
        brief.summary = '\n'.join(parts)

        return brief
