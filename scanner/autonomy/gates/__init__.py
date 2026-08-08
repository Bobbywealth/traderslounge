"""
Live Execution Gates for Confluence X.

Safety gates that must pass before live trading is enabled.
"""
from .execution_gates import ExecutionGates, GateResult, GateStatus

__all__ = [
    'ExecutionGates',
    'GateResult',
    'GateStatus',
]
