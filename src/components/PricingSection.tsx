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

        <ComparisonTable />
        <FaqList />
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

const COMPARISON_FEATURES: { label: string; demo: string | boolean; pro: string | boolean; founding: string | boolean }[] = [
  { label: 'Live multi-asset scanner', demo: 'Limited', pro: 'Full', founding: 'Full' },
  { label: 'Guarded Signals feed', demo: false, pro: true, founding: true },
  { label: 'Streaming charts with harmonic overlays', demo: 'Demo data', pro: true, founding: true },
  { label: 'Economic-calendar risk gates', demo: false, pro: true, founding: true },
  { label: 'Setup guidance + execution framework', demo: false, pro: true, founding: true },
  { label: 'Institutional intelligence / evidence ledger', demo: false, pro: true, founding: true },
  { label: 'Journal, positions, and trade history', demo: 'Read-only', pro: true, founding: true },
  { label: 'Performance tracking + calibration', demo: false, pro: true, founding: true },
  { label: 'Telegram alerts (selective)', demo: false, pro: true, founding: true },
  { label: 'Forward-tested outcome resolution', demo: false, pro: true, founding: true },
  { label: 'Pricing lock-in', demo: '—', pro: 'Standard', founding: 'Grandfathered while subscribed' },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Is ConfluenceX financial advice?',
    a: 'No. ConfluenceX is a read-only market-intelligence and decision-support tool. It does not provide personalized financial advice and does not guarantee trading results. Past performance of the engine and forward-tested samples is not indicative of future returns.',
  },
  {
    q: 'What does the Demo plan include?',
    a: 'Demo accounts explore the live workspace with sample data and a limited scanner. You can see how the signals and overlays render without live trade alerts, paid-only intelligence, or persistence.',
  },
  {
    q: 'How is Founding Member pricing locked in?',
    a: 'Founding Member is $29/month, capped at the first 50 paying customers. The rate is grandfathered for as long as your subscription stays active. Cancel anytime and the grandathered rate is honored until you cancel.',
  },
  {
    q: 'Can I switch between Monthly and Annual?',
    a: 'Yes. The cadence toggle is at the top of the pricing section. Annual saves $98/year vs the monthly rate on Pro and is refundable within 14 days per the Terms of Service.',
  },
  {
    q: 'What happens when I cancel?',
    a: 'You keep access until the end of the current billing period, then your account reverts to the read-only Demo plan. Your saved journal entries, drawings, and alert preferences are retained for 90 days in case you reactivate.',
  },
  {
    q: 'Does ConfluenceX connect to my broker?',
    a: 'Pro plans can optionally connect a TradeLocker demo or live account in Settings. Live execution is read-only and advisory by default; broker reconciliation, idempotency, portfolio risk limits, and an independently verified kill switch are required before any live order can be placed through ConfluenceX. See the Risk Disclaimer for the full safety contract.',
  },
];

const renderCell = (value: string | boolean) => {
  if (value === true) {
    return <span className="inline-flex items-center justify-center rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">Included</span>;
  }
  if (value === false) {
    return <span className="inline-flex items-center justify-center rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider cx-text-faint">—</span>;
  }
  return <span className="text-xs cx-text-muted">{value}</span>;
};

const ComparisonTable: React.FC = () => (
  <div className="mt-12 overflow-hidden rounded-2xl border cx-border cx-bg-card">
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider cx-text-faint">
          <tr>
            <th className="px-4 py-3 text-left">Feature</th>
            <th className="px-4 py-3 text-left">Demo</th>
            <th className="px-4 py-3 text-left">Pro</th>
            <th className="px-4 py-3 text-left">Founding Member</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_FEATURES.map((row) => (
            <tr key={row.label} className="border-t border-white/[0.04]">
              <td className="px-4 py-3 cx-text-muted">{row.label}</td>
              <td className="px-4 py-3">{renderCell(row.demo)}</td>
              <td className="px-4 py-3">{renderCell(row.pro)}</td>
              <td className="px-4 py-3">{renderCell(row.founding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const FaqList: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <div className="mt-12 space-y-3">
      {FAQ_ITEMS.map((item, index) => {
        const open = openIndex === index;
        return (
          <div key={item.q} className="rounded-2xl border cx-border cx-bg-card">
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : index)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              aria-expanded={open}
              data-testid={`faq-${index}`}
            >
              <span className="text-sm font-bold cx-text-strong">{item.q}</span>
              <span className={`text-cyan-300 transition ${open ? 'rotate-45' : ''}`}>+</span>
            </button>
            {open && (
              <div className="px-5 pb-5 text-sm leading-relaxed cx-text-muted">
                {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export { ComparisonTable, FaqList };
