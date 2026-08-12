/**
 * HistoricalAnalogues — "what happened the last N times the setup looked like this?"
 *
 * Consumes bwtsApi.similarity(pair, timeframe) which calls /api/similarity.
 * That endpoint reads the same V2 analysis used by /api/analysis, joins it
 * against resolved forecast history, and ranks matches by normalized
 * feature distance. Surfaced in the UI as:
 *
 *   HISTORICAL MATCH
 *   143 comparable setups found
 *   WIN: 67.1%  LOSS: 25.2%  EXPIRED: 7.7%
 *   Average outcome: +1.31R
 *   During NY: 72.4% win   When DXY confirms: 74.6%
 *
 * Honest empty state: until journal_entries actually resolve (which only
 * started happening after the loop.py wiring fix in c7c116d), the report
 * returns NO_HISTORY and the panel surfaces that rather than fabricating.
 */
import React, { useEffect, useState } from 'react';
import { BarChart3, Database, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { bwtsApi } from '../services/bwtsApi';
import type { SimilarityReport } from '../services/bwtsApi';

interface HistoricalAnaloguesProps {
  pair?: string | null;
  timeframe?: string;
  /** Optional cap on visible top matches. Default 5 keeps the panel compact. */
  topN?: number;
}

const pct = (x: number | null | undefined, digits = 1): string => {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${x.toFixed(digits)}%`;
};

const r = (x: number | null | undefined): string => {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const sign = x > 0 ? '+' : '';
  return `${sign}${x.toFixed(2)}R`;
};

const statusLabel: Record<SimilarityReport['status'], string> = {
  USABLE: 'USABLE',
  LIMITED_SAMPLE: 'LIMITED_SAMPLE',
  NO_HISTORY: 'NO_HISTORY',
};

const statusTone: Record<SimilarityReport['status'], string> = {
  USABLE: 'text-emerald-300',
  LIMITED_SAMPLE: 'text-amber-300',
  NO_HISTORY: 'text-slate-400',
};

const HistoricalAnalogues: React.FC<HistoricalAnaloguesProps> = ({
  pair,
  timeframe = 'H1',
  topN = 5,
}) => {
  const [report, setReport] = useState<SimilarityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pair) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    bwtsApi
      .similarity(pair, timeframe, { limit: 50, minimum_similarity: 0.55 })
      .then((data) => {
        if (cancelled) return;
        setReport(data);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || 'similarity fetch failed');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pair, timeframe]);

  if (!pair) return null;
  if (loading && !report) {
    return (
      <div className="rounded-2xl border cx-border-strong cx-bg-card p-5 cx-text-faint text-sm">
        <Sparkles className="inline w-4 h-4 mr-2" /> Loading historical analogues…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/40 cx-bg-card p-5 text-sm text-rose-200">
        Historical match unavailable: {error}
      </div>
    );
  }
  if (!report) return null;

  const matches = report.matches || [];
  const breakdownEntries = [
    { label: 'Session', buckets: report.breakdown_by_session || [] },
    { label: 'Regime', buckets: report.breakdown_by_market_regime || [] },
    { label: 'Volatility', buckets: report.breakdown_by_volatility_regime || [] },
  ].filter((d) => d.buckets.length > 0);

  return (
    <section className="rounded-2xl border cx-border-strong cx-bg-card p-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide cx-text-faint">
            <Database className="w-4 h-4" />
            <span>HISTORICAL MATCH</span>
          </div>
          <h3 className="mt-1 text-lg font-bold">
            {pair} · {timeframe}
            <span className="ml-2 text-sm cx-text-muted font-normal">
              {report.sample_size} comparable setups
            </span>
          </h3>
        </div>
        <span className={`text-xs font-semibold ${statusTone[report.status]}`}>
          {statusLabel[report.status]}
        </span>
      </header>

      {report.status === 'NO_HISTORY' && (
        <p className="text-sm cx-text-muted">
          No resolved history yet. The loop.py wiring fix unblocks writes to{' '}
          <code>journal_entries</code> — once setups hit TP/invalidation/expiry,
          comparable setups will populate here automatically.
        </p>
      )}

      {report.status !== 'NO_HISTORY' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Win rate"
              value={pct(report.historical_win_rate_pct)}
              tone={report.historical_win_rate_pct && report.historical_win_rate_pct >= 55 ? 'good' : 'neutral'}
            />
            <Stat label="Avg outcome" value={r(report.average_realized_r)} />
            <Stat label="Reliability" value={pct(report.reliability_score, 0)} hint="0–100" />
          </div>

          {breakdownEntries.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold cx-text-muted">Breakdown</div>
              {breakdownEntries.map(({ label, buckets }) => (
                <div key={label} className="flex flex-wrap gap-2">
                  <span className="text-xs cx-text-faint w-20 flex-shrink-0">{label}</span>
                  {buckets.map((b) => (
                    <span
                      key={`${label}-${b.value}`}
                      className="text-xs rounded-lg border cx-border cx-bg-elev px-2 py-1"
                      title={`${b.wins}W / ${b.losses}L of ${b.samples}`}
                    >
                      <span className="font-semibold">{b.value}</span>{' '}
                      <span className={b.win_rate_pct && b.win_rate_pct >= 55 ? 'text-emerald-300' : 'cx-text-faint'}>
                        {pct(b.win_rate_pct, 0)}
                      </span>{' '}
                      <span className="cx-text-faint">({b.samples})</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {matches.length > 0 && (
            <div>
              <div className="text-xs font-semibold cx-text-muted mb-2 flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5" /> Top analogues
              </div>
              <div className="space-y-1.5">
                {matches.slice(0, topN).map((m, idx) => {
                  const isWin = String(m.outcome || '').toUpperCase() === 'WIN';
                  const isLoss = String(m.outcome || '').toUpperCase() === 'LOSS';
                  return (
                    <div
                      key={`${m.id ?? idx}`}
                      className="flex items-center justify-between gap-2 rounded-lg border cx-border cx-bg-elev px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isWin ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
                        ) : isLoss ? (
                          <TrendingDown className="w-3.5 h-3.5 text-rose-300 flex-shrink-0" />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full bg-slate-600 flex-shrink-0" />
                        )}
                        <span className="font-mono cx-text-faint">
                          {String(m.id ?? '').slice(0, 8)}
                        </span>
                        <span className="cx-text-muted">{m.pair} {m.timeframe}</span>
                        <span className="cx-text-faint">{m.direction}</span>
                      </div>
                      <div className="flex items-center gap-3 cx-text-muted flex-shrink-0">
                        <span>{pct(m.similarity_pct, 0)} sim</span>
                        <span className={isWin ? 'text-emerald-300' : isLoss ? 'text-rose-300' : ''}>
                          {r(m.realized_r ?? null)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[11px] cx-text-faint">{report.warning}</p>
        </>
      )}
    </section>
  );
};

const Stat = ({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'neutral';
  hint?: string;
}) => (
  <div className="rounded-xl border cx-border cx-bg-elev p-3">
    <div className="text-xs cx-text-faint">{label}</div>
    <div
      className={`mt-0.5 text-lg font-black ${
        tone === 'good' ? 'text-emerald-300' : 'cx-text-strong'
      }`}
    >
      {value}
    </div>
    {hint && <div className="text-[10px] cx-text-faint">{hint}</div>}
  </div>
);

export default HistoricalAnalogues;
