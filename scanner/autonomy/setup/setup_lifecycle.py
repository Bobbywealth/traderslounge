"""
Setup Lifecycle Engine for Confluence X.

Manages the lifecycle of trading setups from detection to resolution.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class SetupState(Enum):
    """Setup lifecycle states."""
    DETECTED = 'detected'  # Potential structure exists
    DEVELOPING = 'developing'  # Multiple components aligning
    WATCH = 'watch'  # Setup nearing trigger area
    READY = 'ready'  # All confirmation criteria satisfied
    TRIGGERED = 'triggered'  # Entry condition occurred
    POSITION_OPEN = 'position_open'  # Execution confirmed
    TP1 = 'tp1'  # First target hit
    TP2 = 'tp2'  # Second target hit
    TP3 = 'tp3'  # Third target hit
    CLOSED = 'closed'  # Position fully closed
    INVALIDATED = 'invalidated'  # Setup assumptions no longer valid
    EXPIRED = 'expired'  # Setup never triggered within allowed window
    CANCELLED = 'cancelled'  # Cancelled by user or system


# Valid state transitions
VALID_TRANSITIONS = {
    SetupState.DETECTED: [SetupState.DEVELOPING, SetupState.INVALIDATED, SetupState.EXPIRED, SetupState.CANCELLED],
    SetupState.DEVELOPING: [SetupState.WATCH, SetupState.INVALIDATED, SetupState.EXPIRED, SetupState.CANCELLED],
    SetupState.WATCH: [SetupState.READY, SetupState.INVALIDATED, SetupState.EXPIRED, SetupState.CANCELLED],
    SetupState.READY: [SetupState.TRIGGERED, SetupState.INVALIDATED, SetupState.EXPIRED, SetupState.CANCELLED],
    SetupState.TRIGGERED: [SetupState.POSITION_OPEN, SetupState.INVALIDATED],
    SetupState.POSITION_OPEN: [SetupState.TP1, SetupState.CLOSED, SetupState.INVALIDATED],
    SetupState.TP1: [SetupState.TP2, SetupState.CLOSED, SetupState.INVALIDATED],
    SetupState.TP2: [SetupState.TP3, SetupState.CLOSED, SetupState.INVALIDATED],
    SetupState.TP3: [SetupState.CLOSED],
    SetupState.CLOSED: [],
    SetupState.INVALIDATED: [],
    SetupState.EXPIRED: [],
    SetupState.CANCELLED: [],
}


@dataclass
class SetupEvent:
    """A state transition event for a setup."""
    event_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: float = field(default_factory=time.time)
    from_state: Optional[SetupState] = None
    to_state: SetupState = SetupState.DETECTED
    reason: str = ''
    metadata: dict = field(default_factory=dict)


@dataclass
class SetupRecord:
    """A persistent setup record."""
    setup_id: str  # e.g., "CX-XAUUSD-H1-20260808-00482"
    symbol: str
    asset_class: str
    direction: str  # BUY, SELL, NEUTRAL
    detected_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    timeframe: str = 'H1'
    macro_timeframe: str = 'D1'
    strategy_type: str = 'confluence'
    engine_version: str = '2.0.0-alpha'
    
    # Market context
    market_regime: str = ''
    session: str = ''
    
    # Scoring
    score: int = 0
    score_components: Dict[str, int] = field(default_factory=dict)
    
    # Trade levels
    entry_low: float = 0.0
    entry_high: float = 0.0
    entry_type: str = ''  # market, limit, stop
    
    stop_loss: float = 0.0
    tp1: float = 0.0
    tp2: float = 0.0
    tp3: float = 0.0
    
    expected_rr_tp1: float = 0.0
    expected_rr_tp2: float = 0.0
    expected_rr_tp3: float = 0.0
    
    invalidation_price: float = 0.0
    invalidation_condition: str = ''
    
    # Reasons
    technical_reasons: List[str] = field(default_factory=list)
    macro_reasons: List[str] = field(default_factory=list)
    risk_reasons: List[str] = field(default_factory=list)
    
    # Context
    news_state: str = ''
    data_quality: str = 'healthy'
    
    # State
    state: SetupState = SetupState.DETECTED
    state_reason: str = ''
    
    # Expiry
    expires_at: Optional[float] = None
    
    # References
    forecast_id: Optional[str] = None
    position_id: Optional[str] = None
    
    # Events history
    events: List[SetupEvent] = field(default_factory=list)


class SetupLifecycle:
    """
    Setup Lifecycle Engine.
    
    Manages the lifecycle of trading setups from detection to resolution.
    """
    
    def __init__(self):
        self._setups: Dict[str, SetupRecord] = {}
        self._active_setups: Dict[str, List[str]] = {}  # symbol -> [setup_ids]
        self._callbacks: List[callable] = []
    
    def register_callback(self, callback: callable):
        """Register a callback for setup events."""
        self._callbacks.append(callback)
    
    def create_setup(self, symbol: str, asset_class: str, direction: str,
                     timeframe: str = 'H1', score: int = 0, **kwargs) -> SetupRecord:
        """Create a new setup record."""
        # Generate unique setup ID
        timestamp_str = time.strftime('%Y%m%d-%H%M%S')
        random_suffix = str(uuid.uuid4())[:5]
        setup_id = f"CX-{symbol}-{timeframe}-{timestamp_str}-{random_suffix}"
        
        setup = SetupRecord(
            setup_id=setup_id,
            symbol=symbol,
            asset_class=asset_class,
            direction=direction,
            timeframe=timeframe,
            score=score,
            **kwargs,
        )
        
        # Add initial event
        setup.events.append(SetupEvent(
            to_state=SetupState.DETECTED,
            reason='Setup detected by scanner',
        ))
        
        self._setups[setup_id] = setup
        
        # Track active setups per symbol
        if symbol not in self._active_setups:
            self._active_setups[symbol] = []
        self._active_setups[symbol].append(setup_id)
        
        log.info("Created setup: %s (%s %s, score=%d)", setup_id, symbol, direction, score)
        
        self._emit_event('SETUP_DETECTED', setup)
        
        return setup
    
    def transition(self, setup_id: str, new_state: SetupState, reason: str = '',
                   **metadata) -> bool:
        """Transition a setup to a new state."""
        if setup_id not in self._setups:
            log.error("Setup not found: %s", setup_id)
            return False
        
        setup = self._setups[setup_id]
        old_state = setup.state
        
        # Validate transition
        if new_state not in VALID_TRANSITIONS.get(old_state, []):
            log.error("Invalid transition: %s -> %s for setup %s", 
                     old_state.value, new_state.value, setup_id)
            return False
        
        # Create event
        event = SetupEvent(
            from_state=old_state,
            to_state=new_state,
            reason=reason,
            metadata=metadata,
        )
        
        # Update setup
        setup.state = new_state
        setup.state_reason = reason
        setup.updated_at = time.time()
        setup.events.append(event)
        
        log.info("Setup %s: %s -> %s (%s)", setup_id, old_state.value, new_state.value, reason)
        
        self._emit_event('SETUP_UPDATED', setup)
        
        # Remove from active if terminal state
        if new_state in (SetupState.CLOSED, SetupState.INVALIDATED, 
                         SetupState.EXPIRED, SetupState.CANCELLED):
            symbol = setup.symbol
            if symbol in self._active_setups:
                self._active_setups[symbol] = [
                    sid for sid in self._active_setups[symbol] if sid != setup_id
                ]
        
        return True
    
    def get_setup(self, setup_id: str) -> Optional[SetupRecord]:
        """Get a setup by ID."""
        return self._setups.get(setup_id)
    
    def get_active_setups(self, symbol: Optional[str] = None) -> List[SetupRecord]:
        """Get active setups, optionally filtered by symbol."""
        if symbol:
            setup_ids = self._active_setups.get(symbol, [])
            return [self._setups[sid] for sid in setup_ids if sid in self._setups]
        
        return [
            setup for setup in self._setups.values()
            if setup.state not in (SetupState.CLOSED, SetupState.INVALIDATED,
                                   SetupState.EXPIRED, SetupState.CANCELLED)
        ]
    
    def get_setups_by_state(self, state: SetupState) -> List[SetupRecord]:
        """Get all setups in a specific state."""
        return [
            setup for setup in self._setups.values()
            if setup.state == state
        ]
    
    def get_ready_setups(self) -> List[SetupRecord]:
        """Get all setups in READY state."""
        return self.get_setups_by_state(SetupState.READY)
    
    def expire_old_setups(self, max_age_seconds: float = 86400) -> int:
        """Expire setups that are older than max_age_seconds."""
        now = time.time()
        expired_count = 0
        
        for setup in list(self._setups.values()):
            if setup.state in (SetupState.CLOSED, SetupState.INVALIDATED,
                               SetupState.EXPIRED, SetupState.CANCELLED):
                continue
            
            age = now - setup.detected_at
            if age > max_age_seconds:
                self.transition(setup.setup_id, SetupState.EXPIRED, 
                               reason=f'Expired after {age/3600:.1f} hours')
                expired_count += 1
        
        return expired_count
    
    def to_dict(self, setup_id: str) -> Optional[dict]:
        """Convert a setup to dictionary."""
        setup = self._setups.get(setup_id)
        if not setup:
            return None
        
        return {
            'setup_id': setup.setup_id,
            'symbol': setup.symbol,
            'asset_class': setup.asset_class,
            'direction': setup.direction,
            'detected_at': setup.detected_at,
            'updated_at': setup.updated_at,
            'timeframe': setup.timeframe,
            'macro_timeframe': setup.macro_timeframe,
            'strategy_type': setup.strategy_type,
            'engine_version': setup.engine_version,
            'market_regime': setup.market_regime,
            'session': setup.session,
            'score': setup.score,
            'score_components': setup.score_components,
            'entry_low': setup.entry_low,
            'entry_high': setup.entry_high,
            'entry_type': setup.entry_type,
            'stop_loss': setup.stop_loss,
            'tp1': setup.tp1,
            'tp2': setup.tp2,
            'tp3': setup.tp3,
            'expected_rr_tp1': setup.expected_rr_tp1,
            'expected_rr_tp2': setup.expected_rr_tp2,
            'expected_rr_tp3': setup.expected_rr_tp3,
            'invalidation_price': setup.invalidation_price,
            'invalidation_condition': setup.invalidation_condition,
            'technical_reasons': setup.technical_reasons,
            'macro_reasons': setup.macro_reasons,
            'risk_reasons': setup.risk_reasons,
            'news_state': setup.news_state,
            'data_quality': setup.data_quality,
            'state': setup.state.value,
            'state_reason': setup.state_reason,
            'expires_at': setup.expires_at,
            'forecast_id': setup.forecast_id,
            'position_id': setup.position_id,
            'events': [
                {
                    'event_id': e.event_id,
                    'timestamp': e.timestamp,
                    'from_state': e.from_state.value if e.from_state else None,
                    'to_state': e.to_state.value,
                    'reason': e.reason,
                    'metadata': e.metadata,
                }
                for e in setup.events
            ],
        }
    
    def _emit_event(self, event_type: str, setup: SetupRecord):
        """Emit a setup event to all callbacks."""
        event = {
            'type': event_type,
            'timestamp': time.time(),
            'setup_id': setup.setup_id,
            'symbol': setup.symbol,
            'state': setup.state.value,
            'score': setup.score,
        }
        for callback in self._callbacks:
            try:
                callback(event)
            except Exception as e:
                log.error("Error in setup event callback: %s", e)
