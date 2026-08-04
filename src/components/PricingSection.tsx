// Pricing section for the landing page. Server-driven counter for the
// Founding Member banner. Mobile-first.

import React, { useEffect, useState } from 'react';
import { Check, Crown, Sparkles, Star } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { billingApi, analytics } from '../services/billingApi';

function useAuthSafe() {
  try {
    return useAuth();
  } catch {
    return { user: null, isAuthenticated: false } as any;
  }
}

type BillingCadence = 'monthly' | 'annual';

interface PricingSectionProps {
  defaultCadence?: BillingCadence;
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(0)}`;

const PricingSection: React.FC<PricingSectionProps> = ({ defaultCadence = 'monthly' }) => {
  const { user, isAuthenticated } = useAuthSafe();
  const [cadence, setCadence] = useState<BillingCadence>(defaultCadence);
  const [counter, setCounter] = useState<{ remaining: number; at_cap: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    billingApi.foundingCounter()
      .then((c) => { if (!cancelled) setCounter({ remaining: c.remaining, at_cap: c.at_cap }); })
      .catch(() => { /* leave counter null — banner just hides */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    analytics.track('pricing_viewed', { cadence });
  }, [cadence]);

  const isDemo = user?.role === 'demo' || user?.email === 'demo@trader.com';

  const startCheckout = async (plan: 'pro_monthly' | 'pro_annual' | 'founding_monthly') => {
    setError(null);
    setBusy(plan);
    analytics.track('checkout_started', { plan });
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const session = await billingApi.createCheckout(plan, {
        successUrl: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/billing/cancel`,
      });
      window.location.href = session.url;
    } catch (err: any) {
      setError(err?.message || 'Could not start checkout');
      analytics.track('checkout_cancelled', { plan, reason: err?.code || 'error' });
    } finally {
      setBusy(null);
    }
  };

  const onDemo = () => {
    if (typeof window !== 'undefined') {
      window.location.hash = '#demo';
      window.dispatchEvent(new CustomEvent('open-auth', { detail: { mode: 'signup' } }));
    }
  };

  const annualSavings = 49 * 12 - 490; // 98

  return (
    <section id="pricing" className="px-5 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <div className="text-xs font-black tracking-[0.22em] text-cyan-300">SIMPLE ACCESS</div>
          <h2 className="mt-4 text-4xl font-black tracking-[-0.04em] sm:text-6xl">
            Start with a free demo. Upgrade when you're ready.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg cx-text-muted">
            Demo accounts explore the live workspace with demo data. Pro unlocks the full
            multi-asset scanner, Guarded Signals feed, streaming charts, and journal.
          </p>
        </div>

        {counter && !counter.at_cap && counter.remaining > 0 && (
          <div
            data-testid="founding-banner"
            className="mx-auto mt-10 max-w-3xl rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-400/10 via-amber-300/5 to-amber-400/10 px-5 py-4 text-center text-amber-100"
          >
            <div className="flex items-center justify-center gap-2 text-sm font-bold tracking-wide">
              <Crown className="h-4 w-4 text-amber-300" />
              FOUNDING MEMBER
              <Crown className="h-4 w-4 text-amber-300" />
            </div>
            <p className="mt-1 text-base sm:text-lg">
              <span className="font-bold">$29/month</span>, locked in for as long as you stay subscribed.
              {' '}
              <span className="text-amber-200">
                Spots remaining: {counter.remaining} of 50
              </span>
            </p>
          </div>
        )}
        {counter?.at_cap && (
          <div className="mx-auto mt-10 max-w-3xl rounded-2xl border cx-border-strong bg-white/5 px-5 py-4 text-center cx-text-muted">
            Founding Member spots are filled. Pro is still available.
          </div>
        )}

        <div className="mx-auto mt-10 flex max-w-md items-center justify-center gap-3 rounded-2xl border cx-border-strong bg-white/[0.03] p-1.5 backdrop-blur">
          <button
            type="button"
            onClick={() => setCadence('monthly')}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              cadence === 'monthly'
                ? 'bg-gradient-to-r from-cyan-400 to-violet-500 text-[#05070d]'
                : 'cx-text-muted hover:cx-text-strong'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setCadence('annual')}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              cadence === 'annual'
                ? 'bg-gradient-to-r from-cyan-400 to-violet-500 text-[#05070d]'
                : 'cx-text-muted hover:cx-text-strong'
            }`}
          >
            Annual
            <span className="ml-2 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
              Save ${annualSavings}
            </span>
          </button>
        </div>

        {error && (
          <div className="mx-auto mt-6 max-w-3xl rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-red-200">
            {error}
          </div>
        )}

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          <PlanCard
            name="Demo"
            tagline="For exploring the workspace with demo data."
            price='$0'
            cadence="Free forever"
            cta={isAuthenticated ? 'Open Demo' : 'Start with Demo'}
            ctaAction={onDemo}
            data-testid="plan-demo"
            accent="slate"
            features={[
              'Demo workspace with sample data',
              'Limited scanner — no live trade alerts',
              'No paid-only intelligence',
              'Clearly labeled demo data and limitations',
            ]}
          />

          <PlanCard
            name="ConfluenceX Pro"
            tagline="Live multi-asset scanner, Guarded Signals, streaming charts."
            price={cadence === 'annual' ? '$490' : '$49'}
            cadence={cadence === 'annual' ? 'per year · save $98' : 'per month'}
            cta={isAuthenticated ? 'Subscribe to Pro' : 'Get Pro'}
            ctaAction={() => startCheckout(cadence === 'annual' ? 'pro_annual' : 'pro_monthly')}
            ctaDisabled={isDemo}
            ctaHint={isDemo ? 'Demo accounts cannot subscribe. Sign up for a real account.' : undefined}
            busy={busy === (cadence === 'annual' ? 'pro_annual' : 'pro_monthly')}
            data-testid="plan-pro"
            accent="violet"
            highlight
            ribbon={cadence === 'annual' ? 'Best value' : 'Most popular'}
            features={[
              'Live multi-asset market scanner',
              'Guarded Signals feed',
              'Streaming charts with harmonic overlays',
              'Setup guidance and execution framework',
              'Economic-calendar risk gates',
              'Institutional intelligence and evidence ledger',
              'Journal, positions, and trade history',
              'Performance tracking',
            ]}
          />

          <PlanCard
            name="Founding Member"
            tagline="$29/month, locked in for as long as you stay subscribed."
            price="$29"
            cadence="per month · first 50 only"
            cta={counter?.at_cap ? 'Cap reached' : 'Claim Founding Spot'}
            ctaAction={() => startCheckout('founding_monthly')}
            ctaDisabled={isDemo || !!counter?.at_cap}
            ctaHint={
              isDemo
                ? 'Demo accounts cannot subscribe.'
                : counter?.at_cap
                ? 'All 50 Founding Member spots are filled.'
                : counter
                ? `Only ${counter.remaining} spots remaining.`
                : undefined
            }
            busy={busy === 'founding_monthly'}
            data-testid="plan-founding"
            accent="amber"
            empty={counter?.at_cap}
            features={[
              'Every Pro feature, included',
              '$29/month, grandfathered while subscription remains active',
              'Limited to the first 50 paying customers',
              'Server-side cap — no exceptions',
              'Cancel anytime — grandathered rate honored until cancellation',
            ]}
          />
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl gap-4 lg:grid-cols-1">
          <div className="rounded-2xl border cx-border-strong bg-white/[0.03] p-6 text-center cx-text-muted">
            <div className="flex items-center justify-center gap-2 text-sm font-bold text-cyan-300">
              <Sparkles className="h-4 w-4" /> CONFLUENCEX ELITE — COMING SOON
            </div>
            <p className="mt-2 text-base">
              Advanced alerts, calibrated performance stats, expanded markets, and priority support.
            </p>
            <p className="mt-2 text-xs cx-text-faint">
              Not yet purchasable. Joining the Founding Member and Pro lists will be notified when Elite opens.
            </p>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-3xl text-center text-xs cx-text-faint">
          ConfluenceX provides read-only market intelligence and decision support. It does not
          provide personalized financial advice or guarantee trading results.
        </p>
      </div>
    </section>
  );
};

interface PlanCardProps {
  name: string;
  tagline: string;
  price: string;
  cadence: string;
  cta: string;
  ctaAction: () => void;
  ctaDisabled?: boolean;
  ctaHint?: string;
  busy?: boolean;
  features: string[];
  accent: 'slate' | 'violet' | 'amber';
  highlight?: boolean;
  ribbon?: string;
  empty?: boolean;
  'data-testid'?: string;
}

const PlanCard: React.FC<PlanCardProps> = ({
  name, tagline, price, cadence, cta, ctaAction, ctaDisabled, ctaHint, busy, features,
  accent, highlight, ribbon, empty, ...rest
}) => {
  const accentRing = highlight
    ? 'border-cyan-400/40 shadow-[0_0_60px_rgba(34,211,238,0.18)]'
    : 'cx-border-strong';
  const accentBg = highlight
    ? 'bg-gradient-to-br from-cyan-400/[0.10] via-violet-500/[0.08] to-fuchsia-500/[0.10]'
    : 'bg-white/[0.02]';
  const ctaClass = (() => {
    if (empty) return 'border cx-border-strong bg-white/5 cx-text-muted cursor-not-allowed';
    if (accent === 'amber') return 'bg-gradient-to-r from-amber-300 to-amber-500 text-[#05070d] hover:brightness-110';
    if (accent === 'violet') return 'bg-gradient-to-r from-cyan-400 to-violet-500 text-[#05070d] hover:-translate-y-0.5';
    return 'border border-white/15 bg-white/5 cx-text-strong hover:bg-white/10';
  })();

  return (
    <div
      {...rest}
      className={`relative rounded-3xl border ${accentRing} ${accentBg} p-7 text-left`}
    >
      {ribbon && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#05070d]">
          {ribbon}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-sm font-black tracking-widest text-cyan-300">{name.toUpperCase()}</div>
        {accent === 'amber' && <Crown className="h-5 w-5 text-amber-300" />}
        {accent === 'violet' && <Star className="h-5 w-5 text-violet-300" />}
      </div>
      <p className="mt-2 text-sm cx-text-muted">{tagline}</p>
      <div className="mt-6">
        <div className="text-4xl font-black tracking-tight">{price}</div>
        <div className="mt-1 text-xs cx-text-faint">{cadence}</div>
      </div>
      <ul className="mt-6 space-y-3 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 cx-text-muted">
            <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300">
              <Check className="h-3 w-3" />
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={ctaAction}
        disabled={ctaDisabled || busy}
        className={`mt-8 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 font-bold transition disabled:opacity-60 ${ctaClass}`}
        data-testid={`${rest['data-testid']}-cta`}
      >
        {busy ? 'Redirecting to Stripe…' : cta}
      </button>
      {ctaHint && (
        <p className="mt-2 text-center text-[11px] cx-text-faint">{ctaHint}</p>
      )}
    </div>
  );
};

export default PricingSection;
