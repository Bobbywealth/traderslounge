import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCcw,
  Search,
  TrendingDown,
  TrendingUp,
  Zap,
  AlertTriangle,
  Inbox,
} from 'lucide-react';
import { bwtsApi, AlertEvent } from '../services/bwtsApi';

/**
 * Notifications — historical feed of every alert the engine has fired
 * across all channels (in-app feed + Telegram mirror + browser push).
 * Sibling to /alerts (settings) and /alerts preferences. Bobby 2026-08-11
 * wanted a place to actually *see* notifications, not just configure them.
 */

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';
type AlertTypeFilter = 'all' | AlertEvent['alert_type'];

// Severity visuals — left rail + low-opacity tint + high-contrast text.
// The card chrome stays a single neutral; severity is signalled by the
// left rail + icon badge, not by tinting the whole card, so info /
// warning / critical remain readable next to each other instead of
// muddying into a single dark wash (Bobby 2026-08-11 readability fix).
const SEVERITY_BADGE: Record<AlertEvent['severity'], string> = {
  info: 'bg-sky-500 text-white',
  warning: 'bg-amber-500 text-slate-900',
  critical: 'bg-rose-500 text-white',
};

// Strong outer left rail color per severity — readable on the dark card.
const SEVERITY_RAIL: Record<AlertEvent['severity'], string> = {
  info: 'bg-sky-400',
  warning: 'bg-amber-400',
  critical: 'bg-rose-400',
};

// High-contrast body text inside the card. Pinned to cx-text-strong so
// the body line stays readable on the dark card background.
const SEVERITY_BODY: Record<AlertEvent['severity'], string> = {
  info: 'text-sky-100',
  warning: 'text-amber-100',
  critical: 'text-rose-100',
};

const SEVERITY_ICON: Record<AlertEvent['severity'], React.ElementType> = {
  info: Zap,
  warning: AlertTriangle,
  critical: TrendingDown,
};

const TYPE_LABEL: Record<string, string> = {
  new_trade: 'New trade',
  entry_zone: 'Entry zone hit',
  confirmation: 'Setup confirmation',
  news_risk: 'News risk',
  invalidation: 'Setup invalidated',
  daily_briefing: 'Daily briefing',
  weekly_briefing: 'Weekly briefing',
};

function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'just now';
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

const Notifications: React.FC = () => {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [typeFilter, setTypeFilter] = useState<AlertTypeFilter>('all');
  const [pairFilter, setPairFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(100);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await bwtsApi.alertFeed(limit);
      setEvents(result.events || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
    // Light auto-refresh: notifications should feel live without hammering.
    timerRef.current = window.setInterval(load, 60_000);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  const availableTypes = useMemo<AlertEvent['alert_type'][]>(() => {
    const s = new Set<AlertEvent['alert_type']>();
    events.forEach((e) => s.add(e.alert_type));
    return Array.from(s);
  }, [events]);

  const availablePairs = useMemo(() => {
    const s = new Set<string>();
    events.forEach((e) => e.pair && s.add(e.pair));
    return Array.from(s).sort();
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (severity !== 'all' && e.severity !== severity) return false;
      if (typeFilter !== 'all' && e.alert_type !== typeFilter) return false;
      if (pairFilter !== 'all' && e.pair !== pairFilter) return false;
      if (unreadOnly && readIds.has(eKey(e))) return false;
      if (q) {
        const hay = `${e.title} ${e.body} ${e.pair}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, severity, typeFilter, pairFilter, search, unreadOnly, readIds]);

  const unreadCount = useMemo(
    () => events.filter((e) => !readIds.has(eKey(e))).length,
    [events, readIds],
  );

  const markAllRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      events.forEach((e) => next.add(eKey(e)));
      return next;
    });
  };

  const stats = useMemo(() => {
    const counts: Record<AlertEvent['severity'], number> = { info: 0, warning: 0, critical: 0 };
    events.forEach((e) => { counts[e.severity]++; });
    return counts;
  }, [events]);

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <Bell className="h-5 w-5" />
            <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          </div>
          <p className="mt-1 text-sm cx-text-muted">
            Every alert the engine has fired for you, across in-app feed, Telegram, and browser push.
            Use the filters to narrow by severity, type, or pair.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-lg border cx-border cx-bg-card-hover px-3 py-1.5 text-xs font-semibold"
            aria-label="Refresh notifications"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border cx-border cx-bg-card-hover px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark all read
          </button>
          <a
            href="/alerts"
            className="inline-flex items-center gap-1.5 rounded-lg border cx-border cx-bg-card-hover px-3 py-1.5 text-xs font-semibold"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Settings
          </a>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatPill label="Total" value={events.length} Icon={Inbox} tone="bg-sky-500 text-white" />
        <StatPill label="Unread" value={unreadCount} Icon={Bell} tone="bg-amber-500 text-slate-900" />
        <StatPill label="Info" value={stats.info} Icon={Zap} tone="bg-sky-500 text-white" />
        <StatPill label="Critical" value={stats.critical} Icon={TrendingDown} tone="bg-rose-500 text-white" />
      </section>

      <section className="rounded-2xl border cx-border cx-bg-card p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Filter className="h-3.5 w-3.5 cx-text-faint" />
          <PillSelect
            label="Severity"
            value={severity}
            onChange={(v) => setSeverity(v as SeverityFilter)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
          <PillSelect
            label="Type"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as AlertTypeFilter)}
            options={[
              { value: 'all', label: 'All' },
              ...availableTypes.map((t) => ({ value: t, label: TYPE_LABEL[t] || t })),
            ]}
          />
          <PillSelect
            label="Pair"
            value={pairFilter}
            onChange={(v) => setPairFilter(v)}
            options={[
              { value: 'all', label: 'All pairs' },
              ...availablePairs.map((p) => ({ value: p, label: p })),
            ]}
          />
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs cx-text-muted">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-400"
            />
            Unread only
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cx-text-faint" />
            <input
              type="search"
              placeholder="Search title or pair…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48 rounded-lg border cx-border cx-bg-card-hover py-1.5 pl-7 pr-3 text-xs cx-text placeholder:cx-text-faint"
              aria-label="Search notifications"
            />
          </div>
        </div>
      </section>

      {loading && events.length === 0 && (
        <section className="rounded-2xl border cx-border cx-bg-card p-5">
          <div className="flex items-center gap-2 text-sm cx-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications…
          </div>
        </section>
      )}

      {error && (
        <section className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-5">
          <div className="flex items-center gap-2 text-sm text-rose-300">
            <AlertTriangle className="h-4 w-4" /> Could not load notifications: {error}
          </div>
        </section>
      )}

      {!loading && events.length === 0 && (
        <section className="rounded-2xl border cx-border cx-bg-card p-10 text-center">
          <Inbox className="mx-auto h-10 w-10 cx-text-faint" />
          <h2 className="mt-3 text-sm font-semibold">No notifications yet</h2>
          <p className="mt-1 text-xs cx-text-muted">
            The engine hasn't fired anything that matches your preferences.
            Try lowering the quality minimum on the{' '}
            <a href="/alerts" className="text-cyan-300 underline">Alerts settings</a> page.
          </p>
        </section>
      )}

      {filtered.length === 0 && events.length > 0 && (
        <section className="rounded-2xl border cx-border cx-bg-card p-6 text-center text-xs cx-text-muted">
          No notifications match the current filters.
        </section>
      )}

      <ul className="space-y-2">
        {filtered.map((event) => (
          <NotificationCard
            key={eKey(event)}
            event={event}
            isRead={readIds.has(eKey(event))}
            onClick={() => setReadIds((prev) => {
              const next = new Set(prev);
              next.add(eKey(event));
              return next;
            })}
          />
        ))}
      </ul>

      {events.length >= limit && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setLimit((n) => n + 100)}
            className="inline-flex items-center gap-1.5 rounded-lg border cx-border cx-bg-card-hover px-3 py-1.5 text-xs font-semibold"
          >
            Load older
          </button>
        </div>
      )}
    </div>
  );
};

function eKey(e: AlertEvent): string {
  return `${e.alert_type}:${e.pair}:${e.created_at}`;
}

interface NotificationCardProps {
  event: AlertEvent;
  isRead: boolean;
  onClick: () => void;
}

const NotificationCard: React.FC<NotificationCardProps> = ({ event, isRead, onClick }) => {
  const Icon = SEVERITY_ICON[event.severity] || Bell;
  const badge = SEVERITY_BADGE[event.severity];
  const rail = SEVERITY_RAIL[event.severity];
  const bodyColor = SEVERITY_BODY[event.severity];
  return (
    <li>
      <button
        onClick={onClick}
        className={`group relative flex w-full items-stretch overflow-hidden rounded-xl border text-left transition ${
          isRead
            ? 'cx-border bg-slate-900/40 opacity-70'
            : 'border-slate-600 bg-slate-800/80'
        } hover:bg-slate-800`}
        data-testid="notification-card"
        data-severity={event.severity}
      >
        {/* Left severity rail — reads at a glance even when cards stack. */}
        <span className={`w-1.5 shrink-0 ${rail}`} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3">
          <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${badge}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`inline-flex rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${badge}`}>
                {TYPE_LABEL[event.alert_type] || event.alert_type}
              </span>
              {event.pair && (
                <span className="font-mono text-sm font-bold text-cyan-300">{event.pair}</span>
              )}
              {event.timeframe && (
                <span className="text-slate-400">{event.timeframe}</span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-slate-400">
                <Clock className="h-3 w-3" /> {timeAgo(event.created_at)}
              </span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-white">{event.title}</h3>
            <p className={`mt-1 text-sm leading-relaxed ${bodyColor}`}>{event.body}</p>
          </div>
        </div>
      </button>
    </li>
  );
};

interface StatPillProps {
  label: string;
  value: number;
  Icon: React.ElementType;
  tone: string;
}

const StatPill: React.FC<StatPillProps> = ({ label, value, Icon, tone }) => (
  <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 p-3">
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
      <Icon className="h-4 w-4" />
    </span>
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
    </div>
  </div>
);

interface PillSelectProps<T extends string> {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}

function PillSelect<T extends string>({ label, value, onChange, options }: PillSelectProps<T>) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="cx-text-faint">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border cx-border cx-bg-card-hover px-2 py-1 text-xs cx-text"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export default Notifications;