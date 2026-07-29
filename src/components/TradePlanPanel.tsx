import React from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AssetClass, PositionSizeResult } from '../types/trading';

interface TradePlanPanelProps {
  pair: string;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  entry: number | null;
  stop: number | null;
  targets: Array<{ label: string; price: number; r_multiple: number; reachable: boolean }>;
  positionSize: PositionSizeResult;
  assetClass: AssetClass;
  riskPercent: number;
  status: 'STRONG' | 'VALID' | 'WATCHLIST' | 'WAIT' | 'BLOCKED';
  reasons: string[];
  eligible: boolean;
}

const assetClassLabels: Record<AssetClass, string> = {
  forex: 'Forex',
  forex_jpy: 'Forex (JPY)',
  metals: 'Metals',
  cryptocurrency: 'Crypto',
  indices: 'Indices',
  commodities: 'Commodities',
};

const assetClassUnitLabels: Record<AssetClass, string> = {
  forex: 'pips',
  forex_jpy: 'pips',
  metals: 'points',
  cryptocurrency: 'ticks',
  indices: 'points',
  commodities: 'points',
};

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  STRONG: { bg: 'bg-emerald-400/10', text: 'text-emerald-300', border: 'border-emerald-400/30' },
  VALID: { bg: 'bg-cyan-400/10', text: 'text-cyan-300', border: 'border-cyan-400/30' },
  WATCHLIST: { bg: 'bg-amber-400/10', text: 'text-amber-300', border: 'border-amber-400/30' },
  WAIT: { bg: 'bg-slate-400/10', text: 'text-slate-400', border: 'border-slate-400/30' },
  BLOCKED: { bg: 'bg-rose-400/10', text: 'text-rose-300', border: 'border-rose-400/30' },
};

const TradePlanPanel: React.FC<TradePlanPanelProps> = ({
  pair,
  direction,
  entry,
  stop,
  targets,
  positionSize,
  assetClass,
  riskPercent,
  status,
  reasons,
  eligible,
}) => {
  const DirectionIcon = direction === 'BUY' ? TrendingUp : direction === 'SELL' ? TrendingDown : AlertTriangle;
  const statusStyle = statusColors[status] || statusColors.WAIT;
  const unitLabel = assetClassUnitLabels[assetClass] || 'pips';

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#090d18] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${statusStyle.bg}`}>
            <DirectionIcon className={`h-5 w-5 ${direction === 'BUY' ? 'text-emerald-400' : direction === 'SELL' ? 'text-rose-400' : 'text-slate-400'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-black">{pair}</span>
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                {status}
              </span>
              <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10px] font-black text-slate-400">
                {assetClassLabels[assetClass] || assetClass}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {direction} {eligible ? 'setup detected' : 'no trade'}
            </div>
          </div>
        </div>
      </div>

      {eligible && positionSize.lotSize > 0 ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/[0.04] p-3">
              <div className="text-[9px] font-black tracking-widest text-slate-500">LOT SIZE</div>
              <div className="mt-1 text-xl font-black text-white">
                {positionSize.lotSize.toFixed(2)} lots
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3">
              <div className="text-[9px] font-black tracking-widest text-slate-500">RISK AMOUNT</div>
              <div className="mt-1 text-xl font-black text-white">
                ${positionSize.riskAmountUsd.toFixed(2)}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3">
              <div className="text-[9px] font-black tracking-widest text-slate-500">STOP DISTANCE</div>
              <div className="mt-1 text-xl font-black text-white">
                {positionSize.stopDistancePips.toFixed(1)} {unitLabel}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3">
              <div className="text-[9px] font-black tracking-widest text-slate-500">PIP VALUE</div>
              <div className="mt-1 text-xl font-black text-white">
                ${positionSize.pipValuePerLot.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="mb-3 text-[9px] font-black tracking-widest text-slate-500">TRADE LEVELS</div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-lg bg-white/[0.04] p-2">
                <div className="text-[8px] font-bold tracking-wider text-slate-600">ENTRY</div>
                <div className="mt-1 font-mono text-sm font-bold text-cyan-300">
                  {entry !== null ? entry.toFixed(2) : '—'}
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.04] p-2">
                <div className="text-[8px] font-bold tracking-wider text-slate-600">STOP</div>
                <div className="mt-1 font-mono text-sm font-bold text-rose-300">
                  {stop !== null ? stop.toFixed(2) : '—'}
                </div>
              </div>
              {targets.slice(0, 2).map((target) => (
                <div key={target.label} className="rounded-lg bg-white/[0.04] p-2">
                  <div className="text-[8px] font-bold tracking-wider text-slate-600">{target.label}</div>
                  <div className={`mt-1 font-mono text-sm font-bold ${target.reachable ? 'text-emerald-300' : 'text-slate-500'}`}>
                    {target.price.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Risk: {riskPercent.toFixed(2)}% of account</span>
            </div>
            <div className="text-xs font-black text-slate-300">
              Formula: {positionSize.assetClass}-aware sizing
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-300" />
            <div className="text-xs text-amber-200">
              {reasons.length > 0 ? (
                <ul className="space-y-1">
                  {reasons.slice(0, 3).map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              ) : (
                <span>No eligible trade setup at this time.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradePlanPanel;
