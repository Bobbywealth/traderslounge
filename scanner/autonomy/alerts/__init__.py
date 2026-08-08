"""
Intelligent Alert Engine for Confluence X.

Provides deduplicated, state-aware alerts with configurable preferences.
"""
from .alert_engine import AlertEngine, Alert, AlertType, AlertSeverity

__all__ = [
    'AlertEngine',
    'Alert',
    'AlertType',
    'AlertSeverity',
]
