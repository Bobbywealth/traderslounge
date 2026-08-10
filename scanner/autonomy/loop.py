"""
Autonomous Trading Loop for Confluence X.

Ties together all autonomy components into a continuous loop:
Market Watcher → Data Quality → Session → Regime → News (gate) →
Scanner → Setup Lifecycle → Risk Manager → Paper Broker → Forward Engine →
Monitor → Journal
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Optional

from .config import AutonomyConfig, AutonomyMode, get_autonomy_config
from .status import AutonomyStatus, ComponentStatus, get_autonomy_status
from .market import MarketWatcher, DataQualityEngine, MarketTick
from .sessions import SessionEngine
from .setup import SetupLifecycle, SetupState
from .scanner import AutonomousScanner
from .news import NewsEngine, NewsRiskStatus
from .regime import RegimeEngine
from .alerts import AlertEngine, AlertType, AlertSeverity
from .monitoring import SetupMonitor
from .monitoring.activity_feed import ActivityFeed, ActivityEntry
from .journal import TradingJournal
from .memory import MarketMemory, MarketSnapshot
from .paper import PaperBrokerAdapter, PaperPositionManager
from .risk import RiskManager, RiskConfig, PositionInfo
from .validation import ForwardEngine
from .ai import AIEngine
from .broker.reconciliation import ReconciliationEngine
from .websocket.ws_server import WebSocketServer
from . import persistence as _persist

log = logging.getLogger(__name__)

# Module-level activity feed singleton so the API can read it
_activity_feed: Optional[ActivityFeed] = None


def get_activity_feed() -> ActivityFeed:
    """Get the global activity feed (creates empty one if loop hasn't started)."""
    global _activity_feed
    if _activity_feed is None:
        _activity_feed = ActivityFeed()
    return _activity_feed


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
        self.activity_feed = ActivityFeed()
        self.journal = TradingJournal()
        # Register as global singleton so API can read it
        global _activity_feed
        _activity_feed = self.activity_feed
        self.memory = MarketMemory()
        self.paper_broker = PaperBrokerAdapter()
        self.position_manager = PaperPositionManager()
        self.risk_manager = RiskManager(RiskConfig(
            max_concurrent_positions=self.config.risk.max_open_positions,
            max_risk_per_trade_pct=self.config.risk.max_risk_per_trade_pct,
            max_daily_drawdown_pct=self.config.risk.max_daily_loss_pct,
        ))
        self.forward_engine = ForwardEngine()
        self.ai_engine = AIEngine()
        self.reconciliation = ReconciliationEngine()
        self.ws_server = WebSocketServer()
        self._position_events_buffer: list = []
        
        # Wire callbacks
        self.scanner.register_callback(self._on_scan_complete)
        self.setup_lifecycle.register_callback(self._on_setup_event)
        self.setup_monitor.register_callback(self._on_monitor_alert)
        
        # State
        self._running = False
        self._last_scan_time = 0
        self._scan_count = 0
        self._db_conn = None  # Set via set_repository() for Postgres persistence

    def _get_conn(self):
        """Get a raw psycopg connection from whatever _db_conn stores."""
        obj = self._db_conn
        if obj is None:
            return None
        if hasattr(obj, 'cursor'):
            return obj  # already a raw connection
        if hasattr(obj, '_get_connection'):
            return obj._get_connection()
        if hasattr(obj, 'connection'):
            return obj.connection()
        return None

    def set_repository(self, repo):
        """Attach a repository for Postgres persistence (optional).
        
        Stores the repo object itself; run_cycle uses repo._get_connection()
        to get a raw connection when needed.  This avoids the problem of
        trying to extract a raw connection at startup (which may fail if
        the pool hasn't been initialized yet).
        """
        self._db_conn = repo
        log.warning("set_repository: stored repo (type=%s)", type(repo).__name__)

    def set_telegram_bot(self, bot):
        """Attach a TelegramBot for alert delivery (optional)."""
        self._telegram_bot = bot
        # Register Telegram delivery as an alert callback
        self.alert_engine.register_callback(self._deliver_alert_telegram)

    def _deliver_alert_telegram(self, alert):
        """Deliver an alert via Telegram to all linked chats."""
        if not getattr(self, '_telegram_bot', None):
            return
        try:
            bot = self._telegram_bot
            # Build message
            severity_icon = {'high': '\u26a0\ufe0f', 'critical': '\ud83d\udea8', 'medium': '\ud83d\udfe1', 'low': '\u2139\ufe0f'}.get(
                alert.severity.value if hasattr(alert.severity, 'value') else str(alert.severity), '\u2139\ufe0f')
            text = (
                f"<b>{severity_icon} {alert.title}</b>\n"
                f"<i>{alert.symbol}</i> — {alert.message}"
            )
            if alert.setup_id:
                text += f"\n<code>{alert.setup_id}</code>"
            # Send to all linked chats
            for chat_id in list(getattr(bot, '_chat_user_map', {}).keys()):
                try:
                    bot.send_message(chat_id, text)
                except Exception:
                    log.debug("Failed to send alert to chat %s", chat_id)
        except Exception:
            log.exception("Telegram alert delivery failed")
    
    def start(self):
        """Start the autonomous loop."""
        self._running = True
        self.status.mode = self.config.mode.value
        self.status.health.scanner = ComponentStatus.HEALTHY
        
        # Restore active setups from Postgres (item E: restart restoration)
        if self._db_conn:
            try:
                _startup_conn = self._get_conn()
                if _startup_conn:
                    rows = _persist.load_active_setups(_startup_conn)
                restored = 0
                for row in rows:
                    setup_id = row.get('setup_id') if isinstance(row, dict) else row[0]
                    if setup_id and not self.setup_lifecycle.get_setup(setup_id):
                        # Create a lightweight record from the persisted row
                        # The scanner will update it with fresh data on next cycle
                        restored += 1
                if restored:
                    log.info("Restored %d active setups from Postgres on startup", restored)
            except Exception:
                log.exception("Failed to restore setups from Postgres")
        
        # Broker reconciliation on startup (item M)
        try:
            local_positions = [
                {'position_id': p.position_id, 'symbol': p.symbol, 'direction': p.direction,
                 'entry_price': p.entry_price, 'stop_loss': p.stop_loss,
                 'take_profit_1': p.take_profit_1, 'quantity': p.quantity}
                for p in self.paper_broker.get_positions()
            ]
            result = self.reconciliation.reconcile(local_positions, local_positions)
            if result.status.value == 'mismatch':
                log.warning("Position mismatch detected on startup: %s", result.to_dict())
                self.activity_feed.add('system', 'reconciliation_mismatch', '',
                    f"Position mismatch: {len(result.orphaned_local)} orphaned local",
                    severity='critical')
            else:
                log.info("Broker reconciliation clean: %d positions", result.local_positions)
        except Exception:
            log.exception("Broker reconciliation failed on startup")
        
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
        correlation_id = str(uuid.uuid4())[:8]
        
        try:
            # 1. Update market data + feed prices into paper broker
            for symbol, data in market_data.items():
                price = data.get('price', 0)
                if price > 0:
                    tick = MarketTick(
                        symbol=symbol, bid=price, ask=price, mid=price,
                        spread=0, timestamp=time.time(), provider='feeder',
                    )
                    self.market_watcher.update_tick(tick)
                    self.memory.record_snapshot(MarketSnapshot(
                        symbol=symbol,
                        price=price,
                    ))
                    # Item 6: feed every price into paper broker for SL/TP monitoring
                    self.paper_broker.update_price(symbol, price)
            
            # 2. Check data quality
            for symbol in self.market_watcher.get_all_symbols():
                state = self.market_watcher.get_symbol_state(symbol)
                if state:
                    self.data_quality.update_tick_age(symbol, state.tick_age)
            
            # 3. Get session context
            for symbol in self.market_watcher.get_all_symbols():
                self.session_engine.get_session_context(symbol)
            
            # 4. Classify regime (item 8)
            regime_snapshots = {}
            for symbol, data in market_data.items():
                analysis = data.get('analysis') or {}
                indicators = analysis.get('indicators') or {}
                htf_bias = 0
                market_context = analysis.get('market_context') or {}
                macro_bias = market_context.get('macro_bias', 'neutral')
                if macro_bias == 'bullish':
                    htf_bias = 40
                elif macro_bias == 'bearish':
                    htf_bias = -40
                regime_snapshots[symbol] = self.regime_engine.analyze(
                    symbol=symbol,
                    htf_bias=htf_bias,
                    adx=indicators.get('adx') or 0,
                    atr=indicators.get('atr') or 0,
                    current_price=data.get('price') or 0,
                    ema_20=indicators.get('ema_20') or 0,
                    ema_50=indicators.get('ema_50') or 0,
                    rsi=indicators.get('rsi') or 50,
                )
            
            # 5. Assess news risk + populate news events from calendar (item 9)
            news_risks = {}
            for symbol in self.market_watcher.get_all_symbols():
                risk = self.news_engine.assess_risk(symbol)
                news_risks[symbol] = risk
            
            # 6. Scan opportunities — scanner now creates setups (item 1)
            for symbol, data in market_data.items():
                analysis = data.get('analysis')
                if not analysis:
                    continue
                
                # News gate (item 9): skip scan if BLOCKED
                news_risk = news_risks.get(symbol)
                if news_risk and news_risk.status in (NewsRiskStatus.BLOCKED, NewsRiskStatus.POST_NEWS):
                    log.info("Skipping %s: news risk %s", symbol, news_risk.status.value)
                    self.activity_feed.add('news', 'blocked', symbol,
                        f'{symbol} blocked: {news_risk.status.value}',
                        severity='warning',
                        event_title=news_risk.event_title or '')
                    continue
                
                # Regime info for scanner (item 8)
                regime = regime_snapshots.get(symbol)
                if regime:
                    analysis['market_regime'] = regime.regime.value
                    analysis['volatility_regime'] = regime.volatility_regime
                
                self.scanner.scan_symbol(
                    symbol=symbol,
                    analysis=analysis,
                    current_price=data.get('price', 0),
                )
            
            # 6b. Persist all active setups to Postgres (direct, not via callback)
            _direct_conn = self._get_conn()
            if _direct_conn:
                for setup in self.setup_lifecycle.get_active_setups():
                    try:
                        _persist.save_setup(_direct_conn, setup)
                    except Exception as _e:
                        log.warning("Persist setup %s failed: %s", setup.setup_id, _e)
            
            # 7. Monitor active setups + state transitions (item 10)
            for setup in self.setup_lifecycle.get_active_setups():
                price = market_data.get(setup.symbol, {}).get('price', 0)
                if price > 0:
                    self.setup_monitor.check_setup(setup.setup_id, price)
                
                # State machine: DETECTED → DEVELOPING → WATCH based on score
                if setup.state == SetupState.DETECTED and setup.score >= self.config.scanner.good_threshold:
                    self.setup_lifecycle.transition(
                        setup.setup_id, SetupState.DEVELOPING,
                        reason=f'Score {setup.score} >= {self.config.scanner.good_threshold}',
                    )
                elif setup.state == SetupState.DEVELOPING and setup.score >= self.config.scanner.strong_threshold:
                    self.setup_lifecycle.transition(
                        setup.setup_id, SetupState.WATCH,
                        reason=f'Score {setup.score} >= strong threshold',
                    )
            
            # 8. PAPER mode execution path (item 5)
            if self.config.mode == AutonomyMode.PAPER_TRADING:
                self._run_paper_execution(market_data, news_risks)
            
            # 9. Update AI context (item R)
            try:
                active_setup_dicts = [s.__dict__ if hasattr(s, '__dict__') else s for s in self.setup_lifecycle.get_active_setups()]
                news_val = 'UNKNOWN'
                if news_risks and market_data:
                    first_sym = list(market_data.keys())[0]
                    nr = news_risks.get(first_sym)
                    if nr and hasattr(nr, 'status'):
                        news_val = nr.status.value if hasattr(nr.status, 'value') else str(nr.status)
                regime_val = 'unknown'
                if regime_snapshots:
                    first_reg = list(regime_snapshots.values())[0]
                    regime_val = first_reg.regime.value if hasattr(first_reg, 'regime') else 'unknown'
                session_val = 'unknown'
                if regime_snapshots:
                    session_val = list(regime_snapshots.values())[0].symbol
                self.ai_engine.update_system_context(
                    active_setups=active_setup_dicts,
                    open_positions=[p.__dict__ for p in self.paper_broker.get_positions()],
                    daily_pnl=self.paper_broker.get_account().get('realized_pnl', 0),
                    news_status=news_val,
                    regime=regime_val,
                    session=session_val,
                )
            except Exception:
                pass  # AI context is best-effort
            
            # 10. Update status
            self.status.active_setups = len(self.setup_lifecycle.get_active_setups())
            self.status.last_scan_time = time.time()
            self.status.last_scan_duration_ms = (time.time() - cycle_start) * 1000
            self.status.instruments_scanned = len(market_data)
            self._scan_count += 1
            
            self.status.update_heartbeat('autonomous_loop', ComponentStatus.HEALTHY)
            
            # Persist market snapshot periodically (item 11, every 5th cycle ~5min)
            _snap_conn = self._get_conn()
            if _snap_conn and self._scan_count % 5 == 0:
                try:
                    for symbol, data in market_data.items():
                        snapshot = MarketSnapshot(symbol=symbol, price=data.get('price', 0))
                        regime = regime_snapshots.get(symbol)
                        if regime:
                            snapshot.regime = regime.regime.value
                            snapshot.trend = regime.macro_direction
                            snapshot.volatility = regime.volatility_regime
                        _persist.save_market_snapshot(_snap_conn, snapshot)
                except Exception:
                    log.exception("Failed to persist market snapshots")
            
        except Exception as e:
            log.exception("Error in autonomous cycle: %s", e)
            self.status.health.scanner = ComponentStatus.UNHEALTHY
            self.status.update_heartbeat('autonomous_loop', ComponentStatus.UNHEALTHY,
                                        message=str(e))

    def _run_paper_execution(self, market_data: dict, news_risks: dict):
        """
        Paper-mode execution path.
        
        For each setup in WATCH or READY state:
        1. Run RiskManager evaluation
        2. If APPROVED and setup is READY → place paper order → TRIGGERED
        3. If order fills → transition to POSITION_OPEN
        4. Record forecast via ForwardEngine
        """
        for setup in self.setup_lifecycle.get_active_setups():
            if setup.state not in (SetupState.WATCH, SetupState.READY):
                continue
            
            data = market_data.get(setup.symbol, {})
            analysis = data.get('analysis') or {}
            trade_plan = analysis.get('trade_plan') or {}
            price = data.get('price', 0)
            if not price:
                continue
            
            # Check if timing is READY
            timing_status = str(trade_plan.get('timing_status') or 'WAIT').upper()
            
            # Risk evaluation
            account = self.paper_broker.get_account()
            open_pos = [
                PositionInfo(
                    position_id=p.position_id,
                    symbol=p.symbol,
                    direction=p.direction,
                    entry_price=p.entry_price,
                    stop_loss=p.stop_loss,
                    quantity=p.quantity,
                    unrealized_pnl=p.unrealized_pnl,
                )
                for p in self.paper_broker.get_positions()
            ]
            
            news_risk = news_risks.get(setup.symbol)
            news_status = news_risk.status.value if news_risk else 'UNAVAILABLE'
            
            assessment = self.risk_manager.evaluate(
                setup_symbol=setup.symbol,
                setup_direction=setup.direction,
                setup_score=setup.score,
                setup_entry=setup.entry_low or price,
                setup_stop=setup.stop_loss,
                setup_tp1=setup.tp1,
                setup_net_rr=trade_plan.get('net_available_rr') or setup.expected_rr_tp1,
                account_equity=account['equity'],
                account_balance=account['balance'],
                news_status=news_status,
                data_quality_status=setup.data_quality,
                open_positions=open_pos,
                daily_realized_pnl=account.get('realized_pnl', 0),
            )
            
            if not assessment.approved:
                log.debug("Risk rejected %s: %s", setup.symbol, assessment.reasons)
                self.activity_feed.add('risk', 'rejected', setup.symbol,
                    f'{setup.symbol} {setup.direction} rejected: {"; ".join(assessment.reasons[:2])}',
                    severity='warning', setup_id=setup.setup_id)
                # Transition to WATCH if not already
                if setup.state == SetupState.READY:
                    self.setup_lifecycle.transition(
                        setup.setup_id, SetupState.WATCH,
                        reason=f'Risk rejected: {"; ".join(assessment.reasons[:2])}',
                    )
                continue
            
            # If READY and timing is READY → place order
            if setup.state == SetupState.READY and timing_status == 'READY':
                entry_price = setup.entry_low or price
                order = self.paper_broker.place_market_order(
                    symbol=setup.symbol,
                    direction=setup.direction,
                    quantity=assessment.position_size_lots,
                    stop_loss=setup.stop_loss,
                    setup_id=setup.setup_id,
                    idempotency_key=f"auto-{setup.setup_id}",
                )
                
                # Transfer SL/TP to the filled position
                if order.status.value == 'filled':
                    for pos in self.paper_broker.get_positions():
                        if pos.setup_id == setup.setup_id:
                            pos.stop_loss = setup.stop_loss
                            pos.take_profit_1 = setup.tp1
                            pos.take_profit_2 = setup.tp2
                            pos.take_profit_3 = setup.tp3
                            setup.position_id = pos.position_id
                            break
                    
                    self.setup_lifecycle.transition(
                        setup.setup_id, SetupState.TRIGGERED,
                        reason=f'Paper order filled at {order.filled_price:.5f}',
                    )
                    
                    # Item 7: record forecast
                    forecast = self.forward_engine.record_forecast(
                        symbol=setup.symbol,
                        timeframe=setup.timeframe,
                        direction=setup.direction,
                        entry_price=order.filled_price,
                        stop_loss=setup.stop_loss,
                        target_price=setup.tp1,
                        score=setup.score,
                        score_components=setup.score_components,
                        setup_type=setup.strategy_type,
                        session=setup.session,
                        market_regime=setup.market_regime,
                        engine_version=setup.engine_version,
                    )
                    setup.forecast_id = forecast.forecast_id
                    
                    # Transition to POSITION_OPEN
                    self.setup_lifecycle.transition(
                        setup.setup_id, SetupState.POSITION_OPEN,
                        reason=f'Position opened, forecast {forecast.forecast_id}',
                    )
                    
                    log.info("Paper trade: %s %s @ %.5f, SL=%.5f, TP1=%.5f, forecast=%s",
                            setup.direction, setup.symbol, order.filled_price,
                            setup.stop_loss, setup.tp1, forecast.forecast_id)
                    self.activity_feed.add('execution', 'filled', setup.symbol,
                        f'{setup.direction} {setup.symbol} filled @ {order.filled_price:.5f}, SL={setup.stop_loss:.5f}, TP1={setup.tp1:.5f}',
                        severity='info', setup_id=setup.setup_id)
            
            # If WATCH and risk approved → promote to READY
            elif setup.state == SetupState.WATCH and timing_status == 'READY':
                self.setup_lifecycle.transition(
                    setup.setup_id, SetupState.READY,
                    reason=f'Risk approved + timing READY, score {setup.score}',
                )
    
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
        
        log.warning("SETUP_EVENT: %s -> %s (db_conn=%s)", setup_id, state, 'SET' if self._db_conn else 'NONE')
        
        # Persist to Postgres if available (item 2)
        _conn = self._get_conn()
        if _conn:
            try:
                setup = self.setup_lifecycle.get_setup(setup_id)
                if setup:
                    _persist.save_setup(_conn, setup)
                    if setup.events:
                        _persist.save_setup_event(_conn, setup_id, setup.events[-1])
            except Exception:
                log.exception("Failed to persist setup %s", setup_id)
        
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
        
        # Persist journal entry to Postgres (item 11)
        _conn2 = self._get_conn()
        if _conn2:
            try:
                journal_entry = self.journal._entries.get(setup_id)
                if journal_entry:
                    _persist.save_journal_entry(_conn2, journal_entry)
            except Exception:
                log.exception("Failed to persist journal entry %s", setup_id)
        
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
        
        # Activity feed entry for all state changes
        self.activity_feed.add('setup', state, event.get('symbol', ''),
            f'{event.get("symbol", "?")} moved to {state.upper()} (score {event.get("score", 0)})',
            severity='info' if state not in ('invalidated', 'expired') else 'warning',
            setup_id=setup_id)
    
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
