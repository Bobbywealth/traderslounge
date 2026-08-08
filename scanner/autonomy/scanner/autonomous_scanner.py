"""
Autonomous Scanner for Confluence X.

Continuously scans the instrument universe, detects opportunities,
and ranks them by confluence score.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from ..config import AutonomyConfig, get_autonomy_config
from ..market.data_quality import DataQualityEngine
from ..sessions.session_engine import SessionEngine
from ..setup.setup_lifecycle import SetupLifecycle, SetupRecord, SetupState

log = logging.getLogger(__name__)


@dataclass
class RankedOpportunity:
    """A ranked trading opportunity."""
    symbol: str
    direction: str  # BUY, SELL, NEUTRAL
    score: int
    setup_quality: str  # STRONG, VALID, WATCHLIST, NO_TRADE
    execution_readiness: str  # READY, DEVELOPING, WAITING
    market_regime: str
    session: str
    news_status: str
    data_health: str
    expected_rr: float
    setup_state: str
    setup_id: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


class AutonomousScanner:
    """
    Autonomous Scanner.
    
    Continuously scans the instrument universe, detects opportunities,
    and ranks them by confluence score.
    """
    
    def __init__(self, 
                 config: Optional[AutonomyConfig] = None,
                 data_quality: Optional[DataQualityEngine] = None,
                 session_engine: Optional[SessionEngine] = None,
                 setup_lifecycle: Optional[SetupLifecycle] = None):
        self.config = config or get_autonomy_config()
        self.data_quality = data_quality or DataQualityEngine()
        self.session_engine = session_engine or SessionEngine()
        self.setup_lifecycle = setup_lifecycle or SetupLifecycle()
        
        self._scan_results: Dict[str, RankedOpportunity] = {}
        self._last_scan_time: float = 0
        self._scan_count: int = 0
        self._callbacks: List[Callable] = []
    
    def register_callback(self, callback: Callable):
        """Register a callback for scan results."""
        self._callbacks.append(callback)
    
    def scan_symbol(self, symbol: str, 
                    analysis: dict,
                    current_price: float) -> Optional[RankedOpportunity]:
        """Scan a single symbol and return ranked opportunity."""
        start_time = time.time()
        
        # Check data quality
        if not self.data_quality.can_trade(symbol):
            log.info("Skipping %s: data quality insufficient", symbol)
            return None
        
        # Get session context
        session_context = self.session_engine.get_session_context(symbol)
        
        # Extract analysis results
        score = analysis.get('total_score', 0)
        direction = analysis.get('direction', 'NEUTRAL')
        trade_plan = analysis.get('trade_plan', {})
        
        # Determine setup quality
        if score >= self.config.scanner.strong_threshold:
            setup_quality = 'STRONG'
        elif score >= self.config.scanner.good_threshold:
            setup_quality = 'VALID'
        elif score >= self.config.scanner.watchlist_threshold:
            setup_quality = 'WATCHLIST'
        else:
            setup_quality = 'NO_TRADE'
        
        # Determine execution readiness
        execution_readiness = 'WAITING'
        if trade_plan.get('eligible', False):
            calendar_status = trade_plan.get('calendar_status', '').upper()
            timing_status = trade_plan.get('timing_status', '').upper()
            if timing_status == 'READY' and calendar_status not in ('BLOCKED', 'POST_NEWS'):
                execution_readiness = 'READY'
            elif timing_status in ('DEVELOPING', 'WATCH'):
                execution_readiness = 'DEVELOPING'
        
        # Get news status
        news_status = trade_plan.get('calendar_status', 'UNKNOWN')
        
        # Get data health
        quality = self.data_quality.get_quality(symbol)
        data_health = quality.status.value
        
        # Calculate expected R:R
        expected_rr = 0.0
        entry = trade_plan.get('entry')
        stop = trade_plan.get('stop')
        tp1 = trade_plan.get('tp1')
        if entry and stop and tp1 and stop != entry:
            risk = abs(entry - stop)
            reward = abs(tp1 - entry)
            expected_rr = reward / risk if risk > 0 else 0
        
        # Check for existing setup
        existing_setups = self.setup_lifecycle.get_active_setups(symbol)
        setup_state = 'none'
        setup_id = None
        if existing_setups:
            # Use highest-scored active setup
            best_setup = max(existing_setups, key=lambda s: s.score)
            setup_state = best_setup.state.value
            setup_id = best_setup.setup_id
        
        # Create ranked opportunity
        opportunity = RankedOpportunity(
            symbol=symbol,
            direction=direction,
            score=score,
            setup_quality=setup_quality,
            execution_readiness=execution_readiness,
            market_regime=analysis.get('market_regime', 'unknown'),
            session=session_context.current_session.value,
            news_status=news_status,
            data_health=data_health,
            expected_rr=expected_rr,
            setup_state=setup_state,
            setup_id=setup_id,
        )
        
        # Store result
        self._scan_results[symbol] = opportunity
        self._last_scan_time = time.time()
        self._scan_count += 1
        
        # Emit event
        self._emit_event('SCAN_COMPLETE', {
            'symbol': symbol,
            'score': score,
            'direction': direction,
            'setup_quality': setup_quality,
            'execution_readiness': execution_readiness,
            'duration_ms': (time.time() - start_time) * 1000,
        })
        
        return opportunity
    
    def get_ranked_opportunities(self, min_score: int = 0) -> List[RankedOpportunity]:
        """Get all opportunities ranked by score."""
        opportunities = [
            opp for opp in self._scan_results.values()
            if opp.score >= min_score
        ]
        return sorted(opportunities, key=lambda o: o.score, reverse=True)
    
    def get_ready_opportunities(self) -> List[RankedOpportunity]:
        """Get all opportunities ready for execution."""
        return [
            opp for opp in self._scan_results.values()
            if opp.execution_readiness == 'READY' and opp.setup_quality in ('STRONG', 'VALID')
        ]
    
    def get_watchlist(self) -> List[RankedOpportunity]:
        """Get opportunities on the watchlist."""
        return [
            opp for opp in self._scan_results.values()
            if opp.setup_quality == 'WATCHLIST'
        ]
    
    def get_scan_summary(self) -> dict:
        """Get scan summary statistics."""
        total = len(self._scan_results)
        strong = sum(1 for o in self._scan_results.values() if o.setup_quality == 'STRONG')
        valid = sum(1 for o in self._scan_results.values() if o.setup_quality == 'VALID')
        watchlist = sum(1 for o in self._scan_results.values() if o.setup_quality == 'WATCHLIST')
        ready = sum(1 for o in self._scan_results.values() if o.execution_readiness == 'READY')
        
        return {
            'total_symbols': total,
            'strong_setups': strong,
            'valid_setups': valid,
            'watchlist_setups': watchlist,
            'ready_for_execution': ready,
            'last_scan_time': self._last_scan_time,
            'scan_count': self._scan_count,
        }
    
    def _emit_event(self, event_type: str, data: dict):
        """Emit a scan event to all callbacks."""
        event = {
            'type': event_type,
            'timestamp': time.time(),
            **data,
        }
        for callback in self._callbacks:
            try:
                callback(event)
            except Exception as e:
                log.error("Error in scan event callback: %s", e)
