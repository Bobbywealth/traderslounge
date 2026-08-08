import React, { useEffect, useMemo, useState } from 'react';

export type AssetClass = 'crypto' | 'forex' | 'commodity' | 'stock';

export type CalcPreset = 'scalp' | 'swing' | 'core' | 'custom';

export interface CalcLevels {
  entry: number;
  stop: number;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  direction: 'long' | 'short';
}

export interface SetupSnapshot {
  direction?: 'LONG' | 'SHORT' | 'NEUTRAL' | string | null;
  entry?: number | null;
  stop?: number | null;
  invalidation?: number | null;
  targets?: Array<number | null | undefined>;
  atr?: number | null;
}

interface PositionSizeCalculatorProps {
  symbol: string;
  assetClass: AssetClass;
  currentPrice: number;
  setup?: SetupSnapshot | null;
  onLevelsChange?: (levels: CalcLevels | null) => void;
}

interface PersistedState {
  account: number;
  riskPct: number;
  preset: CalcPreset;
  atrMultiplier: number;
  showTps: boolean;
}

const STORAGE_KEY = (symbol: string) => `confluencex:poscalc:${symbol}`;

const PRESETS: Record<Exclude<CalcPreset, 'custom'>, { risk: number; label: string; description: string }> = {
  scalp: { risk: 0.5, label: 'Scalp', description: '0.5% risk · tight stops' },
  swing: { risk: 1, label: 'Swing', description: '1% risk · multi-day' },
  core: { risk: 2, label: 'Core', description: '2% risk · high conviction' },
};

const PIP_SIZE: Record<AssetClass, number> = {
  crypto: 1,
  forex: 0.0001,
  commodity: 0.01,
  stock: 0.01,
};

// Approximate pip value in USD for 1 standard lot/contract/unit.
// Forex majors quoted vs USD ≈ $10/pip per standard lot (100,000 units).
// XAUUSD ≈ $1 per $0.01 move per oz; 1 standard lot = 100 oz → $100/pip.
// Crypto spot: $1 per $1 move per 1 coin.
// Stocks: $0.01/share per $0.01 move.
function pipValuePerLot(assetClass: AssetClass): number {
  switch (assetClass) {
    case 'forex': return 10;
    case 'commodity': return 100;
    case 'crypto': return 1;
    case 'stock': return 0.01;
  }
}

function fmtPrice(price: number, assetClass: AssetClass): string {
  if (!isFinite(price)) return '—';
  if (assetClass === 'forex') return price > 10 ? price.toFixed(3) : price.toFixed(5);
  if (assetClass === 'crypto') return price >= 1000 ? price.toFixed(2) : price.toFixed(4);
  if (assetClass === 'commodity') return price.toFixed(2);
  return price.toFixed(2);
}

function fmtUsd(amount: number): string {
  if (!isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 10000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtSize(size: number, assetClass: AssetClass, symbol: string): string {
  if (!isFinite(size) || size <= 0) return '—';
  const decimals = assetClass === 'forex' ? 2 : assetClass === 'crypto' ? 4 : 2;
  const unit = assetClass === 'forex' ? 'lots'
    : assetClass === 'commodity' ? 'lots (100 oz)'
    : assetClass === 'stock' ? 'shares'
    : symbol.replace(/USD$/i, '').replace(/USDT$/i, '') || 'units';
  return `${size.toFixed(decimals)} ${unit}`;
}

function defaultPersisted(): PersistedState {
  return { account: 10000, riskPct: 1, preset: 'swing', atrMultiplier: 1.5, showTps: false };
}

export function PositionSizeCalculator(props: PositionSizeCalculatorProps) {
  const { symbol, assetClass, currentPrice, setup, onLevelsChange } = props;

  const [persisted, setPersisted] = useState<PersistedState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY(symbol));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.account === 'number') return { ...defaultPersisted(), ...parsed };
      }
    } catch { /* noop */ }
    return defaultPersisted();
  });

  const [entry, setEntry] = useState<number>(() => setup?.entry ?? currentPrice ?? 0);
  const [stop, setStop] = useState<number | ''>(() => setup?.stop ?? setup?.invalidation ?? '');
  const [tp1, setTp1] = useState<number | ''>(() => setup?.targets?.[0] ?? '');
  const [tp2, setTp2] = useState<number | ''>(() => setup?.targets?.[1] ?? '');
  const [tp3, setTp3] = useState<number | ''>(() => setup?.targets?.[2] ?? '');

  // Persist
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY(symbol), JSON.stringify(persisted)); } catch { /* noop */ }
  }, [persisted, symbol]);

  // Reset on symbol change but keep account/risk
  useEffect(() => {
    setEntry(setup?.entry ?? currentPrice ?? 0);
    setStop(setup?.stop ?? setup?.invalidation ?? '');
    setTp1(setup?.targets?.[0] ?? '');
    setTp2(setup?.targets?.[1] ?? '');
    setTp3(setup?.targets?.[2] ?? '');
    if (setup?.targets?.length) setPersisted((p) => ({ ...p, showTps: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const direction: 'long' | 'short' = useMemo(() => {
    if (typeof stop === 'number' && stop !== entry && entry > 0) return entry > stop ? 'long' : 'short';
    if (setup?.direction === 'SHORT') return 'short';
    if (setup?.direction === 'LONG') return 'long';
    return 'long';
  }, [entry, stop, setup?.direction]);

  const stopDist = typeof stop === 'number' && stop > 0 && entry > 0 ? Math.abs(entry - stop) : 0;
  const stopPips = stopDist / PIP_SIZE[assetClass];
  const riskAmount = persisted.account * (persisted.riskPct / 100);

  const positionSize = useMemo(() => {
    if (stopDist <= 0 || riskAmount <= 0) return 0;
    if (assetClass === 'forex') return riskAmount / (stopPips * pipValuePerLot('forex'));
    if (assetClass === 'commodity') return riskAmount / (stopDist * pipValuePerLot('commodity'));
    return riskAmount / stopDist;
  }, [stopDist, stopPips, riskAmount, assetClass]);

  const rFor = (target: number): number => stopDist > 0 && isFinite(target) ? Math.abs(target - entry) / stopDist : 0;
  const rewardFor = (target: number): number => stopDist > 0 && isFinite(target) && positionSize > 0
    ? Math.abs(target - entry) * (assetClass === 'forex'
        ? positionSize * pipValuePerLot('forex') * PIP_SIZE[assetClass] / PIP_SIZE.forex * 10000
        : assetClass === 'commodity'
        ? positionSize * pipValuePerLot('commodity')
        : positionSize)
    : 0;

  // For forex, position size in lots × pip value per pip × stop pips = risk $.
  // So reward at target = lots × (target - entry) / PIP_SIZE × pipValuePerLot
  const calcReward = (target: number): number => {
    if (!isFinite(target) || stopDist <= 0 || positionSize <= 0) return 0;
    if (assetClass === 'forex') return positionSize * (Math.abs(target - entry) / PIP_SIZE.forex) * pipValuePerLot('forex');
    if (assetClass === 'commodity') return positionSize * (Math.abs(target - entry) / PIP_SIZE.commodity) * pipValuePerLot('commodity');
    return positionSize * Math.abs(target - entry);
  };

  const pctGain = (target: number): number => persisted.account > 0 ? (calcReward(target) / persisted.account) * 100 : 0;

  const r1 = typeof tp1 === 'number' ? rFor(tp1) : 0;
  const r2 = typeof tp2 === 'number' ? rFor(tp2) : 0;
  const r3 = typeof tp3 === 'number' ? rFor(tp3) : 0;
  const bestR = Math.max(r1, r2, r3);

  const setPreset = (preset: Exclude<CalcPreset, 'custom'>) => {
    setPersisted((p) => ({ ...p, preset, riskPct: PRESETS[preset].risk }));
  };

  const useAtrStop = (mult: number) => {
    if (!setup?.atr || !isFinite(setup.atr) || entry <= 0) return;
    const offset = setup.atr * mult;
    setStop(direction === 'long' ? +(entry - offset).toFixed(6) : +(entry + offset).toFixed(6));
  };

  const fillFromSetup = () => {
    if (setup?.entry != null && isFinite(setup.entry)) setEntry(setup.entry);
    if (setup?.stop != null && isFinite(setup.stop)) setStop(setup.stop);
    else if (setup?.invalidation != null && isFinite(setup.invalidation)) setStop(setup.invalidation);
    if (setup?.targets?.[0] != null && isFinite(setup.targets[0])) setTp1(setup.targets[0]!);
    if (setup?.targets?.[1] != null && isFinite(setup.targets[1])) setTp2(setup.targets[1]!);
    if (setup?.targets?.[2] != null && isFinite(setup.targets[2])) setTp3(setup.targets[2]!);
    setPersisted((p) => ({ ...p, showTps: true }));
  };

  const clearAll = () => {
    setEntry(currentPrice || 0);
    setStop('');
    setTp1(''); setTp2(''); setTp3('');
  };

  // Propagate levels to chart overlay
  useEffect(() => {
    if (!onLevelsChange) return;
    if (typeof stop !== 'number' || stop <= 0 || entry <= 0) {
      onLevelsChange(null);
      return;
    }
    onLevelsChange({
      entry,
      stop,
      tp1: typeof tp1 === 'number' ? tp1 : null,
      tp2: typeof tp2 === 'number' ? tp2 : null,
      tp3: typeof tp3 === 'number' ? tp3 : null,
      direction,
    });
  }, [entry, stop, tp1, tp2, tp3, direction, onLevelsChange]);

  const hasSetup = !!(setup?.entry || setup?.stop || setup?.targets?.some((t) => t != null));

  return (
    <div className="rounded-xl border border-cyan-400/25 cx-bg-elev/95 p-3 text-[11px] cx-text shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-cyan-400/15 px-2 py-0.5 font-black tracking-widest text-cyan-300">POSITION SIZE</span>
          {direction && <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${direction === 'long' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>{direction.toUpperCase()}</span>}
        </div>
        <button onClick={clearAll} title="Reset calculator" className="text-[9px] font-bold cx-text-faint hover:text-rose-300">RESET</button>
      </div>

      {/* Account + Risk */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <NumField label="Account $" value={persisted.account} step={100} onChange={(v) => setPersisted((p) => ({ ...p, account: v }))} />
        <NumField
          label="Risk %"
          value={persisted.riskPct}
          step={0.1}
          onChange={(v) => setPersisted((p) => ({ ...p, riskPct: v, preset: 'custom' }))}
          highlight={persisted.riskPct > 2 ? 'rose' : persisted.riskPct >= 1 ? 'amber' : 'emerald'}
          suffix={`${fmtUsd(riskAmount)}`}
        />
      </div>

      {/* Presets */}
      <div className="grid grid-cols-3 gap-1 mb-3">
        {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            title={PRESETS[key].description}
            className={`rounded px-2 py-1 text-[9px] font-black uppercase tracking-wider transition ${
              persisted.preset === key
                ? 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40'
                : 'cx-text-faint border cx-border hover:cx-bg-card-hover hover:cx-text'
            }`}
          >
            {PRESETS[key].label}
          </button>
        ))}
      </div>

      {/* Entry / Stop */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <NumField label="Entry" value={entry} step={assetClass === 'forex' ? 0.0001 : 0.01} onChange={setEntry} accent="cyan" />
        <NumField
          label="Stop Loss"
          value={stop}
          step={assetClass === 'forex' ? 0.0001 : 0.01}
          onChange={(v) => setStop(v === 0 ? '' : v)}
          placeholder={currentPrice ? fmtPrice(currentPrice, assetClass) : ''}
          accent="rose"
        />
      </div>

      {/* ATR helpers */}
      {setup?.atr != null && isFinite(setup.atr) && setup.atr > 0 && (
        <div className="mb-3 flex items-center gap-1 rounded-lg border cx-border cx-bg-input/60 px-2 py-1">
          <span className="text-[9px] font-bold cx-text-faint">ATR stop:</span>
          {[1, 1.5, 2, 3].map((m) => (
            <button
              key={m}
              onClick={() => useAtrStop(m)}
              className="rounded px-1.5 py-0.5 text-[9px] font-black cx-text-faint hover:bg-cyan-400/15 hover:text-cyan-300 border cx-border"
            >
              {m}×
            </button>
          ))}
          <span className="ml-auto text-[9px] cx-text-faint tabular-nums">ATR {fmtPrice(setup.atr, assetClass)}</span>
        </div>
      )}

      {/* TPs (expandable) */}
      <div className="mb-3">
        <button
          onClick={() => setPersisted((p) => ({ ...p, showTps: !p.showTps }))}
          className="flex w-full items-center justify-between rounded px-1 py-1 text-[9px] font-black tracking-widest cx-text-faint hover:text-emerald-300 hover:cx-bg-card-hover"
        >
          <span>TAKE PROFIT TARGETS</span>
          <span className="text-[9px]">
            {persisted.showTps ? '▾' : '▸'} {[tp1, tp2, tp3].filter((t) => typeof t === 'number').length}/3
          </span>
        </button>
        {persisted.showTps && (
          <div className="mt-1 grid grid-cols-3 gap-1">
            <NumField label="TP1" value={tp1} step={assetClass === 'forex' ? 0.0001 : 0.01} onChange={(v) => setTp1(v === 0 ? '' : v)} accent="emerald" />
            <NumField label="TP2" value={tp2} step={assetClass === 'forex' ? 0.0001 : 0.01} onChange={(v) => setTp2(v === 0 ? '' : v)} accent="emerald" />
            <NumField label="TP3" value={tp3} step={assetClass === 'forex' ? 0.0001 : 0.01} onChange={(v) => setTp3(v === 0 ? '' : v)} accent="emerald" />
          </div>
        )}
      </div>

      {/* Fill from setup */}
      {hasSetup && (
        <button
          onClick={fillFromSetup}
          className="mb-3 w-full rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1.5 text-[10px] font-black tracking-wider text-emerald-300 transition hover:bg-emerald-400/20"
        >
          ↓ FILL FROM ACTIVE SETUP
        </button>
      )}

      {/* Outputs */}
      <div className="space-y-1 border-t cx-border pt-2">
        <Row label="Risk $" value={fmtUsd(riskAmount)} tone="rose" />
        <Row label="Stop dist" value={stopDist > 0 ? `${stopDist.toFixed(assetClass === 'forex' ? 5 : 2)} (${stopPips.toFixed(1)} pips)` : '—'} tone="muted" />
        <Row label="Position" value={fmtSize(positionSize, assetClass, symbol)} tone="cyan" big />
        <div className="my-1 border-t cx-border" />
        {typeof tp1 === 'number' && (
          <Row label="TP1" value={`${r1.toFixed(2)}R · ${fmtUsd(calcReward(tp1))} · +${pctGain(tp1).toFixed(2)}%`} tone={r1 >= 2 ? 'emerald' : r1 >= 1 ? 'amber' : 'rose'} />
        )}
        {typeof tp2 === 'number' && (
          <Row label="TP2" value={`${r2.toFixed(2)}R · ${fmtUsd(calcReward(tp2))} · +${pctGain(tp2).toFixed(2)}%`} tone={r2 >= 2 ? 'emerald' : r2 >= 1 ? 'amber' : 'rose'} />
        )}
        {typeof tp3 === 'number' && (
          <Row label="TP3" value={`${r3.toFixed(2)}R · ${fmtUsd(calcReward(tp3))} · +${pctGain(tp3).toFixed(2)}%`} tone={r3 >= 2 ? 'emerald' : r3 >= 1 ? 'amber' : 'rose'} />
        )}
        {bestR > 0 && (
          <>
            <div className="my-1 border-t cx-border" />
            <Row label="Best R:R" value={`${bestR.toFixed(2)}R`} tone={bestR >= 3 ? 'emerald' : bestR >= 2 ? 'cyan' : 'amber'} big />
          </>
        )}
      </div>

      {positionSize > 0 && stopDist > 0 && (
        <div className="mt-2 border-t cx-border pt-2">
          <div className="mb-1 text-[9px] font-black tracking-widest cx-text-faint">RISK VISUAL</div>
          <RiskBar riskPct={persisted.riskPct} bestR={bestR} />
        </div>
      )}
    </div>
  );
}

function NumField(props: {
  label: string;
  value: number | '';
  step?: number;
  onChange: (v: number) => void;
  placeholder?: string;
  suffix?: string;
  accent?: 'cyan' | 'rose' | 'emerald' | 'amber';
  highlight?: 'rose' | 'amber' | 'emerald';
}) {
  const { label, value, step = 1, onChange, placeholder, suffix, accent, highlight } = props;
  const valueColor = highlight === 'rose' ? 'text-rose-300'
    : highlight === 'amber' ? 'text-amber-300'
    : highlight === 'emerald' ? 'text-emerald-300'
    : accent === 'cyan' ? 'text-cyan-300'
    : accent === 'rose' ? 'text-rose-300'
    : accent === 'emerald' ? 'text-emerald-300'
    : 'cx-text';
  return (
    <label className="block">
      <span className="text-[9px] font-bold cx-text-faint uppercase tracking-wider">{label}</span>
      <div className="relative mt-0.5">
        <input
          type="number"
          step={step}
          value={value === '' ? '' : value}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(0);
            const parsed = Number(raw);
            onChange(isFinite(parsed) ? parsed : 0);
          }}
          className={`w-full rounded border cx-border cx-bg-input px-1.5 py-1 text-[11px] tabular-nums ${valueColor} focus:outline-none focus:ring-1 focus:ring-cyan-400/40`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold cx-text-faint">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function Row(props: { label: string; value: string; tone?: 'cyan' | 'emerald' | 'rose' | 'amber' | 'muted'; big?: boolean }) {
  const tone = props.tone || 'muted';
  const color = tone === 'cyan' ? 'text-cyan-300'
    : tone === 'emerald' ? 'text-emerald-300'
    : tone === 'rose' ? 'text-rose-300'
    : tone === 'amber' ? 'text-amber-300'
    : 'cx-text';
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9px] font-bold cx-text-faint uppercase tracking-wider">{props.label}</span>
      <b className={`${color} ${props.big ? 'text-[12px]' : 'text-[11px]'} font-black tabular-nums`}>{props.value}</b>
    </div>
  );
}

function RiskBar({ riskPct, bestR }: { riskPct: number; bestR: number }) {
  // Show risk portion (red) vs reward portion (green) on a horizontal bar
  const riskWidth = Math.min(50, (riskPct / 2) * 50); // 0-2% risk scales to 0-50% bar
  const rewardWidth = Math.min(50, Math.min(bestR, 10) * 5); // 0-10R scales to 0-50% bar
  return (
    <div className="space-y-1">
      <div className="flex h-3 w-full overflow-hidden rounded border cx-border">
        <div
          className="bg-gradient-to-r from-rose-500/70 to-rose-400/70 transition-all"
          style={{ width: `${riskWidth}%` }}
          title={`Risk ${riskPct.toFixed(2)}%`}
        />
        <div className="flex-1 bg-slate-800/30" />
        <div
          className="bg-gradient-to-l from-emerald-500/70 to-emerald-400/70 transition-all"
          style={{ width: `${rewardWidth}%` }}
          title={`Reward ${bestR.toFixed(2)}R`}
        />
      </div>
      <div className="flex justify-between text-[8px] font-bold cx-text-faint">
        <span>RISK</span>
        <span>REWARD</span>
      </div>
    </div>
  );
}
