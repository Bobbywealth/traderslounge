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
from ..setup.setup_lifecycle import SetupLifecycle, SetupRecord, SetupState, _build_fingerprint

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


# Minimum score to create or update a setup.
_SETUP_SCORE_THRESHOLD = 35
# Minimum raw confluence score to create a "forming" setup (DETECTED state)
# before directional confirmation.  This captures setups that are building
# confluence but haven't confirmed BUY/SELL yet.
_FORMING_RAW_SCORE_THRESHOLD = 25


class AutonomousScanner:
    """
    Autonomous Scanner.
    
    Continuously scans the instrument universe, detects opportunities,
    and ranks them by confluence score.  Qualified opportunities are
    automatically promoted into SetupLifecycle so the rest of the
    autonomy stack (monitoring, risk, execution) can act on them.
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
        # Use forming_score when total_score is 0 (direction not yet confirmed)
        if score == 0:
            score = analysis.get('forming_score', 0)
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
        
                # Build fingerprint for duplicate detection
        entry_price = float(trade_plan.get('entry') or 0) or current_price
        raw_confluence = int(analysis.get('raw_confluence_score') or 0)
        fingerprint = _build_fingerprint(
            symbol=symbol, direction=direction,
            timeframe=str((analysis.get('data_quality') or {}).get('primary_timeframe', 'H1')),
            strategy_type='confluence',
            entry_zone_center=entry_price,
            macro_timeframe='',
            session=session_context.current_session.value if session_context else '',
        )
        
        # Check for existing setup by fingerprint (prevents duplicates)
        existing_by_fp = self.setup_lifecycle.find_by_fingerprint(fingerprint)
        existing_setups = self.setup_lifecycle.get_active_setups(symbol)
        setup_state = 'none'
        setup_id = None
        if existing_by_fp:
            # Update the existing setup — same market idea getting stronger
            best_setup = existing_by_fp
            setup_state = best_setup.state.value
            setup_id = best_setup.setup_id
            best_setup.score = score
            best_setup.score_components = analysis.get('category_breakdown', {})
            best_setup.direction = direction
            best_setup.market_regime = analysis.get('market_regime', '')
            best_setup.updated_at = time.time()
            if trade_plan:
                best_setup.entry_low = float(trade_plan.get('entry') or 0)
                best_setup.entry_high = float(trade_plan.get('entry') or 0)
                best_setup.stop_loss = float(trade_plan.get('stop') or 0)
                targets = trade_plan.get('targets') or []
                best_setup.tp1 = float(targets[0]['price']) if len(targets) > 0 else 0
                best_setup.tp2 = float(targets[1]['price']) if len(targets) > 1 else 0
                best_setup.tp3 = float(targets[2]['price']) if len(targets) > 2 else 0
                best_setup.technical_reasons = [r.get('message', str(r)) if isinstance(r, dict) else str(r) for r in (trade_plan.get('reasons') or [])[:5]]
            # Promote state if score improved
            if best_setup.state == SetupState.DETECTED and score >= self.config.scanner.good_threshold:
                self.setup_lifecycle.transition(setup_id, SetupState.DEVELOPING, reason=f'Score improved to {score}')
                setup_state = 'developing'
        elif existing_setups:
            # No fingerprint match but other active setups exist — update if same direction
            same_dir = [s for s in existing_setups if s.direction == direction]
            if same_dir:
                best_setup = max(same_dir, key=lambda s: s.score)
                setup_state = best_setup.state.value
                setup_id = best_setup.setup_id
                best_setup.score = score
                best_setup.score_components = analysis.get('category_breakdown', {})
                best_setup.market_regime = analysis.get('market_regime', '')
                best_setup.updated_at = time.time()
                if trade_plan:
                    best_setup.entry_low = float(trade_plan.get('entry') or 0)
                    best_setup.entry_high = float(trade_plan.get('entry') or 0)
                    best_setup.stop_loss = float(trade_plan.get('stop') or 0)
                    targets = trade_plan.get('targets') or []
                    best_setup.tp1 = float(targets[0]['price']) if len(targets) > 0 else 0
                    best_setup.tp2 = float(targets[1]['price']) if len(targets) > 1 else 0
                    best_setup.tp3 = float(targets[2]['price']) if len(targets) > 2 else 0
                    best_setup.technical_reasons = [r.get('message', str(r)) if isinstance(r, dict) else str(r) for r in (trade_plan.get('reasons') or [])[:5]]
                if best_setup.state == SetupState.DETECTED and score >= self.config.scanner.good_threshold:
                    self.setup_lifecycle.transition(setup_id, SetupState.DEVELOPING, reason=f'Score improved to {score}')
                    setup_state = 'developing'
            elif score >= _SETUP_SCORE_THRESHOLD and direction in ('BUY', 'SELL'):
                # Different direction from existing — create new setup
                stop_price = float(trade_plan.get('stop') or 0)
                targets = trade_plan.get('targets') or []
                tp1 = float(targets[0]['price']) if len(targets) > 0 else 0
                tp2 = float(targets[1]['price']) if len(targets) > 1 else 0
                tp3 = float(targets[2]['price']) if len(targets) > 2 else 0
                new_setup = self.setup_lifecycle.create_setup(
                    symbol=symbol,
                    asset_class=analysis.get('asset_class', 'cryptocurrency'),
                    direction=direction,
                    timeframe=analysis.get('data_quality', {}).get('primary_timeframe', 'H1'),
                    score=score,
                    fingerprint=fingerprint,
                    score_components=analysis.get('category_breakdown', {}),
                    entry_low=entry_price, entry_high=entry_price,
                    stop_loss=stop_price,
                    tp1=tp1, tp2=tp2, tp3=tp3,
                    market_regime=analysis.get('market_regime', ''),
                    session=session_context.current_session.value if session_context else '',
                    news_state=trade_plan.get('calendar_status', ''),
                    data_quality=self.data_quality.get_quality(symbol).status.value if self.data_quality.get_quality(symbol) else 'unknown',
                    technical_reasons=[r.get('message', str(r)) if isinstance(r, dict) else str(r) for r in (trade_plan.get('reasons') or [])[:5]],
                )
                setup_id = new_setup.setup_id
                setup_state = new_setup.state.value
        elif score >= _SETUP_SCORE_THRESHOLD and direction in ('BUY', 'SELL'):
            # Create a new setup — first time this symbol qualifies
            stop_price = float(trade_plan.get('stop') or 0)
            targets = trade_plan.get('targets') or []
            tp1 = float(targets[0]['price']) if len(targets) > 0 else 0
            tp2 = float(targets[1]['price']) if len(targets) > 1 else 0
            tp3 = float(targets[2]['price']) if len(targets) > 2 else 0
            new_setup = self.setup_lifecycle.create_setup(
                symbol=symbol,
                asset_class=analysis.get('asset_class', 'cryptocurrency'),
                direction=direction,
                timeframe=analysis.get('data_quality', {}).get('primary_timeframe', 'H1'),
                score=score,
                fingerprint=fingerprint,
                score_components=analysis.get('category_breakdown', {}),
                entry_low=entry_price,
                entry_high=entry_price,
                stop_loss=stop_price,
                tp1=tp1, tp2=tp2, tp3=tp3,
                market_regime=analysis.get('market_regime', ''),
                session=session_context.current_session.value if session_context else '',
                news_state=trade_plan.get('calendar_status', ''),
                data_quality=self.data_quality.get_quality(symbol).status.value if self.data_quality.get_quality(symbol) else 'unknown',
                technical_reasons=[r.get('message', str(r)) if isinstance(r, dict) else str(r) for r in (trade_plan.get('reasons') or [])[:5]],
            )
            setup_id = new_setup.setup_id
            setup_state = new_setup.state.value
        elif raw_confluence >= _FORMING_RAW_SCORE_THRESHOLD and not existing_setups:
            # Forming setup: strong confluence but no confirmed direction yet.
            # Creates a DETECTED setup so the Signals page can show it as "Forming".
            macro_bias = (analysis.get('market_context') or {}).get('macro_bias', 'neutral')
            forming_dir = macro_bias.upper() if macro_bias != 'neutral' else 'NEUTRAL'
            new_setup = self.setup_lifecycle.create_setup(
                symbol=symbol,
                asset_class=analysis.get('asset_class', 'cryptocurrency'),
                direction=forming_dir,
                timeframe=analysis.get('data_quality', {}).get('primary_timeframe', 'H1'),
                score=raw_confluence,
                fingerprint=fingerprint,
                score_components={'raw_confluence': raw_confluence},
                entry_low=0, entry_high=0,
                market_regime=analysis.get('market_regime', ''),
                session=session_context.current_session.value if session_context else '',
                data_quality=self.data_quality.get_quality(symbol).status.value if self.data_quality.get_quality(symbol) else 'unknown',
                technical_reasons=[f'Raw confluence {raw_confluence}/100 — direction not yet confirmed'],
            )
            setup_id = new_setup.setup_id
            setup_state = new_setup.state.value

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
