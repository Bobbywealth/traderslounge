"""
Broker Reconciliation Engine for Confluence X.

Verifies consistency between local state and broker state.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


class ReconciliationStatus(Enum):
    """Reconciliation status."""
    CLEAN = 'clean'
    MISMATCH = 'mismatch'
    ERROR = 'error'


@dataclass
class ReconciliationResult:
    """Result of reconciliation."""
    status: ReconciliationStatus
    local_positions: int
    broker_positions: int
    orphaned_local: List[str]  # In local but not broker
    orphaned_broker: List[str]  # In broker but not local
    mismatches: List[dict]  # Position mismatches
    timestamp: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            'status': self.status.value,
            'local_positions': self.local_positions,
            'broker_positions': self.broker_positions,
            'orphaned_local': self.orphaned_local,
            'orphaned_broker': self.orphaned_broker,
            'mismatches': self.mismatches,
            'timestamp': self.timestamp,
        }


class ReconciliationEngine:
    """
    Broker Reconciliation Engine.
    
    Verifies consistency between local state and broker state.
    """
    
    def __init__(self):
        self._last_reconciliation: Optional[ReconciliationResult] = None
    
    def reconcile(self, local_positions: List[dict], 
                  broker_positions: List[dict]) -> ReconciliationResult:
        """Reconcile local positions with broker positions."""
        
        # Index positions by ID
        local_by_id = {p.get('position_id', p.get('id', '')): p for p in local_positions}
        broker_by_id = {p.get('position_id', p.get('id', '')): p for p in broker_positions}
        
        local_ids = set(local_by_id.keys())
        broker_ids = set(broker_by_id.keys())
        
        # Find orphans
        orphaned_local = list(local_ids - broker_ids)
        orphaned_broker = list(broker_ids - local_ids)
        
        # Check common positions for mismatches
        common_ids = local_ids & broker_ids
        mismatches = []
        
        for pos_id in common_ids:
            local = local_by_id[pos_id]
            broker = broker_by_id[pos_id]
            
            # Check for mismatches
            position_mismatches = []
            
            if local.get('direction') != broker.get('direction'):
                position_mismatches.append({
                    'field': 'direction',
                    'local': local.get('direction'),
                    'broker': broker.get('direction'),
                })
            
            if abs(local.get('quantity', 0) - broker.get('quantity', 0)) > 0.0001:
                position_mismatches.append({
                    'field': 'quantity',
                    'local': local.get('quantity'),
                    'broker': broker.get('quantity'),
                })
            
            if abs(local.get('entry_price', 0) - broker.get('entry_price', 0)) > 0.0001:
                position_mismatches.append({
                    'field': 'entry_price',
                    'local': local.get('entry_price'),
                    'broker': broker.get('entry_price'),
                })
            
            if position_mismatches:
                mismatches.append({
                    'position_id': pos_id,
                    'symbol': local.get('symbol', broker.get('symbol')),
                    'mismatches': position_mismatches,
                })
        
        # Determine status
        if orphaned_local or orphaned_broker or mismatches:
            status = ReconciliationStatus.MISMATCH
        else:
            status = ReconciliationStatus.CLEAN
        
        result = ReconciliationResult(
            status=status,
            local_positions=len(local_positions),
            broker_positions=len(broker_positions),
            orphaned_local=orphaned_local,
            orphaned_broker=orphaned_broker,
            mismatches=mismatches,
            timestamp=time.time(),
        )
        
        self._last_reconciliation = result
        
        # Log results
        if status == ReconciliationStatus.CLEAN:
            log.info("Reconciliation clean: %d positions match", len(common_ids))
        else:
            log.warning(
                "Reconciliation mismatch: %d orphaned local, %d orphaned broker, %d mismatches",
                len(orphaned_local), len(orphaned_broker), len(mismatches)
            )
        
        return result
    
    def get_last_reconciliation(self) -> Optional[ReconciliationResult]:
        """Get the last reconciliation result."""
        return self._last_reconciliation
    
    def should_block_trading(self, result: ReconciliationResult) -> bool:
        """Determine if trading should be blocked based on reconciliation."""
        # Block if there are orphaned positions (could be dangerous)
        if result.orphaned_local or result.orphaned_broker:
            return True
        
        # Block if there are critical mismatches (quantity, direction)
        for mismatch in result.mismatches:
            for m in mismatch.get('mismatches', []):
                if m.get('field') in ('quantity', 'direction'):
                    return True
        
        return False
