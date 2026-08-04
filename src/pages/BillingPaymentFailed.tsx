// /billing/payment-failed — opened when Stripe sends an invoice.payment_failed
// webhook. Redirects users to the Billing Portal to update their card.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { billingApi } from '../services/billingApi';
import { useAuth } from '../contexts/AuthContext';

const BillingPaymentFailed: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No automatic redirect — let the user click the CTA.
  }, []);

  const openPortal = async () => {
    setOpening(true);
    setError(null);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const portal = await billingApi.createPortal(`${origin}/settings`);
      window.open(portal.url, '_blank', 'noopener');
    } catch (err: any) {
      setError(err?.message || 'Could not open the billing portal');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05070d] px-5 py-24 cx-text-strong">
      <div className="mx-auto max-w-2xl rounded-3xl border border-amber-400/30 bg-amber-500/[0.05] p-8 text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-300" />
        <h1 className="mt-4 text-3xl font-black tracking-tight">Payment failed</h1>
        <p className="mt-3 cx-text-muted">
          Your most recent invoice couldn't be charged. We'll keep your access active until the
          end of the current billing period so you can update your payment method.
        </p>

        {isAuthenticated ? (
          <button
            type="button"
            onClick={openPortal}
            disabled={opening}
            className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-violet-500 px-7 py-3 font-black text-[#05070d] transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            Update payment method <ExternalLink className="h-4 w-4" />
          </button>
        ) : (
          <Link
            to="/"
            className="mt-8 inline-flex items-center gap-2 rounded-2xl border cx-border-strong px-6 py-3 text-sm font-semibold cx-text transition hover:cx-bg-card-hover"
          >
            Sign in to update payment method
          </Link>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-red-200">
            {error}
          </p>
        )}

        <p className="mt-6 text-xs cx-text-faint">
          If you didn't intend to subscribe, you can cancel from the billing portal as well.
        </p>
      </div>
    </div>
  );
};

export default BillingPaymentFailed;
