// /billing/manage — opens the Stripe Billing Portal in a new tab. Falls back
// to /settings if no Stripe customer is linked.

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';
import { billingApi, analytics } from '../services/billingApi';
import { useAuth } from '../contexts/AuthContext';

const BillingManage: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
      return;
    }
    if (user?.role === 'demo' || user?.email === 'demo@trader.com') {
      setError('Demo accounts cannot manage billing. Sign up for a real account.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const portal = await billingApi.createPortal(`${origin}/settings`);
        if (cancelled) return;
        analytics.track('billing_portal_opened', {});
        window.open(portal.url, '_blank', 'noopener');
        setOpened(true);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to open billing portal');
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, navigate, user]);

  return (
    <div className="min-h-screen bg-[#05070d] px-5 py-24 cx-text-strong">
      <div className="mx-auto max-w-2xl rounded-3xl border cx-border-strong bg-white/[0.03] p-8 text-center">
        <h1 className="text-3xl font-black tracking-tight">Manage billing</h1>
        {error && (
          <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-red-200">
            {error}
          </p>
        )}
        {!error && (
          <div className="mt-6">
            {opened ? (
              <p className="cx-text-muted">
                The Stripe Billing Portal opened in a new tab. Update your payment method or
                cancel your subscription there.
              </p>
            ) : (
              <p className="inline-flex items-center gap-2 text-cyan-300">
                <Loader2 className="h-4 w-4 animate-spin" /> Opening Stripe portal…
              </p>
            )}
          </div>
        )}
        <Link
          to="/settings"
          className="mt-8 inline-flex items-center gap-2 rounded-2xl border cx-border-strong px-6 py-3 text-sm font-semibold cx-text transition hover:cx-bg-card-hover"
        >
          <ExternalLink className="h-4 w-4" /> Back to settings
        </Link>
      </div>
    </div>
  );
};

export default BillingManage;
