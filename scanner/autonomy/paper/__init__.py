"""
Paper Trading Engine for Confluence X.

Realistic paper broker simulation with:
- Market/limit/stop orders
- Spread, slippage, commissions
- Partial fills
- TP/SL management
- Break-even movement
- Trailing stops
- Position reconciliation
"""
from .paper_broker import PaperBrokerAdapter, PaperOrder, PaperPosition
from .order_simulator import OrderSimulator, OrderType, OrderStatus
from .position_manager import PaperPositionManager

__all__ = [
    'PaperBrokerAdapter',
    'PaperOrder',
    'PaperPosition',
    'OrderSimulator',
    'OrderType',
    'OrderStatus',
    'PaperPositionManager',
]
