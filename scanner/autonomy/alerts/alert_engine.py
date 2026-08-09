"""
Intelligent Alert Engine for Confluence X.

Provides deduplicated, state-aware alerts with configurable preferences.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional

log = logging.getLogger(__name__)


class AlertType(Enum):
    """Types of alerts."""
    INFO = 'info'
    WATCH = 'watch'
    ACTION = 'action'
    CRITICAL = 'critical'


class AlertSeverity(Enum):
    """Alert severity levels."""
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    CRITICAL = 'critical'


@dataclass
class Alert:
    """An alert record."""
    alert_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    alert_type: AlertType = AlertType.INFO
    severity: AlertSeverity = AlertSeverity.LOW
    symbol: str = ''
    setup_id: Optional[str] = None
    title: str = ''
    message: str = ''
    created_at: float = field(default_factory=time.time)
    expires_at: Optional[float] = None
    dedupe_key: str = ''
    metadata: dict = field(default_factory=dict)
    
    # Delivery status
    delivered_to: List[str] = field(default_factory=list)
    acknowledged: bool = False
    
    @property
    def is_expired(self) -> bool:
        """Check if alert has expired."""
        if self.expires_at is None:
            return False
        return time.time() > self.expires_at
    
    @property
    def age_minutes(self) -> float:
        """Age of alert in minutes."""
        return (time.time() - self.created_at) / 60


@dataclass
class AlertPreferences:
    """User alert preferences."""
    user_id: str
    minimum_score: int = 50
    symbols: List[str] = field(default_factory=list)
    asset_classes: List[str] = field(default_factory=list)
    sessions: List[str] = field(default_factory=list)
    severity: List[str] = field(default_factory=lambda: ['low', 'medium', 'high', 'critical'])
    quiet_hours_start: Optional[int] = None  # 0-23
    quiet_hours_end: Optional[int] = None
    news_alerts: bool = True
    setup_alerts: bool = True
    position_alerts: bool = True


class AlertEngine:
    """
    Intelligent Alert Engine.
    
    Provides deduplicated, state-aware alerts with configurable preferences.
    """
    
    def __init__(self, deduplication_minutes: int = 60):
        self._alerts: List[Alert] = []
        self._alert_history: Dict[str, List[Alert]] = {}  # dedupe_key -> [alerts]
        self._preferences: Dict[str, AlertPreferences] = {}
        self._callbacks: List[Callable] = []
        self._deduplication_minutes = deduplication_minutes
    
    def register_callback(self, callback: Callable):
        """Register a callback for alert delivery."""
        self._callbacks.append(callback)
    
    def set_preferences(self, user_id: str, preferences: AlertPreferences):
        """Set alert preferences for a user."""
        self._preferences[user_id] = preferences
    
    def create_alert(self, alert_type: AlertType, severity: AlertSeverity,
                     symbol: str, title: str, message: str,
                     setup_id: Optional[str] = None,
                     dedupe_key: Optional[str] = None,
                     expires_in_minutes: Optional[int] = None,
                     **metadata) -> Optional[Alert]:
        """Create a new alert with deduplication."""
        
        # Generate dedupe key if not provided
        if dedupe_key is None:
            dedupe_key = f"{alert_type.value}:{symbol}:{title}"
        
        # Check for duplicate
        if self._is_duplicate(dedupe_key):
            log.debug("Alert suppressed (duplicate): %s", dedupe_key)
            return None
        
        # Create alert
        alert = Alert(
            alert_type=alert_type,
            severity=severity,
            symbol=symbol,
            setup_id=setup_id,
            title=title,
            message=message,
            dedupe_key=dedupe_key,
            metadata=metadata,
            expires_at=time.time() + (expires_in_minutes * 60) if expires_in_minutes else None,
        )
        
        # Store alert
        self._alerts.append(alert)
        
        # Store in history
        if dedupe_key not in self._alert_history:
            self._alert_history[dedupe_key] = []
        self._alert_history[dedupe_key].append(alert)
        
        log.info("Alert created: %s [%s] %s - %s", 
                alert.alert_id, alert_type.value, symbol, title)
        
        # Deliver to registered callbacks (Telegram, push, etc.)
        self._emit_alert(alert)
        
        return alert
    
    def _is_duplicate(self, dedupe_key: str) -> bool:
        """Check if an alert is a duplicate within the deduplication window."""
        if dedupe_key not in self._alert_history:
            return False
        
        recent_alerts = self._alert_history[dedupe_key]
        cutoff = time.time() - (self._deduplication_minutes * 60)
        
        # Check if any recent alert has the same key
        for alert in recent_alerts:
            if alert.created_at > cutoff:
                return True
        
        return False
    
    def get_active_alerts(self, symbol: Optional[str] = None,
                          alert_type: Optional[AlertType] = None) -> List[Alert]:
        """Get active (non-expired) alerts."""
        active = []
        
        for alert in self._alerts:
            if alert.is_expired:
                continue
            
            if symbol and alert.symbol != symbol:
                continue
            
            if alert_type and alert.alert_type != alert_type:
                continue
            
            active.append(alert)
        
        return sorted(active, key=lambda a: a.created_at, reverse=True)
    
    def get_alerts_for_user(self, user_id: str) -> List[Alert]:
        """Get alerts filtered by user preferences."""
        prefs = self._preferences.get(user_id)
        if not prefs:
            return self.get_active_alerts()
        
        alerts = []
        for alert in self.get_active_alerts():
            # Check symbol filter
            if prefs.symbols and alert.symbol not in prefs.symbols:
                continue
            
            # Check severity filter
            if alert.severity.value not in prefs.severity:
                continue
            
            # Check quiet hours
            if prefs.quiet_hours_start is not None and prefs.quiet_hours_end is not None:
                current_hour = int(time.time() % 86400 / 3600)
                if prefs.quiet_hours_start <= current_hour <= prefs.quiet_hours_end:
                    if alert.alert_type != AlertType.CRITICAL:
                        continue
            
            alerts.append(alert)
        
        return alerts
    
    def acknowledge_alert(self, alert_id: str) -> bool:
        """Acknowledge an alert."""
        for alert in self._alerts:
            if alert.alert_id == alert_id:
                alert.acknowledged = True
                log.info("Alert acknowledged: %s", alert_id)
                return True
        return False
    
    def cleanup_expired(self) -> int:
        """Remove expired alerts."""
        initial_count = len(self._alerts)
        self._alerts = [a for a in self._alerts if not a.is_expired]
        removed = initial_count - len(self._alerts)
        
        if removed > 0:
            log.info("Cleaned up %d expired alerts", removed)
        
        return removed
    
    def get_alert_stats(self) -> dict:
        """Get alert statistics."""
        active = self.get_active_alerts()
        
        by_type = {}
        for alert in active:
            by_type[alert.alert_type.value] = by_type.get(alert.alert_type.value, 0) + 1
        
        by_severity = {}
        for alert in active:
            by_severity[alert.severity.value] = by_severity.get(alert.severity.value, 0) + 1
        
        return {
            'total_active': len(active),
            'by_type': by_type,
            'by_severity': by_severity,
            'acknowledged': sum(1 for a in active if a.acknowledged),
            'unacknowledged': sum(1 for a in active if not a.acknowledged),
        }
    
    def _emit_alert(self, alert: Alert):
        """Emit alert to all callbacks."""
        for callback in self._callbacks:
            try:
                callback(alert)
            except Exception as e:
                log.error("Error in alert callback: %s", e)
