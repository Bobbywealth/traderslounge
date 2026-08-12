/**
 * Portfolio Risk Brain dashboard.
 *
 * Reads /api/portfolio/risk and surfaces the cross-asset, USD-exposure,
 * directional-cluster, and portfolio-heat view.  Mirrors the
 * Calibration dashboard pattern: a dedicated page with an honest empty
 * state, per-dimension chips, and the exact 'Recommended risk on new
 * setups' number Bobby specified.
 *
 * Honest empty state when setup_count === 0: "Portfolio flat" — the
 * loop hasn't wired any active setups into ApiState.autonomy_setup_lifecycle
 * yet, so the report correctly shows zero exposure.  This is the empty
 * state, not an error.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Briefcase, CheckCircle2, ChevronRight, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { bwtsApi } from '../services/bwtsApi';
import type { PortfolioRiskReport } from '../services/bwtsApi';

const pct = (x: number | null | undefined, digits = 2): string => {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${x.toFixed(digits)}%`;
};

const fmtR = (x: number | null | undefined): string => {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const sign = x > 0 ? '+' : '';
  return `${sign}${x.toFixed(2)}%`;
};

const toneForHeat = (heat: number, limit: number): string => {
  if (heat >= limit) return 'text-rose-300';
  if (heat >= limit * 0.75) return 'text-amber-300';
  return 'text-emerald-300';
};

const PortfolioRiskPage: React.FC = () => {
  const [report, setReport] = useState<PortfolioRiskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await bwtsApi.portfolioRisk();
      setReport(data);
      setLastFetched(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Failed to load portfolio risk');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const heat = report?.heat_pct ?? 0;
  const heatLimit = report?.heat_limit_pct ?? 6;
  const setupCount = report?.setup_count ?? 0;
  const hasExposure = setupCount > 0;

  const exposures = Object.entries(report?.exposure_by_currency || {});
    const sectors = Object.entries(report?.sector_exposure || {});
  const clusters = Object.entries(report?.directional_clusters || {});
  const warnings = report?.warnings || [];
  const recommended = report?.recommended_size_pct;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-cyan-300" />
            Portfolio Risk Brain
          </h1>
          <p className="mt-2 cx-text-muted max-w-2xl">
            Cross-asset exposure, directional clusters, and portfolio heat.
            Four "separate" setups in USD-positive pairs are a single
            USD-short bet — this view makes that explicit.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl border cx-border-strong cx-bg-card px-3 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          aria-label="Refresh portfolio risk"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {error && (
        <section className="rounded-2xl border border-rose-500/40 cx-bg-card p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-rose-200">Failed to load portfolio risk</div>
            <div className="text-sm cx-text-muted mt-1">{error}</div>
          </div>
        </section>
      )}

      {loading && !report && (
        <div className="animate-pulse cx-text-muted">Loading portfolio risk…</div>
      )}

      {report && (
        <>
          {/* Status banner */}
          <section
            className={`rounded-2xl border p-5 flex items-start gap-3 ${
              warnings.length > 0
                ? 'border-amber-500/40 cx-bg-card'
                : 'border-emerald-500/40 cx-bg-card'
            }`}
          >
            {warnings.length > 0 ? (
              <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <div className="font-bold">
                {!hasExposure
                  ? 'PORTFOLIO FLAT — no active setups'
                  : warnings.length > 0
                  ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
                  : 'Within risk limits'}
              </div>
              <div className="text-sm cx-text-muted mt-1">
                {!hasExposure
                  ? `${setupCount} active setups. Heat, exposure, and recommendations appear once the autonomy loop writes active setups into ApiState.autonomy_setup_lifecycle.`
                  : warnings.length > 0
                  ? warnings.join(' · ')
                  : `Heat ${pct(heat)} is below the ${pct(heatLimit)} limit. ${setupCount} active setup${setupCount === 1 ? '' : 's'} contributing.`}
              </div>
            </div>
          </section>

          {/* Headline stats */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Portfolio heat"
              value={pct(heat)}
              tone={toneForHeat(heat, heatLimit)}
              hint={`limit ${pct(heatLimit, 1)}`}
              icon={heat >= heatLimit ? TrendingDown : TrendingUp}
            />
            <StatCard
              label="Open risk"
              value={pct(report.open_risk_pct)}
              hint={`${setupCount} active`}
            />
            <StatCard
              label="Daily risk (24h)"
              value={pct(report.daily_risk_pct)}
              hint="new setups in last day"
            />
            <StatCard
              label="Weekly drawdown"
              value={fmtR(report.weekly_drawdown_pct)}
              hint="realized P&L last 7d"
            />
          </section>

          {/* Recommended sizing */}
          {recommended !== null && recommended !== undefined && (
            <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
              <div className="flex items-center gap-3">
                <ChevronRight className="w-5 h-5 text-cyan-300" />
                <div className="flex-1">
                  <div className="font-bold">Recommended risk on new setups</div>
                  <div className="text-sm cx-text-muted mt-1">
                    Current heat ({pct(heat)}) is at or above the limit ({pct(heatLimit)}).
                    Size new setups at <span className="text-emerald-300 font-bold">{pct(recommended)}</span> per trade
                    instead of the default {pct(report.default_risk_pct)} to keep heat at the limit.
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Warnings list */}
          {warnings.length > 0 && (
            <section className="rounded-2xl border border-amber-500/40 cx-bg-card p-6 space-y-2">
              <div className="font-bold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-300" />
                Warnings
              </div>
              {warnings.map((w, idx) => (
                <div key={idx} className="text-sm cx-text-muted">
                  ⚠ {w}
                </div>
              ))}
            </section>
          )}

          {/* USD exposure + sector breakdown */}
          {hasExposure && (
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BreakdownCard
                title="USD exposure"
                entries={exposures}
                valueLabel="% of equity"
                hintNegative="short USD"
                hintPositive="long USD"
              />
              <BreakdownCard
                title="Sector exposure"
                entries={sectors}
                valueLabel="% of equity"
              />
            </section>
          )}

          {/* Directional clusters */}
          {clusters.length > 0 && (
            <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
              <div className="font-bold mb-4">Directional clusters</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {clusters.map(([sector, dirs]) => (
                  <div key={sector} className="rounded-xl border cx-border cx-bg-elev p-4">
                    <div className="text-xs cx-text-faint">{sector}</div>
                    {Object.entries(dirs).map(([dir, value]) => (
                      <div key={dir} className="mt-1 flex items-center justify-between">
                        <span className={`text-sm font-semibold ${dir === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {dir}
                        </span>
                        <span className="text-sm">{pct(value as number)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Cross-symbol correlation matrix (compact) */}
          {report && Object.keys(report.correlation_matrix || {}).length > 1 && (
            <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
              <div className="font-bold mb-2">Correlation matrix</div>
              <div className="text-xs cx-text-faint mb-3">
                Pairwise symbol correlation across active setups. Same-cluster same-direction setups carry the highest
                cluster risk (close to +1.0).
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="cx-text-faint">
                      <th className="px-2 py-1 text-left"></th>
                      {Object.keys(report.correlation_matrix).map((s) => (
                        <th key={s} className="px-2 py-1 text-right font-mono">{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.correlation_matrix).map(([a, row]) => (
                      <tr key={a}>
                        <th className="px-2 py-1 text-left font-mono cx-text-faint">{a}</th>
                        {Object.entries(row).map(([b, c]) => (
                          <td
                            key={b}
                            className={`px-2 py-1 text-right ${
                              c > 0.5 ? 'text-rose-300' : c < -0.3 ? 'text-emerald-300' : 'cx-text-faint'
                            }`}
                          >
                            {(c as number).toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Gold correlation + footer */}
          <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="font-bold">Gold / portfolio correlation</div>
                <div className="text-sm cx-text-muted mt-1">
                  Average pairwise correlation between XAUUSD and every other active symbol
                  (excluding self). Negative means gold is hedging; positive means it's reinforcing.
                </div>
              </div>
              <div className={`text-2xl font-black ${report.gold_usd_correlation < 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                {report.gold_usd_correlation.toFixed(2)}
              </div>
            </div>
          </section>

          <section className="text-xs cx-text-faint">
            <p>
              Heat includes only currently-active setups. Weekly drawdown is realised P&amp;L from the past 7 days.
              Recommendations assume each new setup is risk-sized at the configured per-trade cap; the dashboard
              does not modify live sizing — that's a future autonomy integration.
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
  tone = 'cx-text-strong',
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  icon?: React.ElementType;
}) => (
  <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
    <div className="text-sm cx-text-faint flex items-center gap-2">
      {Icon ? <Icon className="w-4 h-4" /> : null}
      {label}
    </div>
    <div className={`mt-1 text-2xl font-black ${tone}`}>{value}</div>
    {hint && <div className="mt-1 text-xs cx-text-faint">{hint}</div>}
  </div>
);

const BreakdownCard = ({
  title,
  entries,
  valueLabel,
  hintNegative,
  hintPositive,
}: {
  title: string;
  entries: Array<[string, number]>;
  valueLabel: string;
  hintNegative?: string;
  hintPositive?: string;
}) => {
  if (entries.length === 0) {
    return (
      <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
        <div className="font-bold">{title}</div>
        <div className="text-sm cx-text-faint mt-2">No exposures yet.</div>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
      <div className="font-bold mb-3">{title}</div>
      <div className="space-y-2">
        {entries.map(([key, value]) => {
          const isNegative = typeof value === 'number' && value < 0;
          return (
            <div key={key} className="flex items-center justify-between rounded-lg border cx-border cx-bg-elev px-3 py-2">
              <span className="font-mono text-sm">{key}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs cx-text-faint">{valueLabel}</span>
                <span className={`text-sm font-bold ${isNegative ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {value > 0 ? '+' : ''}
                  {(value as number).toFixed(2)}%
                </span>
                {isNegative && hintNegative && (
                  <span className="text-xs cx-text-faint">({hintNegative})</span>
                )}
                {!isNegative && hintPositive && (
                  <span className="text-xs cx-text-faint">({hintPositive})</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default PortfolioRiskPage;
