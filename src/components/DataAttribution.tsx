// Reusable "data attribution" badge — provider name + freshness timestamp.
// Used on every chart and data block so customers always know where the
// numbers come from and how recent they are.
//
// Phase 1 (ConfluenceX trust and consistency): replaces the inconsistent
// "Live" pulse, blank "—" labels, and missing provider tags across pages.

import React from 'react';
import { Activity, AlertTriangle, Database, Wifi, WifiOff } from 'lucide-react';
import { formatClock, formatRelative, isStale } from '../utils/format';

export type ProviderName =
  | 'Binance'
  | 'TradeLocker'
  | 'Twelve Data'
  | 'Financial Modeling Prep'
  | 'Scanner'
  | 'Internal';

interface DataAttributionProps {
  /** Provider name. Free-form but should match one of the canonical labels. */
  provider?: ProviderName | string | null;
  /** Timestamp the data was last refreshed. Accepts Date, ISO string, or epoch ms/sec. */
  timestamp?: Date | string | number | null;
  /** Reference time used to compute the relative label. Defaults to now(). */
  now?: Date;
  /** Whether the source is currently live (streaming) or a periodic snapshot. */
  live?: boolean;
  /** Override the staleness threshold in milliseconds. Defaults to 5 minutes. */
  maxAgeMs?: number;
  /** Visual variant. 'inline' fits inside chips; 'block' stands on its own. */
  variant?: 'inline' | 'block';
  /** Optional extra context, e.g. "1H timeframe". */
  detail?: string;
  className?: string;
}

const STALE_THRESHOLD_MS = 5 * 60_000;

const DataAttribution: React.FC<DataAttributionProps> = ({
  provider,
  timestamp,
  now,
  live = false,
  maxAgeMs = STALE_THRESHOLD_MS,
  variant = 'inline',
  detail,
  className = '',
}) => {
  const stale = isStale(timestamp, now, maxAgeMs);
  const freshLabel = timestamp ? formatClock(timestamp, 'unknown') : 'unknown';
  const relativeLabel = formatRelative(timestamp, now);
  const providerLabel = provider && provider.length > 0 ? provider : 'unknown provider';
  const StatusIcon = !provider ? WifiOff : live && !stale ? Wifi : stale ? AlertTriangle : Database;
  const tone = !provider
    ? 'border-slate-400/20 bg-slate-400/[0.06] text-slate-400'
    : stale
      ? 'border-amber-400/30 bg-amber-400/[0.08] text-amber-200'
      : live
        ? 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300'
        : 'border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-200';

  if (variant === 'block') {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider ${className}`}>
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${tone}`}>
          <StatusIcon className="h-3 w-3" />
          <span>{providerLabel}</span>
          {live && !stale && <span className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
        </span>
        <span className="text-slate-500" title={relativeLabel}>
          As of {freshLabel}
          {stale && provider ? ' · stale' : ''}
        </span>
        {detail && <span className="text-slate-600">{detail}</span>}
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${className}`}>
      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${tone}`}>
        <StatusIcon className="h-3 w-3" />
        {providerLabel}
      </span>
      <span className="text-slate-500" title={relativeLabel}>
        {stale && provider ? 'stale · ' : 'as of '}
        {freshLabel}
      </span>
      {detail && <span className="text-slate-600">{detail}</span>}
    </span>
  );
};

/**
 * Live data pulse — small animated dot + "Live" / "Stale" / "Offline" label.
 * Use this when only the freshness matters and the provider name is already
 * shown elsewhere on the page (e.g. inside TradingView's chart header).
 */
export const DataFreshnessPulse: React.FC<{
  timestamp?: Date | string | number | null;
  now?: Date;
  maxAgeMs?: number;
  provider?: string | null;
  className?: string;
}> = ({ timestamp, now, maxAgeMs, provider, className = '' }) => {
  const stale = isStale(timestamp, now, maxAgeMs);
  const label = !provider ? 'Offline' : stale ? 'Stale' : 'Live';
  const tone = !provider
    ? 'border-slate-400/30 bg-slate-400/10 text-slate-300'
    : stale
      ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';
  const Icon = !provider ? WifiOff : stale ? AlertTriangle : Activity;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${tone} ${className}`}>
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      {!stale && provider && <span className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
    </span>
  );
};

export default DataAttribution;