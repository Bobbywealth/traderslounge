import { BrainCircuit } from 'lucide-react';
import type { ChartAiAnalysis } from '../services/bwtsApi';

interface ChartAiAnalysisPanelProps {
  analysis: ChartAiAnalysis | null;
  error: string | null;
  configured: boolean | null;
  currentPrice: number;
  onClose: () => void;
}

function biasBadgeClass(bias: string): string {
  if (/bull/i.test(bias)) return 'bg-emerald-400/10 text-emerald-300';
  if (/bear/i.test(bias)) return 'bg-rose-400/10 text-rose-300';
  return 'bg-cyan-400/10 text-cyan-300';
}

/** Scannable, progressively-disclosed rendering of the MiniMax chart analysis. */
export default function ChartAiAnalysisPanel({ analysis, error, configured, currentPrice, onClose }: ChartAiAnalysisPanelProps) {
  if (!error && !analysis) return null;
  const bias = String(analysis?.visual_bias || '').toUpperCase();
  const confidence = analysis?.confidence ?? null;
  const levels = (analysis?.key_levels || [])
    .filter((level) => level && typeof level.price === 'number' && !Number.isNaN(level.price))
    .map((level) => ({ ...level, _distance: Math.abs(level.price - currentPrice) }))
    .sort((a, b) => a._distance - b._distance)
    .slice(0, 4);
  const patterns = analysis?.visible_patterns?.slice(0, 3) || [];
  const extras = [
    { label: 'Confirmations', items: analysis?.confirmations || [], color: 'text-emerald-300' },
    { label: 'Conflicts', items: analysis?.conflicts || [], color: 'text-amber-300' },
    { label: 'Risk factors', items: analysis?.risk_factors || [], color: 'text-rose-300' },
  ].filter((section) => Array.isArray(section.items) && section.items.length);

  return (
    <div className="absolute left-4 right-4 top-[160px] z-40 max-h-[min(52vh,460px)] overflow-y-auto rounded-xl border border-violet-500/20 bg-[#0d1020]/95 px-4 py-3 text-xs cx-text-muted shadow-2xl backdrop-blur">
      <div className="flex items-start gap-3">
        <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-black tracking-widest text-violet-300">AI CHART ANALYSIS</span>
            {configured !== null && (
              <span className="rounded cx-bg-card-hover px-2 py-0.5 text-[9px] font-black cx-text-faint">{configured ? 'MINIMAX VISION' : 'DETERMINISTIC FALLBACK'}</span>
            )}
            {analysis && <span className={`rounded px-2 py-0.5 text-[9px] font-black ${biasBadgeClass(bias)}`}>{bias || 'NEUTRAL'}{confidence != null ? ` · ${confidence}/100` : ''}</span>}
          </div>

          {error && <p className="mt-1 text-rose-300">{error}</p>}

          {analysis && (
            <>
              <p className="mt-1.5 max-w-5xl leading-relaxed cx-text-muted">{analysis.summary}</p>

              {levels.length > 0 && (
                <div className="mt-2 rounded-lg border cx-border bg-white/[0.02] px-2.5 py-1.5">
                  <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wider cx-text-faint">Nearest levels{currentPrice ? ` · @ ${currentPrice.toLocaleString()}` : ''}</div>
                  {levels.map((level) => {
                    const isResistance = level.price >= currentPrice;
                    return (
                      <div key={`${level.label}-${level.price}`} className="flex items-center gap-2 py-[2px]">
                        <span className={`w-7 shrink-0 text-[9px] font-black ${isResistance ? 'text-rose-300' : 'text-emerald-300'}`}>{isResistance ? 'RES' : 'SUP'}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] cx-text-muted" title={level.reason}>{level.label}</span>
                        <span className="font-mono text-[11px] tabular-nums cx-text">{level.price.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {patterns.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {patterns.map((pattern) => <span key={pattern} className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">{pattern}</span>)}
                </div>
              )}

              {extras.length > 0 && (
                <details className="mt-2 group">
                  <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-wider cx-text-muted hover:cx-text">Details</summary>
                  <div className="mt-1 space-y-1.5">
                    {extras.map((section) => (
                      <div key={section.label}>
                        <div className={`text-[9px] font-bold uppercase tracking-wider ${section.color}`}>{section.label}</div>
                        <ul className="mt-0.5 space-y-0.5 border-l cx-border pl-2">
                          {section.items.slice(0, 5).map((item, index) => <li key={index} className="text-[10px] leading-snug cx-text-muted">{item}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="mt-2 grid gap-1.5 text-[10px] cx-text-faint">
                {analysis.wait_for && <span><b className="cx-text-muted">Wait for:</b> {analysis.wait_for}</span>}
                {analysis.invalidation && <span><b className="cx-text-muted">Invalidation:</b> {analysis.invalidation}</span>}
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} className="rounded px-2 py-1 text-[10px] font-black cx-text-faint hover:cx-bg-card-hover hover:cx-text">CLOSE</button>
      </div>
    </div>
  );
}
