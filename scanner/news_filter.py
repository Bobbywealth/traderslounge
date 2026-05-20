"""News filter — blocks trades around high-impact news events.

Step 2 ships a config-driven stub: callers can register blackout windows
manually (per-pair or global) and the filter says yes/no. Step 3 will
swap the backing store for live ForexFactory data.
"""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class NewsEvent:
    """A high-impact news event."""
    pair: str          # "*" for global (USD-wide) events
    when: _dt.datetime  # event time (UTC)
    impact: str = "high"
    title: str = ""


@dataclass
class NewsFilter:
    blackout_minutes: int = 15
    events: List[NewsEvent] = field(default_factory=list)

    def add(self, event: NewsEvent) -> None:
        self.events.append(event)

    def is_blacked_out(self, pair: str, now: Optional[_dt.datetime] = None) -> Optional[NewsEvent]:
        """Return the conflicting event if `pair` is currently in a blackout window,
        else None."""
        now = now or _dt.datetime.now(_dt.timezone.utc)
        window = _dt.timedelta(minutes=self.blackout_minutes)
        for ev in self.events:
            if ev.pair not in ("*", pair):
                continue
            if ev.when - window <= now <= ev.when + window:
                return ev
        return None
