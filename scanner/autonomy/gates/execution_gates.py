"""
Live Execution Gates for Confluence X.

Safety gates that must pass before live trading is enabled.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

log = logging.getLogger(__name__)


class GateStatus(Enum):
    """Gate check status."""
    PASSED = 'passed'
    FAILED = 'failed'
    SKIPPED = 'skipped'


@dataclass
class GateResult:
    """Result of a gate check."""
    gate_name: str
    status: GateStatus
    message: str = ''
    details: dict = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> dict:
        return {
            'gate_name': self.gate_name,
            'status': self.status.value,
            'message': self.message,
            'details': self.details,
            'timestamp': self.timestamp,
        }


class ExecutionGates:
    """
    Live Execution Gates.
    
    Safety gates that must pass before live trading is enabled.
    """
    
    def __init__(self):
        self._results: List[GateResult] = []
    
    def check_all_gates(self, 
                        test_suite_passing: bool = False,
                        restart_tested: bool = False,
                        idempotency_tested: bool = False,
                        risk_engine_verified: bool = False,
                        kill_switch_verified: bool = False,
                        reconciliation_verified: bool = False,
                        monitoring_verified: bool = False,
                        forward_performance_met: bool = False,
                        admin_activated: bool = False) -> List[GateResult]:
        """Check all execution gates."""
        self._results = []
        
        # Gate 1: Test Suite
        self._check_gate(
            'test_suite',
            test_suite_passing,
            'Automated test suite must pass',
            {'required': True}
        )
        
        # Gate 2: Restart Testing
        self._check_gate(
            'restart_testing',
            restart_tested,
            'System must survive restart without state loss',
            {'required': True}
        )
        
        # Gate 3: Idempotency
        self._check_gate(
            'idempotency',
            idempotency_tested,
            'Order execution must be idempotent',
            {'required': True}
        )
        
        # Gate 4: Risk Engine
        self._check_gate(
            'risk_engine',
            risk_engine_verified,
            'Risk engine must be verified and enforced',
            {'required': True}
        )
        
        # Gate 5: Kill Switch
        self._check_gate(
            'kill_switch',
            kill_switch_verified,
            'Kill switch must be functional and tested',
            {'required': True}
        )
        
        # Gate 6: Reconciliation
        self._check_gate(
            'reconciliation',
            reconciliation_verified,
            'Broker reconciliation must be verified',
            {'required': True}
        )
        
        # Gate 7: Monitoring
        self._check_gate(
            'monitoring',
            monitoring_verified,
            'System monitoring and alerts must be active',
            {'required': True}
        )
        
        # Gate 8: Forward Performance
        self._check_gate(
            'forward_performance',
            forward_performance_met,
            'Forward performance must meet minimum requirements',
            {'required': True, 'min_sample': 100}
        )
        
        # Gate 9: Admin Activation
        self._check_gate(
            'admin_activation',
            admin_activated,
            'Live mode must be explicitly enabled by admin',
            {'required': True}
        )
        
        return self._results
    
    def _check_gate(self, name: str, passed: bool, message: str, 
                    details: dict = None):
        """Check a single gate."""
        result = GateResult(
            gate_name=name,
            status=GateStatus.PASSED if passed else GateStatus.FAILED,
            message=message,
            details=details or {},
        )
        self._results.append(result)
        
        if passed:
            log.info("Gate PASSED: %s", name)
        else:
            log.warning("Gate FAILED: %s", name)
    
    def can_enable_live_trading(self) -> bool:
        """Check if all gates pass."""
        return all(r.status == GateStatus.PASSED for r in self._results)
    
    def get_failed_gates(self) -> List[GateResult]:
        """Get list of failed gates."""
        return [r for r in self._results if r.status == GateStatus.FAILED]
    
    def get_summary(self) -> dict:
        """Get gate check summary."""
        passed = sum(1 for r in self._results if r.status == GateStatus.PASSED)
        failed = sum(1 for r in self._results if r.status == GateStatus.FAILED)
        
        return {
            'total_gates': len(self._results),
            'passed': passed,
            'failed': failed,
            'can_enable_live': self.can_enable_live_trading(),
            'results': [r.to_dict() for r in self._results],
        }
