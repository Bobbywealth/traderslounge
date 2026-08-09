"""
Breaking News Safety Architecture for Confluence X.

Safe handling of unexpected market-moving headlines.

Key safety rule: LLM headline classification NEVER directly triggers
broker orders. Breaking news can only:
1. Create CRITICAL alerts
2. Change risk state to BLOCKED
3. Temporarily block new trades
4. Trigger manual review policy

The decision to close existing positions requires explicit human or
deterministic-system approval, never raw LLM output.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

log = logging.getLogger(__name__)


class BreakingNewsSeverity(Enum):
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    CRITICAL = 'critical'


class BreakingNewsAction(Enum):
    ALERT_ONLY = 'alert_only'           # Just notify
    BLOCK_NEW_TRADES = 'block_new_trades'  # Block new entries
    MANUAL_REVIEW = 'manual_review'     # Require human review
    NO_ACTION = 'no_action'             # Ignore


@dataclass
class BreakingNewsEvent:
    """A breaking news event."""
    event_id: str
    headline: str
    severity: BreakingNewsSeverity
    action: BreakingNewsAction
    affected_symbols: List[str] = field(default_factory=list)
    detected_at: float = field(default_factory=time.time)
    expires_at: Optional[float] = None
    source: str = ''
    reason: str = ''  # Why this was classified as breaking

    @property
    def is_active(self) -> bool:
        if self.expires_at is None:
            return True
        return time.time() < self.expires_at

    def to_dict(self) -> dict:
        return {
            'event_id': self.event_id,
            'headline': self.headline,
            'severity': self.severity.value,
            'action': self.action.value,
            'affected_symbols': self.affected_symbols,
            'detected_at': self.detected_at,
            'expires_at': self.expires_at,
            'source': self.source,
            'reason': self.reason,
            'is_active': self.is_active,
        }


class BreakingNewsManager:
    """
    Breaking news safety manager.

    Manages unexpected market-moving headlines with conservative safety rules.
    """

    def __init__(self, default_block_minutes: int = 30):
        self._events: List[BreakingNewsEvent] = []
        self._default_block_minutes = default_block_minutes

    def register_breaking_news(
        self,
        headline: str,
        severity: BreakingNewsSeverity = BreakingNewsSeverity.HIGH,
        affected_symbols: List[str] = None,
        source: str = '',
        reason: str = '',
    ) -> BreakingNewsEvent:
        """Register a breaking news event."""
        # Determine action based on severity
        if severity == BreakingNewsSeverity.CRITICAL:
            action = BreakingNewsAction.MANUAL_REVIEW
        elif severity == BreakingNewsSeverity.HIGH:
            action = BreakingNewsAction.BLOCK_NEW_TRADES
        elif severity == BreakingNewsSeverity.MEDIUM:
            action = BreakingNewsAction.ALERT_ONLY
        else:
            action = BreakingNewsAction.NO_ACTION

        event = BreakingNewsEvent(
            event_id=f"BN-{int(time.time())}",
            headline=headline,
            severity=severity,
            action=action,
            affected_symbols=affected_symbols or [],
            source=source,
            reason=reason,
            expires_at=time.time() + (self._default_block_minutes * 60),
        )

        self._events.append(event)
        log.warning("BREAKING NEWS [%s]: %s → %s", severity.value, headline[:80], action.value)
        return event

    def is_blocked(self, symbol: str = '') -> bool:
        """Check if any active breaking news blocks trading for a symbol."""
        for event in self._events:
            if not event.is_active:
                continue
            if event.action in (BreakingNewsAction.BLOCK_NEW_TRADES, BreakingNewsAction.MANUAL_REVIEW):
                if not event.affected_symbols or symbol in event.affected_symbols:
                    return True
        return False

    def get_active_events(self) -> List[BreakingNewsEvent]:
        """Get all active breaking news events."""
        return [e for e in self._events if e.is_active]

    def get_block_reason(self, symbol: str) -> Optional[str]:
        """Get the reason why a symbol is blocked."""
        for event in self._events:
            if not event.is_active:
                continue
            if event.action in (BreakingNewsAction.BLOCK_NEW_TRADES, BreakingNewsAction.MANUAL_REVIEW):
                if not event.affected_symbols or symbol in event.affected_symbols:
                    return f"BREAKING: {event.headline[:60]}"
        return None

    def cleanup_expired(self) -> int:
        """Remove expired events."""
        before = len(self._events)
        self._events = [e for e in self._events if e.is_active]
        return before - len(self._events)
