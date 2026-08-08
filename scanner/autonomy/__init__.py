"""
Confluence X Autonomous Trading Desk

Phase A: Foundation + Phase B: Intelligence + Phase C: Monitoring + Phase D: Paper Trading + Phase E: Validation

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
- Active Setup Monitoring (state changes, invalidation)
- Trading Journal (complete setup history)
- Market Memory (persistent snapshots)
- Paper Trading (realistic simulation)
- Forward Validation (forecast recording, calibration)

No live broker execution is performed.
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
from .monitoring import SetupMonitor
from .journal import TradingJournal
from .memory import MarketMemory
from .paper import PaperBrokerAdapter, PaperPositionManager
from .validation import ForwardEngine, CalibrationAnalyzer, SegmentationAnalyzer
from .ai import AIEngine
from .broker import DemoBrokerAdapter, ReconciliationEngine
from .gates import ExecutionGates
from .websocket import WebSocketServer
from .loop import AutonomousLoop

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
    # Monitoring
    'SetupMonitor',
    # Journal
    'TradingJournal',
    # Memory
    'MarketMemory',
    # Paper Trading
    'PaperBrokerAdapter',
    'PaperPositionManager',
    # Validation
    'ForwardEngine',
    'CalibrationAnalyzer',
    'SegmentationAnalyzer',
    # AI
    'AIEngine',
    # Broker
    'DemoBrokerAdapter',
    'ReconciliationEngine',
    # Gates
    'ExecutionGates',
    # WebSocket
    'WebSocketServer',
    # Loop
    'AutonomousLoop',
]
