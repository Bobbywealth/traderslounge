"""
Trading Journal for Confluence X.

Records every setup's complete history from detection to resolution.
"""
from .trading_journal import TradingJournal, JournalEntry

__all__ = [
    'TradingJournal',
    'JournalEntry',
]
