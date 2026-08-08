"""
WebSocket Server for Confluence X.

Pushes real-time state changes to the frontend.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

log = logging.getLogger(__name__)


@dataclass
class WSMessage:
    """WebSocket message."""
    topic: str
    data: dict
    timestamp: float = field(default_factory=time.time)
    
    def to_json(self) -> str:
        return json.dumps({
            'topic': self.topic,
            'data': self.data,
            'timestamp': self.timestamp,
        })


class WebSocketServer:
    """
    WebSocket Server.
    
    Pushes real-time state changes to connected clients.
    """
    
    def __init__(self):
        self._clients: Dict[str, Set[str]] = {}  # topic -> set of client_ids
        self._subscriptions: Dict[str, Set[str]] = {}  # client_id -> set of topics
        self._message_queue: List[WSMessage] = []
    
    def subscribe(self, client_id: str, topics: List[str]):
        """Subscribe a client to topics."""
        if client_id not in self._subscriptions:
            self._subscriptions[client_id] = set()
        
        for topic in topics:
            self._subscriptions[client_id].add(topic)
            if topic not in self._clients:
                self._clients[topic] = set()
            self._clients[topic].add(client_id)
        
        log.info("Client %s subscribed to: %s", client_id, topics)
    
    def unsubscribe(self, client_id: str, topics: List[str] = None):
        """Unsubscribe a client from topics."""
        if topics is None:
            topics = list(self._subscriptions.get(client_id, set()))
        
        for topic in topics:
            if topic in self._subscriptions.get(client_id, set()):
                self._subscriptions[client_id].discard(topic)
            if topic in self._clients:
                self._clients[topic].discard(client_id)
        
        log.info("Client %s unsubscribed from: %s", client_id, topics)
    
    def disconnect(self, client_id: str):
        """Disconnect a client."""
        if client_id in self._subscriptions:
            topics = list(self._subscriptions[client_id])
            self.unsubscribe(client_id, topics)
            del self._subscriptions[client_id]
        
        log.info("Client %s disconnected", client_id)
    
    def publish(self, topic: str, data: dict):
        """Publish a message to all subscribers of a topic."""
        message = WSMessage(topic=topic, data=data)
        
        # Get subscribers
        subscribers = self._clients.get(topic, set())
        
        if not subscribers:
            log.debug("No subscribers for topic: %s", topic)
            return
        
        # Queue message for delivery
        self._message_queue.append(message)
        
        log.debug("Published to %d subscribers on topic %s", len(subscribers), topic)
    
    def get_pending_messages(self, client_id: str) -> List[WSMessage]:
        """Get pending messages for a client."""
        subscribed_topics = self._subscriptions.get(client_id, set())
        
        pending = [
            msg for msg in self._message_queue
            if msg.topic in subscribed_topics
        ]
        
        return pending
    
    def clear_delivered(self, client_id: str):
        """Clear delivered messages for a client."""
        # In a real implementation, this would track per-client delivery
        # For now, just clear the queue periodically
        if len(self._message_queue) > 1000:
            self._message_queue = self._message_queue[-500:]
    
    def get_topics(self) -> List[str]:
        """Get all available topics."""
        return list(self._clients.keys())
    
    def get_subscriber_count(self, topic: str) -> int:
        """Get number of subscribers for a topic."""
        return len(self._clients.get(topic, set()))
    
    def get_stats(self) -> dict:
        """Get server statistics."""
        return {
            'total_clients': len(self._subscriptions),
            'total_topics': len(self._clients),
            'total_subscribers': sum(len(subs) for subs in self._clients.values()),
            'queue_size': len(self._message_queue),
        }


# Available topics
TOPICS = {
    'market': 'Real-time market data updates',
    'setup': 'Setup state changes',
    'position': 'Position updates',
    'news': 'News events',
    'risk': 'Risk limit changes',
    'system': 'System status updates',
    'alert': 'Alert notifications',
    'regime': 'Market regime changes',
    'scanner': 'Scanner results',
}
