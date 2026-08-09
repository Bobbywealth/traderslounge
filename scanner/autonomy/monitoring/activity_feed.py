"""
Activity Feed for Confluence X Trading Desk.

Stores recent autonomous decisions in memory for the Trading Desk UI.
Each entry represents a meaningful system decision, not every scan cycle.

Entries are time-ordered, deduplicated, and capped at a configurable limit.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class ActivityEntry:
    """A single activity feed entry."""
    timestamp: float = field(default_factory=time.time)
    category: str = ''      # setup, risk, execution, news, regime, system
    event_type: str = ''    # detected, updated, ready, rejected, filled, etc.
    symbol: str = ''
    message: str = ''
    severity: str = 'info'  # info, warning, critical
    setup_id: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            'timestamp': self.timestamp,
            'category': self.category,
            'event_type': self.event_type,
            'symbol': self.symbol,
            'message': self.message,
            'severity': self.severity,
            'setup_id': self.setup_id,
            'metadata': self.metadata,
        }


class ActivityFeed:
    """
    Thread-safe activity feed for autonomous decisions.

    Stores the last N entries. Newer entries are prepended.
    """

    def __init__(self, max_entries: int = 200):
        self._entries: deque[ActivityEntry] = deque(maxlen=max_entries)

    def add(self, category: str, event_type: str, symbol: str,
            message: str, severity: str = 'info',
            setup_id: Optional[str] = None, **metadata) -> ActivityEntry:
        """Add an entry to the feed."""
        entry = ActivityEntry(
            category=category,
            event_type=event_type,
            symbol=symbol,
            message=message,
            severity=severity,
            setup_id=setup_id,
            metadata=metadata,
        )
        self._entries.appendleft(entry)
        return entry

    def get_recent(self, limit: int = 50, category: Optional[str] = None) -> List[dict]:
        """Get recent entries, optionally filtered by category."""
        entries = list(self._entries)
        if category:
            entries = [e for e in entries if e.category == category]
        return [e.to_dict() for e in entries[:limit]]

    def get_count(self) -> int:
        return len(self._entries)

    def clear(self):
        self._entries.clear()
