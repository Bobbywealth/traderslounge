// /billing/cancel — friendly "no charge made" page when a user backs out.

import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { analytics } from '../services/billingApi';

const BillingCancel: React.FC = () => {
  useEffect(() => {
    analytics.track('checkout_cancelled', {});
  }, []);

  return (
    <div className="min-h-screen bg-[#05070d] px-5 py-24 text-white">
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <X className="mx-auto h-12 w-12 text-slate-400" />
        <h1 className="mt-4 text-3xl font-black tracking-tight">Checkout cancelled</h1>
        <p className="mt-3 text-slate-300">
          No payment was made. You can come back any time and pick a plan when you're ready.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-violet-500 px-7 py-3 font-black text-[#05070d] transition hover:-translate-y-0.5"
          >
            Back to pricing
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.06]"
          >
            Continue with demo
          </Link>
        </div>
      </div>
    </div>
  );
};

export default BillingCancel;
