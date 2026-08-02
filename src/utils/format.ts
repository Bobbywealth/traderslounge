// Safe numeric display formatters — used across customer-facing surfaces.
// Every helper returns a sensible fallback string ("—", "N/A") for missing,
// NaN, Infinity, or impossible values, so the UI never shows raw `null`,
// `0/0`, `NaN`, or `undefined` to a trader.
//
// Phase 1 (ConfluenceX trust and consistency): these are the single source of
// truth for null-safe rendering. Pages and components should import from
// here rather than rolling their own toLocaleString / .toFixed calls.

const PLACEHOLDER = '—';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Generic wrapper: return the placeholder when the value is missing or
 * non-finite. Otherwise call `render` with the guaranteed-finite number.
 */
const withNumber = <T,>(
  value: unknown,
  render: (n: number) => T,
  placeholder: T,
): T => (isFiniteNumber(value) ? render(value) : placeholder);

/**
 * Detect "impossible" distance values — anything non-finite, zero, or
 * absurdly large. These slip into the UI when a pipeline returns Infinity
 * (e.g. entry == stop) or uncalibrated pips from upstream math.
 */
export const isImplausibleDistance = (value: unknown, maxPips = 1000): boolean => {
  if (!isFiniteNumber(value)) return true;
  if (Math.abs(value) > maxPips) return true;
  return false;
};

/**
 * Detect "impossible" reward-to-risk values. Above 20R the system has
 * miscalibrated and the figure is no longer trustworthy.
 */
export const isImplausibleRR = (value: unknown): boolean => {
  if (!isFiniteNumber(value)) return true;
  if (value <= 0) return true;
  if (value > 20) return true;
  return false;
};

/** Format a number as currency. Defaults to USD when no currency is given. */
export const formatCurrency = (
  value: unknown,
  options: { currency?: string; maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
  placeholder: string = PLACEHOLDER,
): string => withNumber(
  value,
  (n) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: options.currency || 'USD',
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  }).format(n),
  placeholder,
);

/** Format a percent with one decimal. Falls back to the placeholder on bad input. */
export const formatPercent = (
  value: unknown,
  options: { maximumFractionDigits?: number; signed?: boolean } = {},
  placeholder: string = PLACEHOLDER,
): string => withNumber(
  value,
  (n) => {
    const digits = options.maximumFractionDigits ?? 1;
    const formatted = n.toFixed(digits);
    if (options.signed && n > 0 && !formatted.startsWith('-')) return `+${formatted}%`;
    return `${formatted}%`;
  },
  placeholder,
);

/** Format an integer (win counts, trade counts, bars, etc.). */
export const formatInt = (
  value: unknown,
  placeholder: string = PLACEHOLDER,
): string => withNumber(value, (n) => Math.round(n).toLocaleString('en-US'), placeholder);

/** Format a price using broker-aware decimals. */
export const formatPrice = (
  value: unknown,
  options: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
  placeholder: string = PLACEHOLDER,
): string => withNumber(
  value,
  (n) => {
    const maxDigits = options.maximumFractionDigits
      ?? (Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 10 ? 4 : 5);
    const minDigits = options.minimumFractionDigits ?? 0;
    return n.toLocaleString('en-US', {
      maximumFractionDigits: maxDigits,
      minimumFractionDigits: minDigits,
    });
  },
  placeholder,
);

/**
 * Format pips / points with an "invalid" sentinel for impossible distances.
 * Returns "—" when the value is non-finite, zero, or beyond maxPips.
 */
export const formatPips = (
  value: unknown,
  options: { maxPips?: number; unit?: string } = {},
  placeholder: string = '—',
): string => {
  if (isImplausibleDistance(value, options.maxPips ?? 1000)) return placeholder;
  const unit = options.unit ? ` ${options.unit}` : '';
  const n = value as number;
  return `${n.toFixed(1)}${unit}`;
};

/**
 * Format reward-to-risk with the same "invalid" sentinel. Anything above 20R
 * is treated as a miscalibrated upstream figure, not a real edge.
 */
export const formatRR = (
  value: unknown,
  options: { unit?: string; max?: number } = {},
  placeholder: string = '—',
): string => {
  if (isImplausibleRR(value)) return placeholder;
  const unit = options.unit || 'R';
  const n = value as number;
  return `${n.toFixed(2)}${unit}`;
};

/**
 * Canonical score formatter — 0–100 integer with a "%" suffix.
 * Out-of-range values are clamped so a bad upstream figure never displays
 * as "137%" or "-12%".
 */
export const formatScore = (
  value: unknown,
  placeholder: string = PLACEHOLDER,
): string => withNumber(
  value,
  (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`,
  placeholder,
);

/** Compact relative-time formatter for "as of HH:MM" / "5 min ago" labels. */
export const formatRelative = (
  timestamp: Date | string | number | null | undefined,
  now: Date = new Date(),
): string => {
  if (timestamp === null || timestamp === undefined) return PLACEHOLDER;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return PLACEHOLDER;
  const diffMs = now.getTime() - ms;
  if (diffMs < 0) return 'in the future';
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
};

/** Format a timestamp as a short HH:MM clock in the user's local zone. */
export const formatClock = (
  timestamp: Date | string | number | null | undefined,
  placeholder: string = PLACEHOLDER,
): string => {
  if (timestamp === null || timestamp === undefined) return placeholder;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return placeholder;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** Returns true when a timestamp is older than the supplied age threshold. */
export const isStale = (
  timestamp: Date | string | number | null | undefined,
  now: Date = new Date(),
  maxAgeMs: number = 5 * 60_000,
): boolean => {
  if (timestamp === null || timestamp === undefined) return true;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return true;
  return now.getTime() - ms > maxAgeMs;
};