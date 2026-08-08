"""
Demo Broker Adapter for Confluence X.

Simulates a broker for testing without real money.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .broker_adapter import BrokerAdapter, BrokerStatus

log = logging.getLogger(__name__)


@dataclass
class DemoPosition:
    """Demo broker position."""
    position_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    symbol: str = ''
    direction: str = 'BUY'
    quantity: float = 0.0
    entry_price: float = 0.0
    current_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0
    opened_at: float = field(default_factory=time.time)
    is_open: bool = True


class DemoBrokerAdapter(BrokerAdapter):
    """
    Demo Broker Adapter.
    
    Simulates broker behavior for testing.
    """
    
    def __init__(self, initial_balance: float = 10000.0):
        self._balance = initial_balance
        self._initial_balance = initial_balance
        self._positions: Dict[str, DemoPosition] = {}
        self._status = BrokerStatus.DISCONNECTED
        self._current_prices: Dict[str, float] = {}
    
    def connect(self) -> bool:
        """Connect to demo broker."""
        self._status = BrokerStatus.CONNECTED
        log.info("Connected to demo broker")
        return True
    
    def disconnect(self):
        """Disconnect from demo broker."""
        self._status = BrokerStatus.DISCONNECTED
        log.info("Disconnected from demo broker")
    
    def get_status(self) -> BrokerStatus:
        """Get connection status."""
        return self._status
    
    def place_market_order(self, symbol: str, direction: str, quantity: float,
                           stop_loss: float = 0.0, take_profit: float = 0.0) -> dict:
        """Place a market order."""
        if self._status != BrokerStatus.CONNECTED:
            return {'success': False, 'error': 'Not connected'}
        
        current_price = self._current_prices.get(symbol, 0)
        if current_price <= 0:
            return {'success': False, 'error': f'No price for {symbol}'}
        
        # Create position
        position = DemoPosition(
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            entry_price=current_price,
            current_price=current_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
        )
        
        self._positions[position.position_id] = position
        
        log.info("Demo order filled: %s %s %.5f @ %.5f", 
                direction, symbol, quantity, current_price)
        
        return {
            'success': True,
            'position_id': position.position_id,
            'entry_price': current_price,
            'quantity': quantity,
        }
    
    def place_limit_order(self, symbol: str, direction: str, quantity: float,
                         price: float, stop_loss: float = 0.0, 
                         take_profit: float = 0.0) -> dict:
        """Place a limit order."""
        # For demo, treat as market order
        return self.place_market_order(symbol, direction, quantity, stop_loss, take_profit)
    
    def modify_stop_loss(self, position_id: str, new_stop: float) -> bool:
        """Modify stop loss."""
        position = self._positions.get(position_id)
        if not position or not position.is_open:
            return False
        
        position.stop_loss = new_stop
        log.info("Demo SL modified: %s -> %.5f", position_id, new_stop)
        return True
    
    def close_position(self, position_id: str, quantity: float = 0.0) -> bool:
        """Close a position."""
        position = self._positions.get(position_id)
        if not position or not position.is_open:
            return False
        
        # Calculate P&L
        if position.direction == 'BUY':
            pnl = (position.current_price - position.entry_price) * position.quantity
        else:
            pnl = (position.entry_price - position.current_price) * position.quantity
        
        self._balance += pnl
        position.is_open = False
        
        log.info("Demo position closed: %s, PnL: $%.2f", position_id, pnl)
        
        return True
    
    def get_positions(self) -> List[dict]:
        """Get all open positions."""
        return [
            {
                'position_id': p.position_id,
                'symbol': p.symbol,
                'direction': p.direction,
                'quantity': p.quantity,
                'entry_price': p.entry_price,
                'current_price': p.current_price,
                'stop_loss': p.stop_loss,
                'take_profit': p.take_profit,
                'is_open': p.is_open,
            }
            for p in self._positions.values()
            if p.is_open
        ]
    
    def get_account(self) -> dict:
        """Get account information."""
        return {
            'balance': self._balance,
            'equity': self._balance,
            'margin_used': 0,
            'free_margin': self._balance,
            'open_positions': len([p for p in self._positions.values() if p.is_open]),
        }
    
    def get_positions_from_broker(self) -> List[dict]:
        """Get positions directly from broker (for reconciliation)."""
        return self.get_positions()
    
    def update_price(self, symbol: str, price: float):
        """Update current price."""
        self._current_prices[symbol] = price
