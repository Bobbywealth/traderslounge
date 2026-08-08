"""
Confluence X Autonomous Trading Desk

Phase A: Foundation + Phase B: Intelligence

This module implements the autonomous intelligence layer for Confluence X.
It provides:
- Autonomy configuration and status
- Market Watcher (data collection, normalization, quality)
- Session Intelligence (session detection, briefs)
- Setup Lifecycle (persistent setup tracking)
- Autonomous Scanner (opportunity detection, ranking)
- News Intelligence (economic calendar, news risk)
- Market Regime (trend classification)
- Intelligent Alerts (deduplication, preferences)

No broker execution is performed in this phase.
"""
from .config import AutonomyConfig, AutonomyMode, get_autonomy_config
from .status import AutonomyStatus, get_autonomy_status
from .market import MarketWatcher, DataQualityEngine
from .sessions import SessionEngine
from .setup import SetupLifecycle
from .scanner import AutonomousScanner
from .news import NewsEngine
from .regime import RegimeEngine
from .alerts import AlertEngine

__all__ = [
    # Config & Status
    'AutonomyConfig',
    'AutonomyMode',
    'get_autonomy_config',
    'AutonomyStatus',
    'get_autonomy_status',
    # Market
    'MarketWatcher',
    'DataQualityEngine',
    # Sessions
    'SessionEngine',
    # Setup
    'SetupLifecycle',
    # Scanner
    'AutonomousScanner',
    # News
    'NewsEngine',
    # Regime
    'RegimeEngine',
    # Alerts
    'AlertEngine',
]
