"""
Autonomous Trading Loop for Confluence X.

Ties together all autonomy components into a continuous loop:
Market Watcher → Data Quality → Session → Regime → News → Scanner → Setup → Monitor → Journal
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from .config import AutonomyConfig, get_autonomy_config
from .status import AutonomyStatus, ComponentStatus, get_autonomy_status
from .market import MarketWatcher, DataQualityEngine
from .sessions import SessionEngine
from .setup import SetupLifecycle
from .scanner import AutonomousScanner
from .news import NewsEngine
from .regime import RegimeEngine
from .alerts import AlertEngine, AlertType, AlertSeverity
from .monitoring import SetupMonitor
from .journal import TradingJournal
from .memory import MarketMemory, MarketSnapshot
from .paper import PaperBrokerAdapter, PaperPositionManager
from .validation import ForwardEngine
from .ai import AIEngine

log = logging.getLogger(__name__)


class AutonomousLoop:
    """
    Autonomous Trading Loop.
    
    Continuously runs the full autonomous cycle:
    1. Update market data
    2. Check data quality
    3. Detect session
    4. Classify regime
    5. Assess news risk
    6. Scan opportunities
    7. Track setups
    8. Monitor active setups
    9. Execute paper trades (if enabled)
    10. Record outcomes
    11. Generate alerts
    """
    
    def __init__(self, config: Optional[AutonomyConfig] = None):
        self.config = config or get_autonomy_config()
        self.status = get_autonomy_status()
        
        # Initialize components
        self.market_watcher = MarketWatcher()
        self.data_quality = DataQualityEngine()
        self.session_engine = SessionEngine()
        self.setup_lifecycle = SetupLifecycle()
        self.scanner = AutonomousScanner(
            config=self.config,
            data_quality=self.data_quality,
            session_engine=self.session_engine,
            setup_lifecycle=self.setup_lifecycle,
        )
        self.news_engine = NewsEngine(
            high_impact_pre_minutes=self.config.news.high_impact_pre_event_minutes,
            high_impact_post_minutes=self.config.news.high_impact_post_event_minutes,
        )
        self.regime_engine = RegimeEngine()
        self.alert_engine = AlertEngine()
        self.setup_monitor = SetupMonitor(self.setup_lifecycle)
        self.journal = TradingJournal()
        self.memory = MarketMemory()
        self.paper_broker = PaperBrokerAdapter()
        self.position_manager = PaperPositionManager()
        self.forward_engine = ForwardEngine()
        self.ai_engine = AIEngine()
        
        # Wire callbacks
        self.scanner.register_callback(self._on_scan_complete)
        self.setup_lifecycle.register_callback(self._on_setup_event)
        self.setup_monitor.register_callback(self._on_monitor_alert)
        
        # State
        self._running = False
        self._last_scan_time = 0
        self._scan_count = 0
    
    def start(self):
        """Start the autonomous loop."""
        self._running = True
        self.status.mode = self.config.mode.value
        self.status.health.scanner = ComponentStatus.HEALTHY
        
        log.info("Autonomous loop started (mode: %s)", self.config.mode.value)
        
        # Update heartbeats
        self.status.update_heartbeat('autonomous_loop', ComponentStatus.HEALTHY, 
                                    version=self.config.engine_version)
    
    def stop(self):
        """Stop the autonomous loop."""
        self._running = False
        self.status.health.scanner = ComponentStatus.DISABLED
        log.info("Autonomous loop stopped")
    
    def run_cycle(self, market_data: dict):
        """Run one cycle of the autonomous loop."""
        if not self._running:
            return
        
        cycle_start = time.time()
        
        try:
            # 1. Update market data
            for symbol, data in market_data.items():
                if 'price' in data:
                    self.market_watcher.update_tick(symbol, data['price'])
                    self.memory.record_snapshot(MarketSnapshot(
                        symbol=symbol,
                        price=data['price'],
                    ))
            
            # 2. Check data quality
            for symbol in self.market_watcher.get_all_symbols():
                state = self.market_watcher.get_symbol_state(symbol)
                if state:
                    self.data_quality.update_tick_age(symbol, state.tick_age)
            
            # 3. Get session context
            for symbol in self.market_watcher.get_all_symbols():
                self.session_engine.get_session_context(symbol)
            
            # 4. Classify regime (would use actual analysis data)
            # regime_engine.analyze() called with real data
            
            # 5. Assess news risk
            for symbol in self.market_watcher.get_all_symbols():
                risk = self.news_engine.assess_risk(symbol)
                # Use risk status in scanning
            
            # 6. Scan opportunities
            for symbol, data in market_data.items():
                if 'analysis' in data:
                    self.scanner.scan_symbol(
                        symbol=symbol,
                        analysis=data['analysis'],
                        current_price=data.get('price', 0),
                    )
            
            # 7. Monitor active setups
            for setup in self.setup_lifecycle.get_active_setups():
                price = market_data.get(setup.symbol, {}).get('price', 0)
                if price > 0:
                    self.setup_monitor.check_setup(setup.setup_id, price)
            
            # 8. Update status
            self.status.active_setups = len(self.setup_lifecycle.get_active_setups())
            self.status.last_scan_time = time.time()
            self.status.last_scan_duration_ms = (time.time() - cycle_start) * 1000
            self.status.instruments_scanned = len(market_data)
            self._scan_count += 1
            
            self.status.update_heartbeat('autonomous_loop', ComponentStatus.HEALTHY)
            
        except Exception as e:
            log.exception("Error in autonomous cycle: %s", e)
            self.status.health.scanner = ComponentStatus.UNHEALTHY
            self.status.update_heartbeat('autonomous_loop', ComponentStatus.UNHEALTHY,
                                        message=str(e))
    
    def get_status(self) -> dict:
        """Get complete autonomous status."""
        return {
            'mode': self.config.mode.value,
            'health': self.status.health.overall.value,
            'active_setups': self.status.active_setups,
            'scan_count': self._scan_count,
            'last_scan_time': self.status.last_scan_time,
            'opportunities': self.scanner.get_scan_summary(),
            'journal_stats': self.journal.get_stats(),
            'news_status': self.news_engine.get_global_status(),
        }
    
    def _on_scan_complete(self, event: dict):
        """Handle scan complete event."""
        log.debug("Scan complete: %s", event)
    
    def _on_setup_event(self, event: dict):
        """Handle setup state change event."""
        setup_id = event.get('setup_id')
        state = event.get('state')
        
        # Create journal entry for new setups
        if state == 'detected':
            setup = self.setup_lifecycle.get_setup(setup_id)
            if setup:
                self.journal.create_entry(
                    setup_id=setup_id,
                    symbol=setup.symbol,
                    asset_class=setup.asset_class,
                    direction=setup.direction,
                    timeframe=setup.timeframe,
                    strategy_type=setup.strategy_type,
                    engine_version=setup.engine_version,
                    score=setup.score,
                    score_components=setup.score_components,
                )
        
        # Record state change in journal
        self.journal.record_state_change(setup_id, state, event.get('reason', ''))
        
        # Generate alert for significant state changes
        if state in ('ready', 'triggered', 'invalidated', 'expired'):
            self.alert_engine.create_alert(
                alert_type=AlertType.ACTION if state == 'ready' else AlertType.INFO,
                severity=AlertSeverity.HIGH if state == 'ready' else AlertSeverity.MEDIUM,
                symbol=event.get('symbol', ''),
                title=f"Setup {state.upper()}",
                message=f"Setup {setup_id} changed to {state}",
                setup_id=setup_id,
            )
    
    def _on_monitor_alert(self, alert):
        """Handle monitoring alert."""
        log.info("Monitor alert: %s - %s", alert.alert_type, alert.message)
        
        # Forward to alert engine
        self.alert_engine.create_alert(
            alert_type=AlertType.WARNING if alert.alert_type == 'invalidation' else AlertType.INFO,
            severity=AlertSeverity.HIGH if alert.alert_type == 'invalidation' else AlertSeverity.MEDIUM,
            symbol=alert.symbol,
            title=f"Setup {alert.alert_type}",
            message=alert.message,
            setup_id=alert.setup_id,
        )
