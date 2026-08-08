"""
Autonomy Status for Confluence X.

Tracks the health and state of all autonomous components.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional


class ComponentStatus(Enum):
    """Status of an autonomous component."""
    HEALTHY = 'healthy'
    DEGRADED = 'degraded'
    UNHEALTHY = 'unhealthy'
    DISABLED = 'disabled'
    UNKNOWN = 'unknown'


@dataclass
class WorkerHeartbeat:
    """Heartbeat from an autonomous worker."""
    worker_id: str
    last_heartbeat: float  # epoch timestamp
    status: ComponentStatus
    lag_seconds: float = 0.0
    version: str = ''
    message: str = ''
    
    @property
    def is_stale(self, max_lag: float = 60.0) -> bool:
        """Check if heartbeat is stale."""
        return self.lag_seconds > max_lag


@dataclass
class ProviderHealth:
    """Health status of a data provider."""
    provider_id: str
    status: ComponentStatus
    last_success: Optional[float] = None
    last_failure: Optional[float] = None
    error_count: int = 0
    latency_ms: float = 0.0
    message: str = ''


@dataclass
class SystemHealth:
    """Overall system health."""
    market_data: ComponentStatus = ComponentStatus.UNKNOWN
    database: ComponentStatus = ComponentStatus.UNKNOWN
    scanner: ComponentStatus = ComponentStatus.UNKNOWN
    news: ComponentStatus = ComponentStatus.UNKNOWN
    execution: ComponentStatus = ComponentStatus.UNKNOWN
    alerts: ComponentStatus = ComponentStatus.UNKNOWN
    kill_switch: ComponentStatus = ComponentStatus.UNKNOWN
    
    @property
    def overall(self) -> ComponentStatus:
        """Calculate overall system health."""
        statuses = [
            self.market_data,
            self.database,
            self.scanner,
            self.news,
            self.execution,
            self.alerts,
        ]
        
        if any(s == ComponentStatus.UNHEALTHY for s in statuses):
            return ComponentStatus.UNHEALTHY
        if any(s == ComponentStatus.DEGRADED for s in statuses):
            return ComponentStatus.DEGRADED
        if all(s == ComponentStatus.HEALTHY for s in statuses):
            return ComponentStatus.HEALTHY
        return ComponentStatus.UNKNOWN


@dataclass
class AutonomyStatus:
    """Complete autonomy status."""
    # Mode
    mode: str = 'intelligence'
    
    # System health
    health: SystemHealth = field(default_factory=SystemHealth)
    
    # Worker heartbeats
    heartbeats: Dict[str, WorkerHeartbeat] = field(default_factory=dict)
    
    # Provider health
    providers: Dict[str, ProviderHealth] = field(default_factory=dict)
    
    # Active counts
    active_setups: int = 0
    active_positions: int = 0
    pending_alerts: int = 0
    
    # Last scan
    last_scan_time: Optional[float] = None
    last_scan_duration_ms: float = 0.0
    instruments_scanned: int = 0
    
    # Timestamps
    started_at: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)
    
    def update_heartbeat(self, worker_id: str, status: ComponentStatus, 
                         version: str = '', message: str = ''):
        """Update a worker's heartbeat."""
        now = time.time()
        existing = self.heartbeats.get(worker_id)
        lag = now - existing.last_heartbeat if existing else 0.0
        
        self.heartbeats[worker_id] = WorkerHeartbeat(
            worker_id=worker_id,
            last_heartbeat=now,
            status=status,
            lag_seconds=lag,
            version=version,
            message=message,
        )
        self.last_updated = now
    
    def update_provider(self, provider_id: str, status: ComponentStatus,
                        latency_ms: float = 0.0, message: str = ''):
        """Update a provider's health."""
        existing = self.providers.get(provider_id)
        
        self.providers[provider_id] = ProviderHealth(
            provider_id=provider_id,
            status=status,
            last_success=time.time() if status == ComponentStatus.HEALTHY else 
                         (existing.last_success if existing else None),
            last_failure=time.time() if status == ComponentStatus.UNHEALTHY else
                        (existing.last_failure if existing else None),
            error_count=(existing.error_count + 1) if status == ComponentStatus.UNHEALTHY else 0,
            latency_ms=latency_ms,
            message=message,
        )
        self.last_updated = time.time()
    
    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            'mode': self.mode,
            'health': {
                'overall': self.health.overall.value,
                'market_data': self.health.market_data.value,
                'database': self.health.database.value,
                'scanner': self.health.scanner.value,
                'news': self.health.news.value,
                'execution': self.health.execution.value,
                'alerts': self.health.alerts.value,
                'kill_switch': self.health.kill_switch.value,
            },
            'heartbeats': {
                k: {
                    'worker_id': v.worker_id,
                    'last_heartbeat': v.last_heartbeat,
                    'status': v.status.value,
                    'lag_seconds': v.lag_seconds,
                    'version': v.version,
                    'message': v.message,
                }
                for k, v in self.heartbeats.items()
            },
            'providers': {
                k: {
                    'provider_id': v.provider_id,
                    'status': v.status.value,
                    'last_success': v.last_success,
                    'last_failure': v.last_failure,
                    'error_count': v.error_count,
                    'latency_ms': v.latency_ms,
                    'message': v.message,
                }
                for k, v in self.providers.items()
            },
            'active_setups': self.active_setups,
            'active_positions': self.active_positions,
            'pending_alerts': self.pending_alerts,
            'last_scan_time': self.last_scan_time,
            'last_scan_duration_ms': self.last_scan_duration_ms,
            'instruments_scanned': self.instruments_scanned,
            'started_at': self.started_at,
            'last_updated': self.last_updated,
        }


# Singleton
_status: Optional[AutonomyStatus] = None


def get_autonomy_status() -> AutonomyStatus:
    """Get or create the singleton AutonomyStatus."""
    global _status
    if _status is None:
        _status = AutonomyStatus()
    return _status
