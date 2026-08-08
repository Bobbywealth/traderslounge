"""
Broker Adapter Interface for Confluence X.

Defines the standard interface for all broker implementations.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class BrokerStatus(Enum):
    """Broker connection status."""
    DISCONNECTED = 'disconnected'
    CONNECTING = 'connecting'
    CONNECTED = 'connected'
    ERROR = 'error'


@dataclass
class BrokerConfig:
    """Broker configuration."""
    broker_type: str = 'paper'  # paper, demo, live
    api_key: str = ''
    api_secret: str = ''
    account_id: str = ''
    is_demo: bool = True
    base_url: str = ''


class BrokerAdapter(ABC):
    """Abstract broker adapter interface."""
    
    @abstractmethod
    def connect(self) -> bool:
        """Connect to broker."""
        pass
    
    @abstractmethod
    def disconnect(self):
        """Disconnect from broker."""
        pass
    
    @abstractmethod
    def get_status(self) -> BrokerStatus:
        """Get connection status."""
        pass
    
    @abstractmethod
    def place_market_order(self, symbol: str, direction: str, quantity: float,
                           stop_loss: float = 0.0, take_profit: float = 0.0) -> dict:
        """Place a market order."""
        pass
    
    @abstractmethod
    def place_limit_order(self, symbol: str, direction: str, quantity: float,
                         price: float, stop_loss: float = 0.0, 
                         take_profit: float = 0.0) -> dict:
        """Place a limit order."""
        pass
    
    @abstractmethod
    def modify_stop_loss(self, position_id: str, new_stop: float) -> bool:
        """Modify stop loss."""
        pass
    
    @abstractmethod
    def close_position(self, position_id: str, quantity: float = 0.0) -> bool:
        """Close a position."""
        pass
    
    @abstractmethod
    def get_positions(self) -> List[dict]:
        """Get all open positions."""
        pass
    
    @abstractmethod
    def get_account(self) -> dict:
        """Get account information."""
        pass
    
    @abstractmethod
    def get_positions_from_broker(self) -> List[dict]:
        """Get positions directly from broker (for reconciliation)."""
        pass
