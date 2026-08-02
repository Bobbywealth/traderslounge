// Settings — read-only config view + operational controls
// (kill switch, manual scan refresh) + Billing section.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CreditCard, ExternalLink, RefreshCw, Settings as SettingsIcon, ShieldOff, ShieldCheck, Wallet } from 'lucide-react';
import { bwtsApi, type BwtsConfig, type BwtsKillStatus } from '../services/bwtsApi';
import { billingApi, type BillingMe } from '../services/billingApi';
import { useAuth } from '../contexts/AuthContext';

const Settings: React.FC = () => {
  const [config, setConfig] = useState<BwtsConfig | null>(null);
  const [kill, setKill] = useState<BwtsKillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const [c, k] = await Promise.all([bwtsApi.config(), bwtsApi.killStatus()]);
      setConfig(c);
      setKill(k);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const announce = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const toggleKill = async () => {
    if (!kill) return;
    setBusy(true);
    try {
      const next = await bwtsApi.setKill(!kill.engaged, !kill.engaged ? 'Engaged from dashboard' : '');
      setKill(next);
      announce(next.engaged ? 'Kill switch ENGAGED — execution halted' : 'Kill switch disengaged');
    } catch (e: any) {
      announce(`Failed: ${e?.message || 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  const requestScan = async () => {
    setBusy(true);
    try {
      await bwtsApi.requestScan();
      announce('Scan requested — worker will run on next tick (within seconds)');
    } catch (e: any) {
      announce(`Failed: ${e?.message || 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-emerald-400" />
          Settings
        </h1>
        <p className="text-gray-400 mt-1">Live scanner configuration + operational controls.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {toast && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg px-4 py-3">
          {toast}
        </div>
      )}

      {/* Billing */}
      <div className="grid gap-4 md:grid-cols-1">
        <BillingCard />
      </div>

      {/* Operational controls */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className={`rounded-xl p-5 border ${
          kill?.engaged
            ? 'bg-red-500/10 border-red-500/40'
            : 'bg-gray-900/60 border-gray-700/50'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              {kill?.engaged ? (
                <ShieldOff className="w-4 h-4 text-red-400" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              )}
              Kill Switch
            </h3>
            <span
              className={`text-xs px-2 py-0.5 rounded border ${
                kill?.engaged
                  ? 'bg-red-500/20 text-red-300 border-red-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}
            >
              {kill?.engaged ? 'ENGAGED' : 'DISENGAGED'}
            </span>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            {kill?.engaged
              ? 'Execution is halted. New trades are rejected by the trade manager.'
              : 'Execution is active. The trade manager will process STRONG signals.'}
          </p>
          {kill?.engaged && kill.reason && (
            <p className="text-xs text-red-300/80 mb-3">Reason: {kill.reason}</p>
          )}
          <button
            onClick={toggleKill}
            disabled={busy || !kill}
            className={`w-full px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
              kill?.engaged
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            {kill?.engaged ? 'Disengage Kill Switch' : 'Engage Kill Switch'}
          </button>
        </div>

        <div className="rounded-xl p-5 border bg-gray-900/60 border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2 mb-3">
            <RefreshCw className="w-4 h-4 text-emerald-400" />
            Manual Scan
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Request the scanner to run an immediate cycle. Useful for testing
            without waiting for the next scheduled scan.
          </p>
          <button
            onClick={requestScan}
            disabled={busy}
            className="w-full px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
          >
            Trigger Scan Now
          </button>
        </div>
      </div>

      {/* Read-only config */}
      {config && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Score Thresholds">
            <Row label="Strong tier"    value={`≥ ${config.thresholds.strong}/80`} />
            <Row label="Good tier"      value={`≥ ${config.thresholds.good}/80`} />
            <Row label="Watchlist tier" value={`≥ ${config.thresholds.watchlist}/80`} />
          </Card>
          <Card title="Scan Cadence">
            <Row label="Scan interval"   value={`${config.scan_interval_seconds}s`} />
            <Row label="News blackout"   value={`±${config.news_blackout_minutes} min`} />
          </Card>
          <Card title={`Configured Pairs (${config.pairs.length})`}>
            <div className="flex flex-wrap gap-2">
              {config.pairs.map((p) => (
                <span
                  key={p}
                  className="px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded border border-gray-700"
                >
                  {p}
                </span>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Configuration editing not yet wired</h3>
            <p className="text-gray-400 text-sm">
              Thresholds, pairs, and scan interval are set via Render env vars
              (or <code className="text-emerald-300">render.yaml</code>). A
              live-edit endpoint will land in a follow-up.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5">
    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between py-1.5 border-b border-gray-800/50 last:border-0">
    <span className="text-sm text-gray-400">{label}</span>
    <span className="text-sm text-white font-mono">{value}</span>
  </div>
);

const BillingCard: React.FC = () => {
  const { user } = useAuth();
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await billingApi.me();
      setBilling(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load billing');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openPortal = async () => {
    setBusy(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const portal = await billingApi.createPortal(`${origin}/settings`);
      window.open(portal.url, '_blank', 'noopener');
    } catch (err: any) {
      setError(err?.message || 'Failed to open billing portal');
    } finally {
      setBusy(false);
    }
  };

  const isDemo = user?.role === 'demo' || user?.email === 'demo@trader.com';

  const planLabel = (() => {
    if (!billing?.subscription) return 'No active plan';
    switch (billing.subscription.plan) {
      case 'pro_monthly': return 'Pro Monthly';
      case 'pro_annual': return 'Pro Annual';
      case 'founding_monthly': return 'Founding Member';
      default: return billing.subscription.plan;
    }
  })();

  const statusLabel = (() => {
    if (!billing?.subscription) return '—';
    const s = billing.subscription.status;
    if (s === 'past_due') return 'Past due — payment failed';
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="rounded-xl p-5 border bg-gray-900/60 border-gray-700/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-emerald-400" /> Billing
        </h3>
        <button onClick={load} className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1" disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {isDemo && (
        <p className="text-sm text-gray-400 mb-4">
          Demo accounts do not have a billing relationship. Subscribe from a real account to manage Pro.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      <div className="space-y-2 text-sm">
        <Row label="Current plan" value={planLabel} />
        <Row label="Subscription status" value={statusLabel} />
        {billing?.subscription?.current_period_end && (
          <Row label="Next renewal" value={formatDate(billing.subscription.current_period_end)} />
        )}
        {billing?.subscription?.cancel_at_period_end && (
          <Row
            label="Cancellation"
            value={`Cancels on ${formatDate(billing.subscription.current_period_end)}`}
          />
        )}
      </div>

      {!isDemo && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            onClick={openPortal}
            disabled={busy || !billing?.subscription}
            className="w-full px-4 py-2 rounded-lg font-medium text-sm transition-colors bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white inline-flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" /> Manage billing
          </button>
          {!billing?.subscription && (
            <a
              href="/#pricing"
              className="w-full px-4 py-2 rounded-lg font-medium text-sm transition-colors bg-gray-800 hover:bg-gray-700 text-white inline-flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" /> View plans
            </a>
          )}
        </div>
      )}

      {billing?.subscription?.cancel_at_period_end && (
        <p className="mt-3 text-xs text-amber-300/80">
          You can reactivate from the billing portal — your access continues until the period end.
        </p>
      )}
    </div>
  );
};

export default Settings;
