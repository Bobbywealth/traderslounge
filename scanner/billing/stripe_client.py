"""
Stripe client for ConfluenceX billing.

Handles:
- Customer creation and management
- Subscription lifecycle
- Payment intent creation
- Webhook signature verification
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

# Stripe API version
STRIPE_API_VERSION = '2023-10-16'


@dataclass
class StripeConfig:
    """Stripe configuration from environment."""
    secret_key: str
    webhook_secret: str
    publishable_key: str
    
    @classmethod
    def from_env(cls) -> 'StripeConfig':
        return cls(
            secret_key=os.environ.get('STRIPE_SECRET_KEY', ''),
            webhook_secret=os.environ.get('STRIPE_WEBHOOK_SECRET', ''),
            publishable_key=os.environ.get('STRIPE_PUBLISHABLE_KEY', ''),
        )
    
    @property
    def is_configured(self) -> bool:
        return bool(self.secret_key and self.webhook_secret)


class StripeClient:
    """Stripe API client for ConfluenceX."""
    
    def __init__(self, config: Optional[StripeConfig] = None):
        self.config = config or StripeConfig.from_env()
        self._stripe = None
        
        if self.config.is_configured:
            try:
                import stripe
                stripe.api_key = self.config.secret_key
                stripe.api_version = STRIPE_API_VERSION
                self._stripe = stripe
                log.info("Stripe client initialized")
            except ImportError:
                log.warning("stripe package not installed")
        else:
            log.warning("Stripe not configured - billing features disabled")
    
    @property
    def is_available(self) -> bool:
        return self._stripe is not None
    
    def create_customer(self, email: str, name: Optional[str] = None, metadata: Optional[dict] = None) -> dict:
        """Create a new Stripe customer."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        params = {'email': email}
        if name:
            params['name'] = name
        if metadata:
            params['metadata'] = metadata
        
        customer = self._stripe.Customer.create(**params)
        log.info("Created Stripe customer: %s", customer.id)
        return {
            'id': customer.id,
            'email': customer.email,
            'name': customer.name,
            'created': customer.created,
        }
    
    def create_subscription(self, customer_id: str, price_id: str, trial_days: Optional[int] = None) -> dict:
        """Create a new subscription for a customer."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        params = {
            'customer': customer_id,
            'items': [{'price': price_id}],
            'payment_behavior': 'default_incomplete',
            'expand': ['latest_invoice.payment_intent'],
        }
        
        if trial_days and trial_days > 0:
            params['trial_period_days'] = trial_days
        
        subscription = self._stripe.Subscription.create(**params)
        log.info("Created subscription: %s for customer: %s", subscription.id, customer_id)
        
        return {
            'id': subscription.id,
            'status': subscription.status,
            'current_period_end': subscription.current_period_end,
            'trial_end': subscription.trial_end,
            'latest_invoice': {
                'id': subscription.latest_invoice.id if subscription.latest_invoice else None,
                'payment_intent': {
                    'id': subscription.latest_invoice.payment_intent.id if subscription.latest_invoice and subscription.latest_invoice.payment_intent else None,
                    'client_secret': subscription.latest_invoice.payment_intent.client_secret if subscription.latest_invoice and subscription.latest_invoice.payment_intent else None,
                } if subscription.latest_invoice else None,
            } if subscription.latest_invoice else None,
        }
    
    def cancel_subscription(self, subscription_id: str, at_period_end: bool = True) -> dict:
        """Cancel a subscription."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        if at_period_end:
            subscription = self._stripe.Subscription.modify(
                subscription_id,
                cancel_at_period_end=True,
            )
        else:
            subscription = self._stripe.Subscription.delete(subscription_id)
        
        log.info("Cancelled subscription: %s", subscription_id)
        return {
            'id': subscription.id,
            'status': subscription.status,
            'cancel_at': subscription.cancel_at,
        }
    
    def reactivate_subscription(self, subscription_id: str) -> dict:
        """Reactivate a cancelled subscription."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        subscription = self._stripe.Subscription.modify(
            subscription_id,
            cancel_at_period_end=False,
        )
        
        log.info("Reactivated subscription: %s", subscription_id)
        return {
            'id': subscription.id,
            'status': subscription.status,
        }
    
    def get_subscription(self, subscription_id: str) -> dict:
        """Get subscription details."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        subscription = self._stripe.Subscription.retrieve(subscription_id)
        return {
            'id': subscription.id,
            'status': subscription.status,
            'current_period_end': subscription.current_period_end,
            'cancel_at': subscription.cancel_at,
            ' trial_end': subscription.trial_end,
        }
    
    def get_customer_subscriptions(self, customer_id: str) -> list:
        """Get all subscriptions for a customer."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        subscriptions = self._stripe.Subscription.list(
            customer=customer_id,
            status='all',
        )
        
        return [
            {
                'id': sub.id,
                'status': sub.status,
                'current_period_end': sub.current_period_end,
                'cancel_at': sub.cancel_at,
            }
            for sub in subscriptions.data
        ]
    
    def create_portal_session(self, customer_id: str, return_url: str) -> dict:
        """Create a customer portal session for self-service."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        session = self._stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        
        return {
            'url': session.url,
        }
    
    def create_checkout_session(
        self,
        customer_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        trial_days: Optional[int] = None,
    ) -> dict:
        """Create a checkout session for subscription."""
        if not self.is_available:
            raise RuntimeError("Stripe not configured")
        
        params = {
            'customer': customer_id,
            'line_items': [{'price': price_id, 'quantity': 1}],
            'mode': 'subscription',
            'success_url': success_url,
            'cancel_url': cancel_url,
        }
        
        if trial_days and trial_days > 0:
            params['subscription_data'] = {'trial_period_days': trial_days}
        
        session = self._stripe.checkout.Session.create(**params)
        
        return {
            'id': session.id,
            'url': session.url,
        }
    
    def verify_webhook_signature(self, payload: bytes, sig_header: str) -> bool:
        """Verify Stripe webhook signature."""
        if not self.is_available:
            return False
        
        try:
            self._stripe.Webhook.construct_event(
                payload,
                sig_header,
                self.config.webhook_secret,
            )
            return True
        except Exception as e:
            log.warning("Webhook signature verification failed: %s", e)
            return False


# Singleton instance
_stripe_client: Optional[StripeClient] = None


def get_stripe_client() -> StripeClient:
    """Get or create the singleton Stripe client."""
    global _stripe_client
    if _stripe_client is None:
        _stripe_client = StripeClient()
    return _stripe_client
