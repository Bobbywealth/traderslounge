// Frontend client for the Stripe billing endpoints. Uses the same auth token
// the rest of the app already carries via bwtsApi.

import { getAccessToken, setAccessToken } from './authBridge';

const BILLING_BASE = (import.meta as any).env?.VITE_BILLING_API_URL
  || (import.meta as any).env?.VITE_API_URL
  || '';

const REFRESH_TOKEN_KEY = 'confluencex_refresh_token';
let refreshInFlight: Promise<boolean> | null = null;

interface SubscriptionSnapshot {
  id: number;
  user_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_price_id: string;
  plan: 'pro_monthly' | 'pro_annual' | 'founding_monthly';
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccessSnapshot {
  hasAccess: boolean;
  reason: string;
}

export interface BillingMe {
  user: { id: string; email: string; role: string; is_demo: boolean };
  subscription: SubscriptionSnapshot | null;
  access: AccessSnapshot;
}

export interface PricingPlan {
  id: string;
  label: string;
  amount_cents: number;
  interval: 'month' | 'year';
  annual_savings_cents?: number;
  note?: string;
}

export interface PricingResponse {
  currency: string;
  plans: PricingPlan[];
  risk_disclaimer: string;
}

export interface FoundingMemberCounter {
  count: number;
  cap: number;
  remaining: number;
  at_cap: boolean;
  last_updated: string | null;
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BILLING_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const payload = await res.json();
      if (payload?.access_token) {
        setAccessToken(payload.access_token);
        if (payload.refresh_token) {
          localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function billingFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (!getAccessToken()) await refreshAccessToken();
  const headers = new Headers(init.headers || {});
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${BILLING_BASE}${path}`, { ...init, headers });
  if (response.status === 401 && retry && (await refreshAccessToken())) {
    return billingFetch(path, init, false);
  }
  return response;
}

// Pull the existing access token from bwtsApi so we don't double-store.
export function setBillingAccessToken(token: string | null) {
  setAccessToken(token);
}

export const billingApi = {
  async me(): Promise<BillingMe> {
    const res = await billingFetch('/api/billing/me');
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.error || `${res.status} ${res.statusText}`);
    }
    return res.json();
  },

  async pricing(): Promise<PricingResponse> {
    const res = await fetch(`${BILLING_BASE}/api/billing/pricing`);
    if (!res.ok) throw new Error(`Failed to fetch pricing (${res.status})`);
    return res.json();
  },

  async foundingCounter(): Promise<FoundingMemberCounter> {
    const res = await fetch(`${BILLING_BASE}/api/billing/founding-member-counter`);
    if (!res.ok) throw new Error(`Failed to fetch counter (${res.status})`);
    return res.json();
  },

  async createCheckout(plan: 'pro_monthly' | 'pro_annual' | 'founding_monthly', options: { successUrl?: string; cancelUrl?: string } = {}): Promise<{ url: string; session_id: string }> {
    const res = await billingFetch('/api/billing/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ plan, ...options }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(payload?.message || payload?.error || 'Checkout failed');
      (err as any).code = payload?.error || 'unknown';
      (err as any).details = payload;
      throw err;
    }
    return payload;
  },

  async createPortal(returnUrl?: string): Promise<{ url: string }> {
    const res = await billingFetch('/api/billing/create-portal-session', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.message || payload?.error || 'Portal failed');
    }
    return payload;
  },
};

// Lightweight analytics dispatcher. Uses window.dataLayer + window.analytics
// if present, otherwise no-op. Backend also logs billing_audit_log.
export const analytics = {
  track(event: string, payload: Record<string, unknown> = {}) {
    if (typeof window === 'undefined') return;
    const detail = { event, ts: Date.now(), ...payload };
    if (Array.isArray((window as any).dataLayer)) {
      (window as any).dataLayer.push(detail);
    }
    const fn = (window as any).analytics?.track;
    if (typeof fn === 'function') {
      try { fn(event, payload); } catch { /* ignore */ }
    }
    if (typeof console !== 'undefined' && (window as any).__BILLING_DEBUG__) {
      console.debug('[analytics]', event, payload);
    }
  },
};
