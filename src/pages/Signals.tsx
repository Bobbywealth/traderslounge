import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2,
  Clock3, RefreshCw, ShieldCheck, Target, Zap,
} from 'lucide-react';
import { bwtsApi, type PublishedSignal } from '../services/bwtsApi';

type FeedFilter = 'ACTIVE' | 'ALL';

const Signals: React.FC = () => {
  const [signals, setSignals] = useState<PublishedSignal[]>([]);
  const [filter, setFilter] = useState<FeedFilter>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      bwtsApi.clearCache();
      const response = await bwtsApi.publishedSignals({
        status: filter === 'ACTIVE' ? 'ACTIVE' : undefined,
        limit: 100,
      });
      setSignals(Array.isArray(response.signals) ? response.signals : []);
      setUpdatedAt(new Date());
    } catch (err: any) {
      setError(err?.message || 'The signal feed is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const active = useMemo(() => signals.filter((signal) => signal.status === 'ACTIVE'), [signals]);
  const strong = active.filter((signal) => signal.setup_quality === 'STRONG').length;
  const averageScore = active.length
    ? Math.round(active.reduce((sum, signal) => sum + signal.score, 0) / active.length)
    : 0;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#080d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(34,211,238,0.14),transparent_34%),radial-gradient(circle_at_90%_30%,rgba(139,92,246,0.16),transparent_38%)]" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1 text-[10px] font-black tracking-[0.2em] text-emerald-300">
              <ShieldCheck className="h-3 w-3" /> GUARDED V2 SIGNAL FEED
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">Trade Signals</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Only fully qualified BUY or SELL setups appear here. Every call includes entry, invalidation,
              targets, timeframe, risk-to-reward, and publication time.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/15 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh feed
          </button>
        </div>
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Active calls" value={String(active.length)} />
          <Metric label="Strong setups" value={String(strong)} />
          <Metric label="Average score" value={active.length ? `${averageScore}/100` : '—'} />
          <Metric label="Engine" value="V2 guarded" />
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#090d18] p-4">
        <div className="flex rounded-xl border border-white/[0.07] bg-black/20 p-1">
          {(['ACTIVE', 'ALL'] as FeedFilter[]).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-wider transition ${
                filter === value ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {value === 'ACTIVE' ? 'Active signals' : 'Signal history'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
          <Clock3 className="h-3.5 w-3.5" />
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Loading feed'}
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle className="h-5 w-5" /> {error}
        </div>
      )}

      {!loading && !error && signals.length === 0 && (
        <section className="rounded-[24px] border border-dashed border-white/10 bg-[#090d18] px-6 py-14 text-center">
          <Activity className="mx-auto h-11 w-11 text-slate-700" />
          <h2 className="mt-4 text-xl font-black text-white">No active signal right now</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
            The scanner is still watching every tracked market. A call will publish here only after direction,
            timing, calendar, data quality, structure, and minimum 2R movement all pass.
          </p>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {signals.map((signal) => <SignalCall key={signal.id} signal={signal} />)}
      </div>

      <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.05] p-4 text-xs leading-5 text-amber-100/70">
        <strong className="text-amber-200">Risk note:</strong> Signals are deterministic market intelligence, not guaranteed outcomes or personalized financial advice. Confirm price is still within the entry area and size risk from the published stop before acting.
      </div>
    </div>
  );
};

const SignalCall: React.FC<{ signal: PublishedSignal }> = ({ signal }) => {
  const isBuy = signal.direction === 'BUY';
  const published = new Date(signal.published_at);
  return (
    <article className={`overflow-hidden rounded-[24px] border ${isBuy ? 'border-emerald-400/20' : 'border-rose-400/20'} bg-[#080d18] shadow-xl shadow-black/20`}>
      <div className={`flex items-center justify-between border-b px-5 py-4 ${isBuy ? 'border-emerald-400/15 bg-emerald-400/[0.06]' : 'border-rose-400/15 bg-rose-400/[0.06]'}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${isBuy ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
            {isBuy ? <ArrowUpRight className="h-6 w-6" /> : <ArrowDownRight className="h-6 w-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white">{signal.pair}</h2>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${isBuy ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>{signal.direction}</span>
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{signal.timeframe} · Published {published.toLocaleString()}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-[10px] font-black uppercase tracking-wider ${isBuy ? 'text-emerald-300' : 'text-rose-300'}`}>{signal.status.replaceAll('_', ' ')}</div>
          <div className="mt-1 text-lg font-black text-white">{signal.score}/100</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-white/[0.05] sm:grid-cols-5">
        <Level label="Entry" value={formatPrice(signal.entry)} tone="cyan" />
        <Level label="Stop loss" value={formatPrice(signal.stop_loss)} tone="rose" />
        <Level label="TP1" value={formatPrice(signal.tp1)} tone="emerald" />
        <Level label="TP2" value={formatPrice(signal.tp2)} tone="emerald" />
        <Level label="TP3" value={formatPrice(signal.tp3)} tone="emerald" />
      </div>

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Setup" value={signal.setup_quality} icon={Zap} />
          <Fact label="Net available R:R" value={signal.net_rr ? `${signal.net_rr.toFixed(2)}R` : '—'} icon={Target} />
          <Fact label="Risk model" value={signal.risk_percent ? `${signal.risk_percent}%` : '—'} icon={ShieldCheck} />
          <Fact label="Calendar" value={signal.calendar_status} icon={CheckCircle2} />
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-600">Trade thesis</div>
          <p className="mt-1.5 text-sm leading-6 text-slate-300">{signal.scenario}</p>
        </div>
        {signal.rationale?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {signal.rationale.map((reason) => (
              <span key={reason} className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold text-slate-400">{reason}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-3">
    <div className="text-[9px] font-black uppercase tracking-widest text-slate-600">{label}</div>
    <div className="mt-1 text-lg font-black text-white">{value}</div>
  </div>
);

const Level: React.FC<{ label: string; value: string; tone: 'cyan' | 'rose' | 'emerald' }> = ({ label, value, tone }) => (
  <div className="bg-[#0b101d] p-4 text-center">
    <div className="text-[9px] font-black uppercase tracking-widest text-slate-600">{label}</div>
    <div className={`mt-1 text-sm font-black ${tone === 'rose' ? 'text-rose-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-cyan-300'}`}>{value}</div>
  </div>
);

const Fact: React.FC<{ label: string; value: string; icon: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
    <Icon className="h-4 w-4 text-slate-500" />
    <div className="mt-2 text-[9px] font-black uppercase tracking-wider text-slate-600">{label}</div>
    <div className="mt-0.5 text-xs font-black text-slate-200">{value}</div>
  </div>
);

const formatPrice = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
};

export default Signals;
