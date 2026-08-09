"""
Broker Integration for Confluence X.

Provides:
- Demo broker adapter
- Sandbox testing
- Broker reconciliation
"""
from .broker_adapter import BrokerAdapter, BrokerConfig, BrokerStatus
from .demo_broker import DemoBrokerAdapter
from .reconciliation import ReconciliationEngine
from .instrument_spec import InstrumentSpec, get_spec, DEFAULT_SPECS

__all__ = [
    'BrokerAdapter',
    'BrokerConfig', 
    'BrokerStatus',
    'DemoBrokerAdapter',
    'ReconciliationEngine',
    'InstrumentSpec',
    'get_spec',
    'DEFAULT_SPECS',
]
