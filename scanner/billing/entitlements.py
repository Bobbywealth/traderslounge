"""
Entitlements management for ConfluenceX.

Handles:
- Plan tier definitions
- Feature access control
- Usage limits
- Entitlement validation
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

log = logging.getLogger(__name__)


class PlanTier(Enum):
    """Subscription plan tiers."""
    FREE = 'free'
    TRIAL = 'trial'
    PRO = 'pro'
    PREMIUM = 'premium'
    ADMIN = 'admin'


@dataclass
class PlanFeatures:
    """Features included in a plan tier."""
    # Chart access
    max_symbols: int  # -1 for unlimited
    max_timeframes: int  # -1 for unlimited
    real_time_data: bool
    historical_data_days: int  # -1 for unlimited
    
    # Analysis
    ai_analysis: bool
    advanced_indicators: bool
    custom_indicators: bool
    export_analysis: bool
    
    # Trading
    paper_trading: bool
    live_trading: bool
    risk_calculator: bool
    position_sizing: bool
    
    # Alerts
    max_alerts: int  # -1 for unlimited
    push_notifications: bool
    email_alerts: bool
    
    # Support
    priority_support: bool
    dedicated_account_manager: bool
    
    # API
    api_access: bool
    api_rate_limit: int  # requests per minute


# Plan tier definitions
PLAN_FEATURES = {
    PlanTier.FREE: PlanFeatures(
        max_symbols=5,
        max_timeframes=3,
        real_time_data=False,
        historical_data_days=7,
        ai_analysis=False,
        advanced_indicators=False,
        custom_indicators=False,
        export_analysis=False,
        paper_trading=True,
        live_trading=False,
        risk_calculator=False,
        position_sizing=False,
        max_alerts=3,
        push_notifications=False,
        email_alerts=False,
        priority_support=False,
        dedicated_account_manager=False,
        api_access=False,
        api_rate_limit=10,
    ),
    PlanTier.TRIAL: PlanFeatures(
        max_symbols=10,
        max_timeframes=5,
        real_time_data=True,
        historical_data_days=30,
        ai_analysis=True,
        advanced_indicators=True,
        custom_indicators=False,
        export_analysis=False,
        paper_trading=True,
        live_trading=False,
        risk_calculator=True,
        position_sizing=True,
        max_alerts=10,
        push_notifications=True,
        email_alerts=True,
        priority_support=False,
        dedicated_account_manager=False,
        api_access=False,
        api_rate_limit=30,
    ),
    PlanTier.PRO: PlanFeatures(
        max_symbols=20,
        max_timeframes=-1,
        real_time_data=True,
        historical_data_days=90,
        ai_analysis=True,
        advanced_indicators=True,
        custom_indicators=True,
        export_analysis=True,
        paper_trading=True,
        live_trading=True,
        risk_calculator=True,
        position_sizing=True,
        max_alerts=50,
        push_notifications=True,
        email_alerts=True,
        priority_support=True,
        dedicated_account_manager=False,
        api_access=True,
        api_rate_limit=60,
    ),
    PlanTier.PREMIUM: PlanFeatures(
        max_symbols=-1,
        max_timeframes=-1,
        real_time_data=True,
        historical_data_days=-1,
        ai_analysis=True,
        advanced_indicators=True,
        custom_indicators=True,
        export_analysis=True,
        paper_trading=True,
        live_trading=True,
        risk_calculator=True,
        position_sizing=True,
        max_alerts=-1,
        push_notifications=True,
        email_alerts=True,
        priority_support=True,
        dedicated_account_manager=True,
        api_access=True,
        api_rate_limit=120,
    ),
    PlanTier.ADMIN: PlanFeatures(
        max_symbols=-1,
        max_timeframes=-1,
        real_time_data=True,
        historical_data_days=-1,
        ai_analysis=True,
        advanced_indicators=True,
        custom_indicators=True,
        export_analysis=True,
        paper_trading=True,
        live_trading=True,
        risk_calculator=True,
        position_sizing=True,
        max_alerts=-1,
        push_notifications=True,
        email_alerts=True,
        priority_support=True,
        dedicated_account_manager=True,
        api_access=True,
        api_rate_limit=1000,
    ),
}


@dataclass
class UserEntitlement:
    """User's current entitlements."""
    user_id: str
    plan: PlanTier
    features: PlanFeatures
    subscription_id: Optional[str] = None
    subscription_status: Optional[str] = None
    current_period_end: Optional[int] = None
    trial_end: Optional[int] = None
    is_trial: bool = False
    is_cancelled: bool = False


class EntitlementManager:
    """Manages user entitlements and feature access."""
    
    def __init__(self):
        self._cache: dict[str, UserEntitlement] = {}
    
    def get_entitlement(self, user_id: str, plan: str) -> UserEntitlement:
        """Get user's entitlements based on their plan."""
        # Check cache
        cache_key = f"{user_id}:{plan}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        # Convert plan string to enum
        try:
            plan_tier = PlanTier(plan.lower())
        except ValueError:
            plan_tier = PlanTier.FREE
        
        # Get features for plan
        features = PLAN_FEATURES.get(plan_tier, PLAN_FEATURES[PlanTier.FREE])
        
        entitlement = UserEntitlement(
            user_id=user_id,
            plan=plan_tier,
            features=features,
        )
        
        # Cache the entitlement
        self._cache[cache_key] = entitlement
        
        return entitlement
    
    def check_feature_access(self, user_id: str, plan: str, feature: str) -> bool:
        """Check if user has access to a specific feature."""
        entitlement = self.get_entitlement(user_id, plan)
        return getattr(entitlement.features, feature, False)
    
    def check_usage_limit(self, user_id: str, plan: str, resource: str, current_usage: int) -> bool:
        """Check if user is within usage limits."""
        entitlement = self.get_entitlement(user_id, plan)
        limit = getattr(entitlement.features, resource, 0)
        
        # -1 means unlimited
        if limit == -1:
            return True
        
        return current_usage < limit
    
    def get_api_rate_limit(self, user_id: str, plan: str) -> int:
        """Get API rate limit for user."""
        entitlement = self.get_entitlement(user_id, plan)
        return entitlement.features.api_rate_limit
    
    def clear_cache(self, user_id: Optional[str] = None):
        """Clear entitlement cache."""
        if user_id:
            self._cache = {k: v for k, v in self._cache.items() if not k.startswith(f"{user_id}:")}
        else:
            self._cache.clear()


# Singleton instance
_entitlement_manager: Optional[EntitlementManager] = None


def get_entitlement_manager() -> EntitlementManager:
    """Get or create the singleton EntitlementManager."""
    global _entitlement_manager
    if _entitlement_manager is None:
        _entitlement_manager = EntitlementManager()
    return _entitlement_manager
