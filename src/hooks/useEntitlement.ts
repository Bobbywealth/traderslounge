// Reads server-side entitlement for the logged-in user. NEVER trusts
// localStorage or plan values stored on the client. Clears cache on logout
// via the AuthContext effect.

import { useCallback, useEffect, useState } from 'react';
import { billingApi, type BillingMe } from '../services/billingApi';
import { useAuth } from '../contexts/AuthContext';

export interface EntitlementState {
  loading: boolean;
  error: string | null;
  data: BillingMe | null;
  refresh: () => Promise<void>;
}

export function useEntitlement(): EntitlementState {
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = useState<Omit<EntitlementState, 'refresh'>>({
    loading: isAuthenticated,
    error: null,
    data: null,
  });

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await billingApi.me();
      setState({ loading: false, error: null, data });
    } catch (err: any) {
      setState({ loading: false, error: err?.message || 'Failed to load entitlement', data: null });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh, user?.id]);

  // Expose a global refresh hook so /billing/success can force a refresh after
  // returning from Stripe Checkout.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__refreshEntitlement = refresh;
    return () => {
      if ((window as any).__refreshEntitlement === refresh) {
        delete (window as any).__refreshEntitlement;
      }
    };
  }, [refresh]);

  return { ...state, refresh };
}
