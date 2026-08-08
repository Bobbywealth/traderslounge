import React, { useEffect, useState } from 'react';

const DEFAULT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

interface FibonacciPanelProps {
  symbol: string;
  timeframe: string;
  onAutoFib: () => void;
  onLevelsChange?: (visibleLevels: number[]) => void;
}

interface PersistedState {
  custom: number[];
  hidden: number[];
}

export function FibonacciPanel({ symbol, timeframe, onAutoFib, onLevelsChange }: FibonacciPanelProps) {
  const storageKey = `confluencex:fib:${symbol}:${timeframe}`;
  const [state, setState] = useState<PersistedState>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.custom) && Array.isArray(parsed.hidden)) return parsed;
      }
    } catch { /* noop */ }
    return { custom: [], hidden: [] };
  });
  const [draft, setDraft] = useState<string>('');

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* noop */ }
  }, [state, storageKey]);

  useEffect(() => {
    if (!onLevelsChange) return;
    const visible = DEFAULT_LEVELS.filter((l) => !state.hidden.includes(l)).concat(state.custom).sort((a, b) => a - b);
    onLevelsChange(visible);
  }, [state.custom.join(','), state.hidden.join(','), onLevelsChange]);

  const toggleDefault = (l: number) => {
    setState((s) => ({
      ...s,
      hidden: s.hidden.includes(l) ? s.hidden.filter((x) => x !== l) : [...s.hidden, l],
    }));
  };

  const removeCustom = (l: number) => {
    setState((s) => ({ ...s, custom: s.custom.filter((x) => x !== l) }));
  };

  const addCustom = () => {
    const v = Number(draft);
    if (!isFinite(v) || v <= 0 || v >= 10) {
      setDraft('');
      return;
    }
    if (DEFAULT_LEVELS.includes(v) || state.custom.includes(v)) {
      setDraft('');
      return;
    }
    setState((s) => ({ ...s, custom: [...s.custom, v].sort((a, b) => a - b) }));
    setDraft('');
  };

  const reset = () => setState({ custom: [], hidden: [] });

  return (
    <div className="rounded-xl border border-purple-400/25 cx-bg-elev/95 p-3 text-[11px] cx-text shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-purple-400/15 px-2 py-0.5 font-black tracking-widest text-purple-300">FIB TOOLS</span>
          <span className="text-[9px] font-bold cx-text-faint">{symbol} · {timeframe}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onAutoFib}
            title="Auto-place Fibonacci on the most recent swing"
            className="rounded border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 text-[9px] font-black text-purple-300 transition hover:bg-purple-400/20"
          >
            ⚡ AUTO
          </button>
          <button
            onClick={reset}
            title="Reset custom levels"
            className="text-[9px] font-bold cx-text-faint hover:text-rose-300"
          >
            RESET
          </button>
        </div>
      </div>

      <div className="mb-2">
        <div className="mb-1 text-[9px] font-bold uppercase tracking-wider cx-text-faint">Default levels (tap to toggle)</div>
        <div className="flex flex-wrap gap-1">
          {DEFAULT_LEVELS.map((l) => {
            const hidden = state.hidden.includes(l);
            const isGolden = l === 0.618 || l === 0.65;
            return (
              <button
                key={l}
                onClick={() => toggleDefault(l)}
                title={isGolden ? 'Golden ratio' : l === 0.5 ? 'Mid-line' : l === 0 ? 'Origin' : l === 1 ? 'Full leg' : `Fib ${l}`}
                className={`rounded px-2 py-0.5 text-[10px] font-black tabular-nums transition ${
                  hidden
                    ? 'cx-text-faint opacity-40 line-through border cx-border'
                    : isGolden
                      ? 'bg-violet-400/20 text-violet-200 border border-violet-400/40 shadow-[0_0_8px_rgba(167,139,250,0.25)]'
                      : 'bg-purple-400/15 text-purple-300 border border-purple-400/30 hover:bg-purple-400/25'
                }`}
              >
                {l.toString().replace(/^0\./, '.')}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-2">
        <div className="mb-1 text-[9px] font-bold uppercase tracking-wider cx-text-faint">Custom levels</div>
        {state.custom.length === 0 ? (
          <div className="text-[9px] italic cx-text-faint">none — add below (e.g. 0.886, 1.5, 2.618)</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {state.custom.map((l) => (
              <button
                key={l}
                onClick={() => removeCustom(l)}
                title={`Click to remove ${l}`}
                className="rounded border border-fuchsia-400/30 bg-fuchsia-400/15 px-2 py-0.5 text-[10px] font-black tabular-nums text-fuchsia-300 transition hover:border-rose-400/30 hover:bg-rose-400/15 hover:text-rose-300"
              >
                {l.toString().replace(/^0\./, '.')} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1">
        <input
          type="number"
          step="0.001"
          min="0.001"
          max="9.999"
          placeholder="0.886"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          className="flex-1 rounded border cx-border cx-bg-input px-1.5 py-1 text-[11px] cx-text tabular-nums focus:outline-none focus:ring-1 focus:ring-fuchsia-400/40"
        />
        <button
          onClick={addCustom}
          className="rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 text-[10px] font-black tracking-wider text-fuchsia-300 transition hover:bg-fuchsia-400/20"
        >
          ADD
        </button>
      </div>
    </div>
  );
}

export { DEFAULT_LEVELS };
