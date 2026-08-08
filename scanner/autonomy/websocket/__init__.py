"""
WebSocket Live Events for Confluence X.

Pushes real-time state changes to the frontend.
"""
from .ws_server import WebSocketServer, WSMessage

__all__ = [
    'WebSocketServer',
    'WSMessage',
]
