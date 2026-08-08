"""
News & Macroeconomic Intelligence Engine for Confluence X.

Provides:
- Economic calendar integration
- News risk assessment
- Event impact analysis
- Trading gate decisions
"""
from .news_engine import NewsEngine, EconomicEvent, NewsRiskStatus

__all__ = [
    'NewsEngine',
    'EconomicEvent',
    'NewsRiskStatus',
]
