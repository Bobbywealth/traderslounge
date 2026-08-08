"""
Session Intelligence Engine for Confluence X.

Detects trading sessions, generates session briefs, and provides
session-aware context for trading decisions.
"""
from .session_engine import SessionEngine, TradingSession, SessionBrief

__all__ = [
    'SessionEngine',
    'TradingSession',
    'SessionBrief',
]
