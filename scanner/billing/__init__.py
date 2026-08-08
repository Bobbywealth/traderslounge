"""
Billing module for ConfluenceX.

Provides Stripe integration for subscription management,
entitlements, and webhook handling.
"""
from .stripe_client import StripeClient
from .entitlements import EntitlementManager, PlanTier
from .webhooks import handle_webhook

__all__ = [
    'StripeClient',
    'EntitlementManager',
    'PlanTier',
    'handle_webhook',
]
