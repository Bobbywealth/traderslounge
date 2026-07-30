import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Gauge,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { planReasonText, type CryptoAnalysis } from '../services/bwtsApi';

export interface DecisionScenario {
  label: string;
  weight?: number | null;
  detail?: string | null;
}

export interface DecisionEvidence {
  label: string;
  detail?: string | null;
  status?: 'confirmed' | 'supporting' | 'conflict' | 'unknown';
}

export interface DecisionQualityPanelProps {
  analysis?: CryptoAnalysis | null;
  scenarios?: readonly DecisionScenario[] | null;
  marketBiasConfidence?: number | null;
  setupQuality?: number | null;
  executionReadiness?: number | null;
  maxRecommendedExposure?: number | null;
  evidence?: readonly DecisionEvidence[] | null;
  className?: string;
}

const clamp = (value: number | null | undefined) => Math.max(0, Math.min(100, Number.isFinite(value) ? value! : 0));
const percent = (value: number | null | undefined) => `${Math.round(clamp(value))}%`;

const scoreTone = (value: number) =>
  value >= 70 ? 'text-cyan-300' : value >= 45 ? 'text-violet-300' : 'text-slate-300';

const readinessTone = (status?: string) =>
  status === 'READY'
    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
    : status === 'AVOID'
      ? 'border-rose-400/25 bg-rose-400/10 text-rose-300'
      : 'border-amber-400/25 bg-amber-400/10 text-amber-200';

const EvidenceIcon: React.FC<{ status?: DecisionEvidence['status'] }> = ({ status }) => {
  if (status === 'confirmed') return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" />;
  if (status === 'conflict') return <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-rose-400" />;
  return <div className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-violet-400" />;
};

const Metric: React.FC<{ label: string; value: number; note?: string }> = ({ label, value, note }) => (
  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className={`text-sm font-black ${scoreTone(value)}`}>{percent(value)}</span>
    </div>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500"
        style={{ width: `${clamp(value)}%` }}
      />
    </div>
    {note && <p className="mt-2 text-[10px] leading-4 text-slate-500">{note}</p>}
  </div>
);

const DecisionQualityPanel: React.FC<DecisionQualityPanelProps> = ({
  analysis,
  scenarios,
  marketBiasConfidence,
  setupQuality,
  executionReadiness,
  maxRecommendedExposure,
  evidence,
  className = '',
}) => {
  const plan = analysis?.trade_plan;
  const timing = analysis?.trade_timing;
  const timingChecks = Object.values(timing?.checks || {});
  const derivedReadiness = timingChecks.length
    ? (timingChecks.filter(Boolean).length / timingChecks.length) * 100
    : timing?.status === 'READY' ? 100 : timing?.status === 'AVOID' ? 0 : 0;
  const derivedScenarios: DecisionScenario[] = scenarios?.length
    ? [...scenarios]
    : analysis?.scenarios?.primary
      ? [{ label: analysis.scenarios.primary, detail: analysis.scenarios.invalidation }]
      : [];
  const ledger: DecisionEvidence[] = evidence?.length
    ? [...evidence]
    : [
        ...(analysis?.data_quality?.issues || []).map((detail) => ({ label: 'Data quality', detail, status: 'conflict' as const })),
        ...(analysis?.monitoring || []).map((detail) => ({ label: 'Monitoring', detail, status: 'supporting' as const })),
        ...(plan?.reasons || []).map((reason) => ({
          label: 'Plan condition',
          detail: planReasonText(reason),
          status: typeof reason === 'object' && reason?.blocks_trading ? 'conflict' as const : 'unknown' as const,
        })),
      ];
  const biasConfidence = marketBiasConfidence ?? analysis?.market_context?.alignment_score ?? 0;
  const quality = setupQuality ?? analysis?.confluence_score ?? analysis?.total_score ?? 0;
  const readiness = executionReadiness ?? derivedReadiness;
  const riskProfile = analysis?.decision_quality?.financial_risk_profile;
  const entryAlert = analysis?.decision_quality?.entry_alert;
  const exposure = maxRecommendedExposure ?? riskProfile?.max_recommended_account_exposure_pct ?? plan?.account_risk_percent ?? null;
  const status = timing?.status || plan?.status || 'WAIT';

  return (
    <section className={`rounded-2xl border border-white/[0.08] bg-[#090d18] p-4 shadow-[0_0_40px_rgba(34,211,238,0.03)] ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
            <Gauge className="h-3.5 w-3.5" /> Decision quality
          </div>
          <p className="mt-1 text-xs text-slate-500">Evidence-led context, not a calibrated probability or sizing instruction.</p>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-1 text-[9px] font-black ${readinessTone(status)}`}>{status}</span>
      </div>

      <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] p-3">
        <div className="flex gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-300" />
          <div>
            <p className="text-xs font-black text-amber-200">Scenario weights are uncalibrated. No position sizing is implied.</p>
            <p className="mt-0.5 text-[10px] leading-4 text-amber-100/70">Use independently validated risk limits and confirm the full trade plan before acting.</p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500"><Target className="h-3.5 w-3.5 text-violet-300" /> Scenario weights</div>
        {derivedScenarios.length ? (
          <div className="space-y-2">
            {derivedScenarios.map((scenario, index) => {
              const weight = scenario.weight === null || scenario.weight === undefined ? null : clamp(scenario.weight);
              return (
                <div key={`${scenario.label}-${index}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200">{scenario.label}</p>
                      {scenario.detail && <p className="mt-0.5 text-[10px] leading-4 text-slate-500">Invalidation: {scenario.detail}</p>}
                    </div>
                    <span className="shrink-0 text-[10px] font-black text-amber-300">{weight === null ? 'UNCALIBRATED' : `${Math.round(weight)}%`}</span>
                  </div>
                  {weight !== null && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400" style={{ width: `${weight}%` }} /></div>}
                </div>
              );
            })}
          </div>
        ) : <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-2 text-xs text-slate-500">Scenario evidence is still loading.</p>}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Metric label="Market bias confidence" value={biasConfidence} note={`${analysis?.market_context?.macro_bias || 'neutral'} macro bias`} />
        <Metric label="Setup quality" value={quality} note={`${analysis?.confidence_tier || 'developing'} evidence coverage`} />
        <Metric label="Execution readiness" value={readiness} note={timing?.wait_for?.[0]?.replace(/_/g, ' ') || `Timing ${status.toLowerCase()}`} />
      </div>

      <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-rose-300" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-rose-200">Financial risk</span>
              <span className="text-sm font-black text-rose-200">Max recommended exposure: {exposure === null ? 'Not available' : `${exposure.toFixed(2)}%`}</span>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-rose-100/70">{analysis?.risk?.warning || plan?.blocking_reasons?.[0]?.message || 'Exposure must remain subject to your account-level risk controls.'}</p>
            {riskProfile && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] font-bold uppercase tracking-wider text-rose-100/60 sm:grid-cols-4">
                <span>Risk <b className="text-rose-100">{riskProfile.risk_score_1_to_10}/10</b></span>
                <span>Stop <b className="text-rose-100">{riskProfile.stop_pct == null ? 'N/A' : `${riskProfile.stop_pct.toFixed(2)}%`}</b></span>
                <span>ATR Stop <b className="text-rose-100">{riskProfile.atr_normalized_stop == null ? 'N/A' : `${riskProfile.atr_normalized_stop.toFixed(2)}x`}</b></span>
                <span>Net R:R <b className="text-rose-100">{riskProfile.net_rr_after_fees == null ? 'N/A' : `${riskProfile.net_rr_after_fees.toFixed(2)}R`}</b></span>
                <span>Spread <b className="text-rose-100">{riskProfile.spread_bps == null ? 'N/A' : `${riskProfile.spread_bps} bps`}</b></span>
                <span>Slippage <b className="text-rose-100">{riskProfile.slippage_bps == null ? 'N/A' : `${riskProfile.slippage_bps} bps`}</b></span>
                <span>Correlation <b className="text-rose-100">{riskProfile.portfolio_correlation_available ? 'Included' : 'Unavailable'}</b></span>
                <span>Drawdown <b className="text-rose-100">{riskProfile.historical_drawdown_available ? 'Included' : 'Unavailable'}</b></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {entryAlert && (
        <div className={`mt-4 rounded-xl border px-3 py-2 text-xs ${entryAlert.status === 'TRIGGERED' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-100'}`}>
          <span className="font-black">Entry alert {entryAlert.status}</span> · {entryAlert.message}
        </div>
      )}

      <details className="group mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-xs font-black text-slate-300 marker:content-none">
          <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-cyan-300" /> Evidence ledger <span className="text-slate-600">{ledger.length}</span></span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <div className="space-y-2 border-t border-white/[0.06] px-3 py-3">
          {ledger.length ? ledger.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex gap-2 text-xs">
              <EvidenceIcon status={item.status} />
              <p className="min-w-0 text-slate-400"><span className="font-semibold text-slate-300">{item.label}</span>{item.detail ? ` · ${item.detail}` : ''}</p>
            </div>
          )) : <p className="text-xs text-slate-500">No evidence ledger is available yet.</p>}
        </div>
      </details>
    </section>
  );
};

export default DecisionQualityPanel;
