import React from 'react';
import {
  AlertTriangle, BrainCircuit, CheckCircle2, CircleSlash2, Scale,
  ShieldAlert, Sparkles, UsersRound,
} from 'lucide-react';

export type IntelligenceVote = {
  agent: string;
  label: string;
  vote: 'BUY' | 'SELL' | 'NEUTRAL';
  confidence: number;
  reason: string;
  evidence?: string[];
  available: boolean;
};

export type InstitutionalIntelligenceV2 = {
  version?: string;
  available?: boolean;
  status?: string;
  reason?: string;
  institutional_confidence?: {
    score?: number;
    tier?: string;
    data_provenance?: { coverage_pct?: number };
  };
  multi_agent_consensus?: {
    consensus_direction?: 'BUY' | 'SELL' | 'NEUTRAL';
    canonical_direction?: 'BUY' | 'SELL' | 'NEUTRAL';
    agreement_pct?: number;
    status?: 'BLOCKED' | 'ALIGNED' | 'CONTESTED' | 'INCONCLUSIVE' | string;
    votes?: IntelligenceVote[];
    dissenting_agents?: string[];
    veto_reasons?: string[];
  };
  ai_debate?: {
    bull_case?: Array<{ agent: string; argument: string; confidence: number }>;
    bear_case?: Array<{ agent: string; argument: string; confidence: number }>;
    abstentions?: Array<{ agent: string; reason: string }>;
    verdict?: string;
    winning_direction?: string;
  };
  historical_similarity?: {
    status?: string;
    sample_size?: number;
    reliability_score?: number;
    matches?: Array<Record<string, unknown>>;
    warning?: string;
  };
  trade_grade?: {
    grade?: string;
    score?: number;
    executable?: boolean;
    deductions?: Array<{ points: number; reason: string }>;
    interpretation?: string;
  };
  disclaimer?: string;
};

export type IntelligenceDecisionState = 'READY' | 'WAIT' | 'BLOCKED' | 'SETUP FORMING' | 'UNAVAILABLE';

export const getIntelligenceDecisionState = (
  intelligence: InstitutionalIntelligenceV2 | null | undefined,
  canonicalEligible: boolean,
  timingStatus?: string,
): IntelligenceDecisionState => {
  if (!intelligence || intelligence.available === false || intelligence.status === 'UNAVAILABLE') return 'UNAVAILABLE';
  const consensus = intelligence.multi_agent_consensus;
  if (consensus?.status === 'BLOCKED' || (consensus?.veto_reasons?.length || 0) > 0) return 'BLOCKED';
  if (canonicalEligible && timingStatus === 'READY') return 'READY';
  if (timingStatus === 'WAIT' || timingStatus === 'AVOID') return 'WAIT';
  return 'SETUP FORMING';
};

const stateStyle: Record<IntelligenceDecisionState, string> = {
  READY: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  WAIT: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  BLOCKED: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
  'SETUP FORMING': 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
  UNAVAILABLE: 'border-slate-400/20 bg-slate-400/[0.07] text-slate-300',
};

const directionStyle = (direction?: string) => direction === 'BUY'
  ? 'bg-emerald-400/10 text-emerald-300'
  : direction === 'SELL'
    ? 'bg-rose-400/10 text-rose-300'
    : 'bg-slate-400/10 text-slate-300';

const safeNumber = (value: unknown, suffix = '') => typeof value === 'number' && Number.isFinite(value)
  ? `${Math.round(value * 10) / 10}${suffix}`
  : 'Unavailable';

const Arguments: React.FC<{
  title: string;
  rows: Array<{ agent: string; argument: string; confidence: number }>;
  tone: string;
}> = ({ title, rows, tone }) => (
  <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
    <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${tone}`}>{title}</div>
    <div className="mt-3 space-y-3">
      {rows.length ? rows.slice(0, 3).map((row, index) => (
        <div key={`${row.agent}-${index}`}>
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-300">
            <span>{row.agent}</span><span className="font-mono text-slate-500">{safeNumber(row.confidence, '%')}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{row.argument}</p>
        </div>
      )) : <p className="text-xs text-slate-600">No directional argument was produced.</p>}
    </div>
  </div>
);

export const InstitutionalIntelligencePanel: React.FC<{
  intelligence?: InstitutionalIntelligenceV2 | null;
  canonicalEligible: boolean;
  timingStatus?: string;
}> = ({ intelligence, canonicalEligible, timingStatus }) => {
  const state = getIntelligenceDecisionState(intelligence, canonicalEligible, timingStatus);
  const consensus = intelligence?.multi_agent_consensus;
  const grade = intelligence?.trade_grade;
  const debate = intelligence?.ai_debate;
  const similarity = intelligence?.historical_similarity;
  const votes = consensus?.votes || [];
  const vetoes = consensus?.veto_reasons || [];

  if (state === 'UNAVAILABLE') {
    return (
      <section className="rounded-[24px] border border-white/[0.08] bg-[#090d18] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <CircleSlash2 className="mt-0.5 h-5 w-5 text-slate-500" />
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] text-slate-500">INSTITUTIONAL INTELLIGENCE V2</div>
            <h2 className="mt-1 text-xl font-black">Intelligence detail unavailable</h2>
            <p className="mt-2 text-sm text-slate-500">{intelligence?.reason || 'The canonical analysis remains available, but the advisory intelligence payload was not returned.'}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#090d18]">
      <div className="border-b border-white/[0.07] p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black tracking-[0.2em] text-violet-300"><BrainCircuit className="h-4 w-4" /> INSTITUTIONAL INTELLIGENCE V2</div>
            <h2 className="mt-2 text-2xl font-black">Explainable consensus and trade quality</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">Advisory evidence only. Canonical eligibility, calendar blocks, risk caps, and execution gates remain authoritative.</p>
          </div>
          <div className={`inline-flex w-fit items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black ${stateStyle[state]}`}>
            {state === 'READY' ? <CheckCircle2 className="h-4 w-4" /> : state === 'BLOCKED' ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {state}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Sparkles} label="Trade grade" value={grade?.grade || '—'} detail={`${safeNumber(grade?.score, '/100')} advisory score`} />
          <Metric icon={UsersRound} label="Agent agreement" value={safeNumber(consensus?.agreement_pct, '%')} detail={`${consensus?.status || 'INCONCLUSIVE'} consensus`} />
          <Metric icon={Scale} label="Consensus direction" value={consensus?.consensus_direction || 'NEUTRAL'} detail={`Canonical: ${consensus?.canonical_direction || 'NEUTRAL'}`} direction={consensus?.consensus_direction} />
          <Metric icon={BrainCircuit} label="Historical similarity" value={similarity?.status || 'NO_HISTORY'} detail={`${safeNumber(similarity?.reliability_score, '/100')} reliability`} />
        </div>
      </div>

      {vetoes.length > 0 && (
        <div className="border-b border-rose-400/15 bg-rose-400/[0.055] px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div>
              <div className="text-xs font-black text-rose-200">Execution veto</div>
              <ul className="mt-1 space-y-1 text-xs text-rose-200/70">{vetoes.map((reason) => <li key={reason}>• {reason}</li>)}</ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-black">Seven-agent vote ledger</h3>
            <span className="text-[10px] font-bold text-slate-600">{votes.filter((vote) => vote.available).length}/{votes.length || 7} available</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {votes.map((vote) => (
              <div key={vote.agent} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-black text-slate-300">{vote.label}</div>
                  <span className={`rounded-md px-2 py-1 text-[9px] font-black ${directionStyle(vote.vote)}`}>{vote.vote} · {safeNumber(vote.confidence, '%')}</span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{vote.available ? vote.reason : 'Provider or evidence unavailable.'}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-black">Bull-versus-bear debate</h3>
          <div className="grid gap-3">
            <Arguments title="Bull case" rows={debate?.bull_case || []} tone="text-emerald-300" />
            <Arguments title="Bear case" rows={debate?.bear_case || []} tone="text-rose-300" />
          </div>
          {(grade?.deductions?.length || 0) > 0 && (
            <div className="mt-3 rounded-2xl border border-amber-400/15 bg-amber-400/[0.045] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">Grade deductions</div>
              <div className="mt-2 space-y-2">{grade?.deductions?.slice(0, 4).map((item, index) => (
                <div key={`${item.reason}-${index}`} className="flex gap-3 text-xs text-slate-500"><span className="font-mono font-bold text-amber-300">-{item.points}</span><span>{item.reason}</span></div>
              ))}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const Metric: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
  direction?: string;
}> = ({ icon: Icon, label, value, detail, direction }) => (
  <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-600"><Icon className="h-3.5 w-3.5" /> {label}</div>
    <div className={`mt-2 text-2xl font-black ${direction ? directionStyle(direction).split(' ').pop() : 'text-slate-100'}`}>{value}</div>
    <div className="mt-1 text-[11px] text-slate-600">{detail}</div>
  </div>
);

export default InstitutionalIntelligencePanel;
