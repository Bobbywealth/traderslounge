"""
News & Macroeconomic Intelligence Engine for Confluence X.

Provides economic calendar integration, news risk assessment,
and trading gate decisions.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class EventImpact(Enum):
    """Economic event impact level."""
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    CRITICAL = 'critical'


class NewsRiskStatus(Enum):
    """News risk status for trading."""
    CLEAR = 'CLEAR'
    CAUTION = 'CAUTION'
    BLOCKED = 'BLOCKED'
    POST_NEWS = 'POST_NEWS'
    UNAVAILABLE = 'UNAVAILABLE'


@dataclass
class EconomicEvent:
    """An economic calendar event."""
    event_id: str
    title: str
    country: str
    currency: str
    timestamp: float  # epoch
    impact: EventImpact
    forecast: Optional[str] = None
    previous: Optional[str] = None
    actual: Optional[str] = None
    source: str = ''
    affected_symbols: List[str] = field(default_factory=list)
    status: str = 'upcoming'  # upcoming, released, expired
    
    @property
    def minutes_until(self) -> float:
        """Minutes until event."""
        return (self.timestamp - time.time()) / 60
    
    @property
    def is_imminent(self, minutes: int = 15) -> bool:
        """Check if event is within N minutes."""
        return 0 < self.minutes_until <= minutes
    
    @property
    def has_passed(self) -> bool:
        """Check if event has passed."""
        return time.time() > self.timestamp


@dataclass
class SymbolNewsRisk:
    """News risk assessment for a symbol."""
    symbol: str
    status: NewsRiskStatus
    next_event: Optional[EconomicEvent] = None
    minutes_to_event: Optional[float] = None
    event_title: Optional[str] = None
    event_impact: Optional[EventImpact] = None
    reason_code: str = ''
    blacked_out_until: Optional[float] = None
    
    def to_dict(self) -> dict:
        return {
            'symbol': self.symbol,
            'status': self.status.value,
            'next_event': {
                'event_id': self.next_event.event_id,
                'title': self.next_event.title,
                'impact': self.next_event.impact.value,
                'timestamp': self.next_event.timestamp,
                'minutes_until': self.next_event.minutes_until,
            } if self.next_event else None,
            'minutes_to_event': self.minutes_to_event,
            'event_title': self.event_title,
            'event_impact': self.event_impact.value if self.event_impact else None,
            'reason_code': self.reason_code,
            'blacked_out_until': self.blacked_out_until,
        }


class NewsEngine:
    """
    News & Macroeconomic Intelligence Engine.
    
    Manages economic events, assesses news risk, and makes trading gate decisions.
    """
    
    def __init__(self, 
                 high_impact_pre_minutes: int = 15,
                 high_impact_post_minutes: int = 10,
                 medium_impact_pre_minutes: int = 5,
                 medium_impact_post_minutes: int = 5):
        self._events: Dict[str, EconomicEvent] = {}
        self._symbol_currencies: Dict[str, List[str]] = {}
        
        # Configurable blackout windows
        self.high_impact_pre_minutes = high_impact_pre_minutes
        self.high_impact_post_minutes = high_impact_post_minutes
        self.medium_impact_pre_minutes = medium_impact_pre_minutes
        self.medium_impact_post_minutes = medium_impact_post_minutes
        
        # Default currency mappings
        self._init_currency_mappings()
    
    def _init_currency_mappings(self):
        """Initialize symbol to currency mappings."""
        self._symbol_currencies = {
            'EURUSD': ['EUR', 'USD'],
            'GBPUSD': ['GBP', 'USD'],
            'USDJPY': ['USD', 'JPY'],
            'AUDUSD': ['AUD', 'USD'],
            'USDCAD': ['USD', 'CAD'],
            'USDCHF': ['USD', 'CHF'],
            'NZDUSD': ['NZD', 'USD'],
            'XAUUSD': ['XAU', 'USD'],
            'XAGUSD': ['XAG', 'USD'],
            'BTCUSD': ['BTC', 'USD'],
            'ETHUSD': ['ETH', 'USD'],
            'US30': ['USD'],
            'NAS100': ['USD'],
            'SPX500': ['USD'],
        }
    
    def add_event(self, event: EconomicEvent):
        """Add an economic event."""
        self._events[event.event_id] = event
        log.info("Added event: %s (%s, %s, %s)", 
                event.title, event.currency, event.impact.value, 
                datetime.fromtimestamp(event.timestamp, tz=timezone.utc).isoformat())
    
    def add_events(self, events: List[EconomicEvent]):
        """Add multiple economic events."""
        for event in events:
            self.add_event(event)
    
    def get_upcoming_events(self, minutes_ahead: int = 60) -> List[EconomicEvent]:
        """Get events within N minutes."""
        now = time.time()
        upcoming = []
        
        for event in self._events.values():
            if event.has_passed:
                continue
            
            minutes_until = event.minutes_until
            if 0 < minutes_until <= minutes_ahead:
                upcoming.append(event)
        
        return sorted(upcoming, key=lambda e: e.timestamp)
    
    def get_events_for_symbol(self, symbol: str, 
                              minutes_ahead: int = 120) -> List[EconomicEvent]:
        """Get events affecting a specific symbol."""
        currencies = self._symbol_currencies.get(symbol, [])
        if not currencies:
            return []
        
        now = time.time()
        relevant = []
        
        for event in self._events.values():
            if event.has_passed:
                continue
            
            if event.currency in currencies:
                minutes_until = event.minutes_until
                if 0 < minutes_until <= minutes_ahead:
                    relevant.append(event)
        
        return sorted(relevant, key=lambda e: e.timestamp)
    
    def assess_risk(self, symbol: str, 
                    pre_minutes: Optional[int] = None,
                    post_minutes: Optional[int] = None) -> SymbolNewsRisk:
        """Assess news risk for a symbol."""
        currencies = self._symbol_currencies.get(symbol, [])
        
        # Find next high-impact event
        next_high_impact = None
        next_medium_impact = None
        
        for event in self._events.values():
            if event.has_passed:
                continue
            
            if event.currency not in currencies:
                continue
            
            if event.impact == EventImpact.HIGH or event.impact == EventImpact.CRITICAL:
                if next_high_impact is None or event.timestamp < next_high_impact.timestamp:
                    next_high_impact = event
            elif event.impact == EventImpact.MEDIUM:
                if next_medium_impact is None or event.timestamp < next_medium_impact.timestamp:
                    next_medium_impact = event
        
        # Determine risk status
        now = time.time()
        
        # Check high-impact event
        if next_high_impact:
            minutes_until = next_high_impact.minutes_until
            pre = pre_minutes or self.high_impact_pre_minutes
            post = post_minutes or self.high_impact_post_minutes
            
            # Check if in blackout window
            if 0 < minutes_until <= pre:
                return SymbolNewsRisk(
                    symbol=symbol,
                    status=NewsRiskStatus.BLOCKED,
                    next_event=next_high_impact,
                    minutes_to_event=minutes_until,
                    event_title=next_high_impact.title,
                    event_impact=next_high_impact.impact,
                    reason_code='PRE_EVENT_BLACKOUT',
                    blacked_out_until=next_high_impact.timestamp + (post * 60),
                )
            
            # Check if in post-event cooldown
            if -post <= minutes_until <= 0:
                return SymbolNewsRisk(
                    symbol=symbol,
                    status=NewsRiskStatus.POST_NEWS,
                    next_event=next_high_impact,
                    minutes_to_event=minutes_until,
                    event_title=next_high_impact.title,
                    event_impact=next_high_impact.impact,
                    reason_code='POST_EVENT_COOLDOWN',
                    blacked_out_until=next_high_impact.timestamp + (post * 60),
                )
        
        # Check medium-impact event
        if next_medium_impact:
            minutes_until = next_medium_impact.minutes_until
            pre = self.medium_impact_pre_minutes
            post = self.medium_impact_post_minutes
            
            if 0 < minutes_until <= pre:
                return SymbolNewsRisk(
                    symbol=symbol,
                    status=NewsRiskStatus.CAUTION,
                    next_event=next_medium_impact,
                    minutes_to_event=minutes_until,
                    event_title=next_medium_impact.title,
                    event_impact=next_medium_impact.impact,
                    reason_code='MEDIUM_PRE_EVENT',
                )
        
        # No imminent events
        return SymbolNewsRisk(
            symbol=symbol,
            status=NewsRiskStatus.CLEAR,
            next_event=next_high_impact or next_medium_impact,
            minutes_to_event=next_high_impact.minutes_until if next_high_impact else None,
            reason_code='NO_IMMINENT_EVENTS',
        )
    
    def get_global_status(self) -> dict:
        """Get global news status."""
        upcoming = self.get_upcoming_events(minutes_ahead=60)
        
        high_impact_count = sum(1 for e in upcoming 
                               if e.impact in (EventImpact.HIGH, EventImpact.CRITICAL))
        medium_impact_count = sum(1 for e in upcoming 
                                 if e.impact == EventImpact.MEDIUM)
        
        return {
            'total_upcoming': len(upcoming),
            'high_impact': high_impact_count,
            'medium_impact': medium_impact_count,
            'events': [
                {
                    'event_id': e.event_id,
                    'title': e.title,
                    'currency': e.currency,
                    'impact': e.impact.value,
                    'minutes_until': e.minutes_until,
                    'affected_symbols': e.affected_symbols,
                }
                for e in upcoming[:10]  # Limit to next 10
            ],
        }
    
    def mark_released(self, event_id: str, actual_value: str):
        """Mark an event as released with actual value."""
        if event_id in self._events:
            self._events[event_id].actual = actual_value
            self._events[event_id].status = 'released'
            log.info("Event released: %s (actual: %s)", event_id, actual_value)
    
    def cleanup_old_events(self, max_age_hours: int = 24):
        """Remove events older than max_age_hours."""
        cutoff = time.time() - (max_age_hours * 3600)
        old_ids = [
            eid for eid, event in self._events.items()
            if event.timestamp < cutoff
        ]
        for eid in old_ids:
            del self._events[eid]
        
        if old_ids:
            log.info("Cleaned up %d old events", len(old_ids))
