"""Deterministic economic-calendar gate for scanner and API consumers."""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class NewsEvent:
    pair: str
    when: _dt.datetime
    impact: str = "high"
    title: str = ""
    currency: str = ""
    source: str = "forexfactory"

    def public(self) -> dict:
        return {
            "id": f"{self.source}:{self.currency}:{int(self.when.timestamp())}:{self.title}",
            "title": self.title,
            "currency": self.currency,
            "impact": self.impact,
            "scheduled_at": self.when.astimezone(_dt.timezone.utc).isoformat(),
            "source": self.source,
        }


@dataclass
class NewsFilter:
    blackout_minutes: int = 15
    caution_minutes: int = 60
    post_news_minutes: int = 30
    events: List[NewsEvent] = field(default_factory=list)
    source_health: str = "UNAVAILABLE"
    source_fetched_at: Optional[_dt.datetime] = None

    def add(self, event: NewsEvent) -> None:
        self.events.append(event)

    def relevant_events(self, pair: str) -> List[NewsEvent]:
        return sorted(
            (event for event in self.events if event.pair in ("*", pair)),
            key=lambda event: (event.when, event.title),
        )

    def evaluate(self, pair: str, now: Optional[_dt.datetime] = None) -> dict:
        now = now or _dt.datetime.now(_dt.timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=_dt.timezone.utc)
        relevant = self.relevant_events(pair)
        upcoming = [event for event in relevant if event.when >= now]
        recent = [event for event in relevant if event.when < now]
        next_event = upcoming[0] if upcoming else None
        previous_event = recent[-1] if recent else None

        status = "CLEAR"
        reason = "NO_RELEVANT_EVENT"
        active: Optional[NewsEvent] = None
        minutes: Optional[int] = None

        if previous_event:
            elapsed = (now - previous_event.when).total_seconds() / 60
            if elapsed <= self.post_news_minutes:
                status, reason, active = "POST_NEWS", "POST_EVENT_COOLDOWN", previous_event
                minutes = -round(elapsed)
        if next_event:
            until = (next_event.when - now).total_seconds() / 60
            if 0 <= until <= self.blackout_minutes:
                status, reason, active = "BLOCKED", "PRE_EVENT_BLACKOUT", next_event
                minutes = round(until)
            elif status == "CLEAR" and until <= self.caution_minutes:
                status, reason, active = "CAUTION", "UPCOMING_HIGH_IMPACT", next_event
                minutes = round(until)

        if self.source_health == "UNAVAILABLE" and not relevant:
            status, reason = "UNAVAILABLE", "SOURCE_UNAVAILABLE"

        return {
            "version": 1,
            "status": status,
            "evaluated_at": now.isoformat(),
            "symbol": pair,
            "source": "forexfactory",
            "source_health": self.source_health,
            "source_fetched_at": self.source_fetched_at.isoformat() if self.source_fetched_at else None,
            "event": active.public() if active else None,
            "next_event": next_event.public() if next_event else None,
            "minutes_to_event": minutes if active else (round((next_event.when - now).total_seconds() / 60) if next_event else None),
            "window": {
                "caution_before_minutes": self.caution_minutes,
                "block_before_minutes": self.blackout_minutes,
                "post_news_minutes": self.post_news_minutes,
            },
            "reason_code": reason,
        }

    def is_blacked_out(self, pair: str, now: Optional[_dt.datetime] = None) -> Optional[NewsEvent]:
        state = self.evaluate(pair, now)
        if state["status"] not in ("BLOCKED", "POST_NEWS"):
            return None
        event_id = state.get("event", {}).get("id") if state.get("event") else None
        return next((event for event in self.relevant_events(pair) if event.public()["id"] == event_id), None)

    def evaluate_global(self, now: Optional[_dt.datetime] = None) -> dict:
        now = now or _dt.datetime.now(_dt.timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=_dt.timezone.utc)

        upcoming = [event for event in self.events if event.when >= now]
        recent = [event for event in self.events if event.when < now]
        next_event = upcoming[0] if upcoming else None
        previous_event = recent[-1] if recent else None

        status = "CLEAR"
        active: Optional[NewsEvent] = None
        minutes: Optional[int] = None

        if previous_event:
            elapsed = (now - previous_event.when).total_seconds() / 60
            if elapsed <= self.post_news_minutes:
                status, active = "POST_NEWS", previous_event
                minutes = -round(elapsed)
        if next_event:
            until = (next_event.when - now).total_seconds() / 60
            if 0 <= until <= self.blackout_minutes:
                status, active = "BLOCKED", next_event
                minutes = round(until)
            elif status == "CLEAR" and until <= self.caution_minutes:
                status, active = "CAUTION", next_event
                minutes = round(until)

        if self.source_health == "UNAVAILABLE" and not self.events:
            status = "UNAVAILABLE"

        affected_symbols: List[str] = []
        if active:
            if active.pair == "*":
                affected_symbols = ["EURUSD", "GBPUSD", "XAUUSD", "NAS100"]
            else:
                affected_symbols = [active.pair]

        blackout_start = None
        blackout_end = None
        next_eligible_time = None
        if active and status == "BLOCKED":
            blackout_start = active.when.astimezone(_dt.timezone.utc)
            blackout_end = (active.when + _dt.timedelta(minutes=self.blackout_minutes)).astimezone(_dt.timezone.utc)
            next_eligible_time = blackout_end
        elif status == "POST_NEWS" and previous_event:
            next_eligible_time = (previous_event.when + _dt.timedelta(minutes=self.post_news_minutes)).astimezone(_dt.timezone.utc)

        return {
            "status": status,
            "event_title": active.title if active else None,
            "currency": active.currency if active else None,
            "impact": active.impact if active else None,
            "time_until_event_minutes": minutes,
            "blackout_start": blackout_start.isoformat() if blackout_start else None,
            "blackout_end": blackout_end.isoformat() if blackout_end else None,
            "affected_symbols": affected_symbols,
            "next_eligible_time": next_eligible_time.isoformat() if next_eligible_time else None,
            "existing_trades_affected": False,
            "source": "forexfactory",
            "source_health": self.source_health,
            "source_fetched_at": self.source_fetched_at.isoformat() if self.source_fetched_at else None,
            "event": active.public() if active else None,
            "next_event": next_event.public() if next_event else None,
            "window": {
                "caution_before_minutes": self.caution_minutes,
                "block_before_minutes": self.blackout_minutes,
                "post_news_minutes": self.post_news_minutes,
            },
        }
