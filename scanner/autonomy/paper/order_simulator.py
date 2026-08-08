"""
Order Simulator for Confluence X Paper Trading.

Simulates order execution with realistic market conditions.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional

log = logging.getLogger(__name__)


class OrderType(Enum):
    """Order types."""
    MARKET = 'market'
    LIMIT = 'limit'
    STOP = 'stop'
    STOP_LIMIT = 'stop_limit'


class OrderStatus(Enum):
    """Order statuses."""
    PENDING = 'pending'
    FILLED = 'filled'
    PARTIALLY_FILLED = 'partially_filled'
    CANCELLED = 'cancelled'
    REJECTED = 'rejected'
    EXPIRED = 'expired'


@dataclass
class SimulationConfig:
    """Configuration for order simulation."""
    spread_pips: float = 1.0
    slippage_pips: float = 0.5
    commission_per_lot: float = 7.0
    reject_probability: float = 0.02  # 2% chance of rejection
    partial_fill_probability: float = 0.05  # 5% chance of partial fill
    latency_ms: float = 100.0  # Simulated latency


class OrderSimulator:
    """
    Order Simulator.
    
    Simulates order execution with realistic market conditions.
    """
    
    def __init__(self, config: Optional[SimulationConfig] = None):
        self._config = config or SimulationConfig()
    
    def simulate_fill(self, order_type: OrderType, direction: str,
                      quantity: float, current_price: float,
                      limit_price: float = 0.0, stop_price: float = 0.0,
                      pip_size: float = 0.0001) -> dict:
        """Simulate order fill with realistic conditions."""
        
        # Simulate latency
        time.sleep(self._config.latency_ms / 1000)
        
        # Check for rejection
        import random
        if random.random() < self._config.reject_probability:
            return {
                'status': OrderStatus.REJECTED,
                'reason': 'Simulated rejection - market conditions',
            }
        
        # Check if order should be filled
        should_fill = False
        fill_price = current_price
        
        if order_type == OrderType.MARKET:
            should_fill = True
            fill_price = current_price
        
        elif order_type == OrderType.LIMIT:
            if direction == 'BUY' and current_price <= limit_price:
                should_fill = True
                fill_price = limit_price
            elif direction == 'SELL' and current_price >= limit_price:
                should_fill = True
                fill_price = limit_price
        
        elif order_type == OrderType.STOP:
            if direction == 'BUY' and current_price >= stop_price:
                should_fill = True
                fill_price = stop_price
            elif direction == 'SELL' and current_price <= stop_price:
                should_fill = True
                fill_price = stop_price
        
        if not should_fill:
            return {
                'status': OrderStatus.PENDING,
                'reason': 'Order not yet triggered',
            }
        
        # Apply spread
        spread = self._config.spread_pips * pip_size
        if direction == 'BUY':
            fill_price += spread / 2
        else:
            fill_price -= spread / 2
        
        # Apply slippage
        slippage = self._config.slippage_pips * pip_size
        if direction == 'BUY':
            fill_price += slippage
        else:
            fill_price -= slippage
        
        # Check for partial fill
        filled_quantity = quantity
        if random.random() < self._config.partial_fill_probability:
            filled_quantity = quantity * random.uniform(0.5, 0.9)
        
        # Calculate commission
        commission = self._config.commission_per_lot * (filled_quantity / 100000)
        
        return {
            'status': OrderStatus.FILLED if filled_quantity >= quantity else OrderStatus.PARTIALLY_FILLED,
            'filled_quantity': filled_quantity,
            'fill_price': fill_price,
            'spread_pips': self._config.spread_pips,
            'slippage_pips': self._config.slippage_pips,
            'commission': commission,
            'timestamp': time.time(),
        }
    
    def check_pending_orders(self, symbol: str, current_price: float,
                             pip_size: float = 0.0001) -> list:
        """Check pending orders for fill conditions."""
        # This would be called with the order book
        # Returns list of orders that should be filled
        return []
