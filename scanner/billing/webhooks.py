"""
Stripe webhook handler for ConfluenceX.

Handles:
- Webhook signature verification
- Event processing
- Subscription lifecycle events
- Payment events
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Optional

log = logging.getLogger(__name__)


def handle_webhook(payload: bytes, sig_header: str, stripe_client) -> dict:
    """Handle incoming Stripe webhook.
    
    Args:
        payload: Raw request body
        sig_header: Stripe-Signature header
        stripe_client: StripeClient instance
    
    Returns:
        Dict with status and optional error message
    """
    # Verify signature
    if not stripe_client.verify_webhook_signature(payload, sig_header):
        log.warning("Invalid webhook signature")
        return {'status': 'error', 'message': 'Invalid signature'}
    
    try:
        event = json.loads(payload)
    except json.JSONDecodeError as e:
        log.warning("Invalid JSON in webhook payload: %s", e)
        return {'status': 'error', 'message': 'Invalid payload'}
    
    event_type = event.get('type')
    event_data = event.get('data', {}).get('object', {})
    
    log.info("Processing webhook event: %s", event_type)
    
    # Route to appropriate handler
    handler = _EVENT_HANDLERS.get(event_type)
    if handler:
        try:
            result = handler(event_data, event)
            return {'status': 'ok', 'result': result}
        except Exception as e:
            log.exception("Error handling webhook event %s: %s", event_type, e)
            return {'status': 'error', 'message': str(e)}
    else:
        log.info("Unhandled webhook event type: %s", event_type)
        return {'status': 'ok', 'message': f'Unhandled event: {event_type}'}


def _handle_customer_created(data: dict, event: dict) -> dict:
    """Handle customer.created event."""
    customer_id = data.get('id')
    email = data.get('email')
    log.info("New customer created: %s (%s)", customer_id, email)
    return {'customer_id': customer_id}


def _handle_customer_updated(data: dict, event: dict) -> dict:
    """Handle customer.updated event."""
    customer_id = data.get('id')
    log.info("Customer updated: %s", customer_id)
    return {'customer_id': customer_id}


def _handle_customer_deleted(data: dict, event: dict) -> dict:
    """Handle customer.deleted event."""
    customer_id = data.get('id')
    log.info("Customer deleted: %s", customer_id)
    return {'customer_id': customer_id}


def _handle_subscription_created(data: dict, event: dict) -> dict:
    """Handle customer.subscription.created event."""
    subscription_id = data.get('id')
    customer_id = data.get('customer')
    status = data.get('status')
    log.info("Subscription created: %s for customer: %s (status: %s)", 
             subscription_id, customer_id, status)
    return {'subscription_id': subscription_id, 'status': status}


def _handle_subscription_updated(data: dict, event: dict) -> dict:
    """Handle customer.subscription.updated event."""
    subscription_id = data.get('id')
    customer_id = data.get('customer')
    status = data.get('status')
    log.info("Subscription updated: %s for customer: %s (status: %s)", 
             subscription_id, customer_id, status)
    return {'subscription_id': subscription_id, 'status': status}


def _handle_subscription_deleted(data: dict, event: dict) -> dict:
    """Handle customer.subscription.deleted event."""
    subscription_id = data.get('id')
    customer_id = data.get('customer')
    log.info("Subscription deleted: %s for customer: %s", subscription_id, customer_id)
    return {'subscription_id': subscription_id}


def _handle_invoice_paid(data: dict, event: dict) -> dict:
    """Handle invoice.paid event."""
    invoice_id = data.get('id')
    customer_id = data.get('customer')
    amount_paid = data.get('amount_paid')
    log.info("Invoice paid: %s for customer: %s (amount: %s)", 
             invoice_id, customer_id, amount_paid)
    return {'invoice_id': invoice_id, 'amount_paid': amount_paid}


def _handle_invoice_payment_failed(data: dict, event: dict) -> dict:
    """Handle invoice.payment_failed event."""
    invoice_id = data.get('id')
    customer_id = data.get('customer')
    log.warning("Invoice payment failed: %s for customer: %s", invoice_id, customer_id)
    return {'invoice_id': invoice_id, 'status': 'failed'}


def _handle_checkout_session_completed(data: dict, event: dict) -> dict:
    """Handle checkout.session.completed event."""
    session_id = data.get('id')
    customer_id = data.get('customer')
    subscription_id = data.get('subscription')
    log.info("Checkout completed: %s for customer: %s (subscription: %s)", 
             session_id, customer_id, subscription_id)
    return {'session_id': session_id, 'subscription_id': subscription_id}


def _handle_checkout_session_expired(data: dict, event: dict) -> dict:
    """Handle checkout.session.expired event."""
    session_id = data.get('id')
    log.info("Checkout expired: %s", session_id)
    return {'session_id': session_id, 'status': 'expired'}


# Event handler mapping
_EVENT_HANDLERS: dict[str, Callable] = {
    'customer.created': _handle_customer_created,
    'customer.updated': _handle_customer_updated,
    'customer.deleted': _handle_customer_deleted,
    'customer.subscription.created': _handle_subscription_created,
    'customer.subscription.updated': _handle_subscription_updated,
    'customer.subscription.deleted': _handle_subscription_deleted,
    'invoice.paid': _handle_invoice_paid,
    'invoice.payment_failed': _handle_invoice_payment_failed,
    'checkout.session.completed': _handle_checkout_session_completed,
    'checkout.session.expired': _handle_checkout_session_expired,
}


def register_event_handler(event_type: str, handler: Callable):
    """Register a custom event handler."""
    _EVENT_HANDLERS[event_type] = handler
    log.info("Registered handler for event: %s", event_type)


def get_supported_events() -> list[str]:
    """Get list of supported webhook event types."""
    return list(_EVENT_HANDLERS.keys())
