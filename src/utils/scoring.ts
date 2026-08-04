// Canonical scoring helpers — single source of truth for the 0–100 scale.
//
// Phase 1 (ConfluenceX trust and consistency): every customer-facing score
// (V2 total, market bias, setup quality, execution readiness, scenario
// weight, sub-score, etc.) routes through these helpers so the scale and
// tone never drift between Settings, Signals, Dashboard, and the chart
// analysis panel.

import { formatScore as formatScoreRaw } from './format';

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Clamp a raw score into the canonical 0–100 range. Non-finite -> 0. */
export const clampScore = (value: unknown): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, n));
};

/** Score as a percentage string with the canonical 0–100 clamp applied. */
export const formatScore = (value: unknown, placeholder = '—'): string =>
  formatScoreRaw(value, placeholder);

/**
 * Score as an integer / 100 (e.g. "78/100"). Used in row cards and badges
 * where the percentage suffix is redundant.
 */
export const formatScoreOver100 = (value: unknown, placeholder = '—'): string => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  if (!Number.isFinite(n)) return placeholder;
  const clamped = clampScore(n);
  return `${Math.round(clamped)}/100`;
};

/**
 * Tone bucket used by chips, rings, and badges. Three buckets keep the UI
 * consistent: ≥70 strong, ≥45 developing, otherwise quiet.
 */
export type ScoreTone = 'strong' | 'developing' | 'quiet';

export const scoreTone = (value: unknown): ScoreTone => {
  const n = clampScore(value);
  if (n >= 70) return 'strong';
  if (n >= 45) return 'developing';
  return 'quiet';
};

/** Tailwind class lookup keyed off the canonical tone buckets. */
export const scoreToneClass = (value: unknown): string => {
  const tone = scoreTone(value);
  if (tone === 'strong') return 'text-cyan-300';
  if (tone === 'developing') return 'text-violet-300';
  return 'cx-text-muted';
};

/**
 * Tier label bucket used in headers and section eyebrows. Mirrors the
 * thresholds documented to the user — strong / developing / quiet.
 */
export const scoreTierLabel = (value: unknown): string => {
  const tone = scoreTone(value);
  if (tone === 'strong') return 'Strong';
  if (tone === 'developing') return 'Developing';
  return 'Quiet';
};

/**
 * Threshold check: does this score clear the configured "strong" gate?
 * Kept here so Settings, Scanner, and Signals share the same logic.
 */
export const isStrongScore = (value: unknown, threshold = 60): boolean =>
  clampScore(value) >= threshold;