import React, { useEffect, useState } from 'react';
import { Brain, TrendingDown, Zap } from 'lucide-react';
import { bwtsApi, MemoryNote } from '../services/bwtsApi';

/**
 * MemoryNotes — institutional-style persistent memory surfaced near the
 * setup guide so Bobby sees "Gold has rejected this weekly supply zone
 * 3x" before pulling the trigger (Bobby 2026-08-11 ask).
 *
 * Backed by /api/memory/<pair> which derives plain-language notes from
 * journal_entries (zone rejections, session/regime setup performance) +
 * news_event_interactions (event-impact averages). Returns [] when no
 * data exists yet, so we render nothing in that case.
 */
interface MemoryNotesProps {
  pair?: string | null;
  timeframe?: string;
  /** Max number of notes to display. Default 3 keeps the panel compact. */
  limit?: number;
}

const categoryIcon: Record<MemoryNote['category'], React.ElementType> = {
  zone_rejection: TrendingDown,
  news_impact: Zap,
  session_pattern: Brain,
};

const categoryLabel: Record<MemoryNote['category'], string> = {
  zone_rejection: 'Zone rejection',
  news_impact: 'News impact',
  session_pattern: 'Setup pattern',
};

const confidenceColor: Record<MemoryNote['confidence'], string> = {
  high: 'text-emerald-300',
  med: 'text-amber-300',
  low: 'text-slate-400',
};

const MemoryNotes: React.FC<MemoryNotesProps> = ({ pair, timeframe = 'H1', limit = 3 }) => {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pair) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    bwtsApi.memory
      .getForPair(pair, timeframe)
      .then((res) => {
        if (cancelled) return;
        setNotes((res.notes || []).slice(0, limit));
      })
      .catch(() => {
        // Soft-fail — never block the chart with a memory error.
        if (!cancelled) setNotes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pair, timeframe, limit]);

  // Empty-state: nothing to show, don't render anything (don't pollute the
  // setup guide with an empty card while outcomes are still building up).
  if (!loading && notes.length === 0) return null;
  if (!pair) return null;

  return (
    <section
      aria-label="Trading memory"
      className="rounded-lg border border-violet-400/20 bg-violet-500/5 p-3"
      data-testid="trading-memory-notes"
    >
      <header className="mb-2 flex items-center gap-2 text-violet-300">
        <Brain className="h-4 w-4" />
        <h3 className="text-xs font-semibold uppercase tracking-wide">Trading memory</h3>
        {loading && <span className="text-[10px] text-slate-400">loading…</span>}
      </header>
      <ul className="space-y-2">
        {notes.map((note, idx) => {
          const Icon = categoryIcon[note.category] || Brain;
          return (
            <li key={`${note.category}-${idx}`} className="flex items-start gap-2 text-xs">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${confidenceColor[note.confidence]}`} />
              <div className="flex-1">
                <div className={`text-[10px] uppercase tracking-wide ${confidenceColor[note.confidence]}`}>
                  {categoryLabel[note.category] ?? note.category} · {note.confidence} · n={note.evidence_n}
                </div>
                <p className="text-gray-200 leading-snug">{note.note}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default MemoryNotes;