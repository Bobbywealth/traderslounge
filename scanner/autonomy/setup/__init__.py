"""
Setup Lifecycle Engine for Confluence X.

Manages the lifecycle of trading setups from detection to resolution.
"""
from .setup_lifecycle import SetupLifecycle, SetupRecord, SetupState

__all__ = [
    'SetupLifecycle',
    'SetupRecord',
    'SetupState',
]
