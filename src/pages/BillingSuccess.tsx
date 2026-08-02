// /billing/success — Stripe Checkout return URL. Triggers an entitlement
// refresh and links the user into the app.

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ArrowRight, RefreshCw } from 'lucide-react';
import { analytics } from '../services/billingApi';
import { useAuth } from '../contexts/AuthContext';

const BillingSuccess: React.FC = () => {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const { isAuthenticated } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    analytics.track('checkout_completed', { session_id: sessionId });
    let cancelled = false;
    const refresh = async () => {
      setRefreshing(true);
      try {
        const fn = (window as any).__refreshEntitlement;
        if (typeof fn === 'function') await fn();
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to refresh entitlement');
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    refresh();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-[#05070d] px-5 py-24 text-white">
      <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-400/30 bg-emerald-500/[0.05] p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" />
        <h1 className="mt-4 text-3xl font-black tracking-tight">Welcome to ConfluenceX Pro</h1>
        <p className="mt-3 text-slate-300">
          Your subscription is active. We've already started streaming live scanners and signals
          to your workspace.
        </p>
        {refreshing && (
          <p className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-300">
            <RefreshCw className="h-4 w-4 animate-spin" /> Syncing entitlements…
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-amber-200">
            {error} — refresh the page in a few seconds if your account doesn't show Pro yet.
          </p>
        )}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/scanner"
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-violet-500 px-7 py-3 font-black text-[#05070d] transition hover:-translate-y-0.5"
          >
            Open Live Scanner <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.06]"
          >
            Manage billing
          </Link>
        </div>
        {!isAuthenticated && (
          <p className="mt-6 text-xs text-slate-500">
            Sign in with the email you used at checkout to see your Pro access.
          </p>
        )}
      </div>
    </div>
  );
};

export default BillingSuccess;
