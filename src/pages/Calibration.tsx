/**
 * Calibration Dashboard — predicted vs observed outcome rates, by confidence bucket.
 *
 * Reads the existing /api/validation/report (which already returns
 * sample_size, brier_score, calibration_error, calibrated, and
 * reliability_bins). Renders the per-bucket table Bobby described:
 * "Predicted 60-69 -> actual 62%" plus a summary card and per-dimension
 * segments (by_score_band, by_session, etc.) when available.
 *
 * Honest empty state: when sample_size is 0 we surface INSUFFICIENT_DATA
 * and do NOT fabricate or extrapolate rates. The dashboard is read-only
 * and explicitly disclaims that scenario weights are not probabilities
 * until sufficient forward outcomes have been validated.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, RefreshCw } from 'lucide-react';
import { bwtsApi } from '../services/bwtsApi';
import type { ValidationReport } from '../services/bwtsApi';

type ReliabilityBin = {
  lower_bound: number;
  upper_bound: number;
  sample_size: number;
  mean_forecast: number | null;
  observed_rate: number | null;
  gap: number | null;
};

const pct = (x: number | null | undefined, digits = 1): string => {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
};

const fmtBin = (b: ReliabilityBin): string =>
  `${(b.lower_bound * 100).toFixed(0)}–${(b.upper_bound * 100).toFixed(0)}%`;

/** Color the per-bucket observed-vs-predicted gap. Green when observed
 *  is within 5pp of the bucket midpoint; amber within 10pp; red beyond. */
const gapTone = (bin: ReliabilityBin): string => {
  if (bin.observed_rate === null || bin.gap === null) return 'cx-text-faint';
  const g = Math.abs(bin.gap);
  if (g < 0.05) return 'text-emerald-300';
  if (g < 0.10) return 'text-amber-300';
  return 'text-rose-300';
};

const CalibrationPage: React.FC = () => {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await bwtsApi.validationReport();
      setReport(data);
      setLastFetched(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Failed to load validation report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totalSample = report?.calibration?.sample_size ?? 0;
  const hasData = totalSample > 0;
  const bins = report?.calibration?.reliability_bins ?? [];

  const segmentDimensions = useMemo(() => {
    if (!report?.segments) return [] as Array<[string, Record<string, any>]>;
    return Object.entries(report.segments).filter(([, v]) => v && Object.keys(v).length > 0);
  }, [report]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-3">
            <Gauge className="w-7 h-7 text-cyan-300" />
            Calibration Dashboard
          </h1>
          <p className="mt-2 cx-text-muted max-w-2xl">
            Predicted confidence vs. observed win rate. When the engine says it is{' '}
            <span className="cx-text-strong">80% confident</span>, how often does it actually win?
            This is the only honest measure of whether the platform has earned its edge.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl border cx-border-strong cx-bg-card px-3 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          aria-label="Refresh calibration report"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {error && (
        <section className="rounded-2xl border border-rose-500/40 cx-bg-card p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-rose-200">Failed to load report</div>
            <div className="text-sm cx-text-muted mt-1">{error}</div>
          </div>
        </section>
      )}

      {loading && !report && (
        <div className="animate-pulse cx-text-muted">Loading calibration report…</div>
      )}

      {report && (
        <>
          {/* Status banner */}
          <section
            className={`rounded-2xl border p-5 flex items-start gap-3 ${
              hasData
                ? report.calibration.calibrated
                  ? 'border-emerald-500/40 cx-bg-card'
                  : 'border-amber-500/40 cx-bg-card'
                : 'border-slate-600/40 cx-bg-card'
            }`}
          >
            {hasData ? (
              report.calibration.calibrated ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
              )
            ) : (
              <AlertTriangle className="w-5 h-5 cx-text-faint flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <div className="font-bold">
                {!hasData
                  ? 'INSUFFICIENT_DATA — not enough resolved setups yet'
                  : report.calibration.calibrated
                  ? 'Calibrated'
                  : 'Not yet calibrated'}
              </div>
              <div className="text-sm cx-text-muted mt-1">
                {report.warning ||
                  (hasData
                    ? `Brier score ${report.calibration.brier_score.toFixed(3)} across ${totalSample} resolved setups.`
                    : `${report.pending} setups pending outcome, ${report.resolved} resolved. The reliability table below is intentionally blank until outcomes accumulate.`)}
              </div>
            </div>
          </section>

          {/* Summary stats */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Resolved setups"
              value={String(report.resolved)}
              hint={`${report.pending} pending`}
            />
            <StatCard
              label="Sample size"
              value={String(totalSample)}
              hint={hasData ? 'in reliability bins' : '—'}
            />
            <StatCard
              label="Brier score"
              value={hasData ? report.calibration.brier_score.toFixed(3) : '—'}
              hint="lower is better (0 = perfect)"
            />
            <StatCard
              label="Calibration error"
              value={hasData ? pct(report.calibration.calibration_error) : '—'}
              hint="weighted gap across buckets"
            />
          </section>

          {/* Reliability table — the headline view */}
          <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-bold">Reliability by confidence bucket</h2>
              <span className="text-xs cx-text-faint">
                {hasData
                  ? `${bins.filter((b) => b.sample_size > 0).length} of ${bins.length} buckets populated`
                  : 'No buckets populated yet'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left cx-text-faint">
                    <th className="px-3 py-2 font-semibold">Predicted</th>
                    <th className="px-3 py-2 font-semibold text-right">Mean forecast</th>
                    <th className="px-3 py-2 font-semibold text-right">Observed win rate</th>
                    <th className="px-3 py-2 font-semibold text-right">Gap</th>
                    <th className="px-3 py-2 font-semibold text-right">Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {bins.map((bin) => (
                    <tr key={`${bin.lower_bound}-${bin.upper_bound}`} className="border-t cx-border">
                      <td className="px-3 py-2 font-semibold">{fmtBin(bin)}</td>
                      <td className="px-3 py-2 text-right cx-text-muted">
                        {bin.mean_forecast === null ? '—' : pct(bin.mean_forecast)}
                      </td>
                      <td className={`px-3 py-2 text-right font-bold ${gapTone(bin)}`}>
                        {bin.observed_rate === null ? '—' : pct(bin.observed_rate)}
                      </td>
                      <td className={`px-3 py-2 text-right ${gapTone(bin)}`}>
                        {bin.gap === null ? '—' : (bin.gap > 0 ? '+' : '') + pct(bin.gap)}
                      </td>
                      <td className="px-3 py-2 text-right cx-text-muted">
                        {bin.sample_size === 0 ? '0' : bin.sample_size}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs cx-text-faint">
              A gap of <span className="text-emerald-300">0</span> means the engine's confidence
              matched its observed win rate for that bucket. Green = well-calibrated, amber = mild
              drift, red = systematic miscalibration. Empty buckets are not interpolated.
            </p>
          </section>

          {/* Per-dimension segments */}
          {segmentDimensions.length > 0 && (
            <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
              <h2 className="text-lg font-bold mb-4">Calibration by dimension</h2>
              <div className="space-y-4">
                {segmentDimensions.map(([dim, values]) => (
                  <div key={dim}>
                    <div className="text-sm font-semibold cx-text-muted mb-2">{dim}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {Object.entries(values).map(([segmentLabel, m]) => (
                        <div
                          key={segmentLabel}
                          className="rounded-xl border cx-border cx-bg-elev p-3"
                        >
                          <div className="text-xs cx-text-faint">{segmentLabel}</div>
                          <div className="mt-1 text-xl font-black">
                            {m?.sample_size ?? 0}{' '}
                            <span className="text-xs cx-text-faint font-normal">samples</span>
                          </div>
                          <div className="mt-1 text-xs cx-text-muted">
                            Brier{' '}
                            {typeof m?.brier_score === 'number'
                              ? m.brier_score.toFixed(3)
                              : '—'}{' '}
                            · Cal err{' '}
                            {typeof m?.calibration_error === 'number'
                              ? pct(m.calibration_error)
                              : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Walk-forward integrity */}
          {report.walk_forward && (
            <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
              <h2 className="text-lg font-bold mb-2">Walk-forward integrity</h2>
              <div className="text-sm cx-text-muted">
                {report.walk_forward.no_lookahead
                  ? 'No-look-ahead enforced'
                  : 'No-look-ahead not enforced'}{' '}
                · {report.walk_forward.folds_used} folds used
              </div>
              <div className="mt-3 text-xs cx-text-faint">
                Out-of-sample sample size:{' '}
                {report.walk_forward.out_of_sample?.sample_size ?? 0} · Brier{' '}
                {typeof report.walk_forward.out_of_sample?.brier_score === 'number'
                  ? report.walk_forward.out_of_sample.brier_score.toFixed(3)
                  : '—'}
              </div>
            </section>
          )}

          <section className="text-xs cx-text-faint">
            <p>
              Calibration is a property of probabilities, not point predictions. Sample size
              thresholds below ~30 per bucket should be treated as suggestive only — not enough
              evidence to recalibrate weights or adjust sizing.
            </p>
            {lastFetched > 0 && (
              <p className="mt-1">Last fetched {new Date(lastFetched).toLocaleTimeString()}.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
};

const StatCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
    <div className="text-sm cx-text-faint">{label}</div>
    <div className="mt-1 text-2xl font-black cx-text-strong">{value}</div>
    {hint && <div className="mt-1 text-xs cx-text-faint">{hint}</div>}
  </div>
);

export default CalibrationPage;
