"""
AI Intelligence Layer for Confluence X.

Provides human-readable explanations, summaries, and conversational assistance.

IMPORTANT: AI is used for EXPLANATION only, not for:
- Lot-size calculations
- Stop loss calculations
- Account balances
- Position reconciliation
- Order execution
- Risk caps
- Indicator calculations

All deterministic trading logic remains in code.
"""
from .ai_engine import AIEngine, AIResponse

__all__ = [
    'AIEngine',
    'AIResponse',
]
