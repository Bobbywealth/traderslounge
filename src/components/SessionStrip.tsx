import React, { useEffect, useState } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';

interface SessionDef {
  id: string;
  name: string;
  short: string;
  startHour: number; // UTC hour
  endHour: number;
  color: string;
}

// Standard forex/crypto session times in UTC.
// Sydney crosses midnight; the others are within a single day.
const SESSIONS: SessionDef[] = [
  { id: 'sydney', name: 'Sydney', short: 'SYD', startHour: 22, endHour: 7, color: '#f59e0b' },
  { id: 'asia', name: 'Asia / Tokyo', short: 'TYO', startHour: 0, endHour: 9, color: '#a855f7' },
  { id: 'london', name: 'London', short: 'LDN', startHour: 7, endHour: 16, color: '#06b6d4' },
  { id: 'newyork', name: 'New York', short: 'NY', startHour: 13, endHour: 22, color: '#10b981' },
];

interface SessionStripProps {
  chart: IChartApi | null;
  height?: number;
}

interface Band {
  left: number;
  width: number;
  color: string;
  short: string;
  name: string;
  sessionId: string;
}

export function SessionStrip({ chart, height = 16 }: SessionStripProps) {
  const [bands, setBands] = useState<Band[]>([]);

  useEffect(() => {
    if (!chart) return;

    const update = () => {
      try {
        const ts = chart.timeScale();
        // lightweight-charts v5: getVisibleRange() returns { from, to } in UTCTimestamp.
        const visibleRange = (ts as unknown as { getVisibleRange?: () => { from: number; to: number } | null }).getVisibleRange?.();
        if (!visibleRange) return;
        const fromTime = visibleRange.from as number;
        const toTime = visibleRange.to as number;
        if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return;

        const startDate = new Date(fromTime * 1000);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(toTime * 1000);
        endDate.setUTCHours(0, 0, 0, 0);
        // Cap iteration to avoid runaway on huge visible ranges.
        const maxDays = 60;
        if ((endDate.getTime() - startDate.getTime()) / 86400000 > maxDays) {
          endDate.setTime(startDate.getTime() + maxDays * 86400000);
        }

        const newBands: Band[] = [];
        for (let d = new Date(startDate); d.getTime() <= endDate.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
          const dayStart = Math.floor(d.getTime() / 1000);
          for (const s of SESSIONS) {
            let sStart: number; let sEnd: number;
            if (s.startHour < s.endHour) {
              sStart = dayStart + s.startHour * 3600;
              sEnd = dayStart + s.endHour * 3600;
            } else {
              // Session crosses midnight (Sydney).
              sStart = dayStart + s.startHour * 3600;
              sEnd = dayStart + (24 + s.endHour) * 3600;
            }
            if (sEnd < fromTime || sStart > toTime) continue;
            const x1 = ts.timeToCoordinate(sStart as UTCTimestamp);
            const x2 = ts.timeToCoordinate(sEnd as UTCTimestamp);
            if (x1 == null || x2 == null) continue;
            newBands.push({
              left: x1,
              width: Math.max(0, x2 - x1),
              color: s.color,
              short: s.short,
              name: s.name,
              sessionId: s.id,
            });
          }
        }
        setBands(newBands);
      } catch { /* noop — chart may be mid-init */ }
    };

    update();
    const handler = () => update();
    chart.timeScale().subscribeVisibleTimeRangeChange(handler);
    return () => {
      try { chart.timeScale().unsubscribeVisibleTimeRangeChange(handler); } catch { /* noop */ }
    };
  }, [chart]);

  return (
    <div
      className="relative w-full overflow-hidden border-t cx-border"
      style={{
        height,
        background: 'linear-gradient(180deg, rgba(2,6,23,0.55), rgba(2,6,23,0.85))',
      }}
      title="Trading sessions (UTC): Sydney 22-07 · Asia 00-09 · London 07-16 · New York 13-22"
    >
      {bands.map((b, i) => (
        <div
          key={`${b.sessionId}-${i}`}
          className="absolute top-0 bottom-0"
          style={{
            left: b.left,
            width: b.width,
            background: `linear-gradient(180deg, ${b.color}26, ${b.color}14)`,
            borderLeft: `1px solid ${b.color}66`,
            borderRight: `1px solid ${b.color}33`,
          }}
          title={`${b.name}`}
        />
      ))}
      {/* Compact session labels at the first visible occurrence of each band */}
      {(() => {
        const seen = new Set<string>();
        return bands.filter((b) => {
          if (seen.has(b.sessionId)) return false;
          seen.add(b.sessionId);
          return true;
        });
      })().map((b) => (
        <div
          key={`label-${b.sessionId}-${b.left}`}
          className="pointer-events-none absolute top-0 bottom-0 flex items-center px-1 text-[8px] font-black tracking-widest"
          style={{
            left: b.left,
            color: b.color,
            textShadow: '0 0 4px rgba(0,0,0,0.9)',
            opacity: 0.85,
          }}
        >
          {b.short}
        </div>
      ))}
    </div>
  );
}

// Top-bar current-session badge. Self-contained, ticks every minute.
export function SessionNowBadge() {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const utcTime = `${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')}`;

  const active: { session: SessionDef; endsAt: number }[] = [];
  let nextOpenUtcHour: number | null = null;
  let nextSession: SessionDef | null = null;

  for (const s of SESSIONS) {
    const inSession = s.startHour < s.endHour
      ? utcHour >= s.startHour && utcHour < s.endHour
      : (utcHour >= s.startHour) || (utcHour < s.endHour);
    if (inSession) {
      const endHourAdj = s.endHour <= s.startHour ? s.endHour + 24 : s.endHour;
      active.push({ session: s, endsAt: endHourAdj });
    } else if (nextOpenUtcHour === null) {
      // find next opening hour >= current hour (or wrap to tomorrow)
      if (s.startHour > utcHour) {
        nextOpenUtcHour = s.startHour;
        nextSession = s;
      }
    }
  }
  if (nextSession === null) {
    // nothing opens later today; pick earliest tomorrow
    const sorted = [...SESSIONS].sort((a, b) => a.startHour - b.startHour);
    nextSession = sorted[0];
    nextOpenUtcHour = sorted[0].startHour + 24;
  }

  const primary = active[0]?.session;
  const label = active.length === 0
    ? 'Off-hours'
    : active.length === 1
      ? primary!.short
      : active.map((a) => a.session.short).join(' · ');

  // Color: first active session's color, or muted.
  const color = active[0]?.session.color ?? '#64748b';

  // Minutes until next change (session open or close)
  const minutesToNext = nextOpenUtcHour !== null
    ? ((nextOpenUtcHour - utcHour) * 60 - utcMin)
    : 0;

  return (
    <div
      className="flex items-center gap-1.5 rounded-md border cx-border bg-black/30 px-2 py-1"
      title={`UTC ${utcTime} · Sessions: ${SESSIONS.map((s) => `${s.name} ${String(s.startHour).padStart(2, '0')}-${String(s.endHour).padStart(2, '0')}`).join(' · ')}`}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="text-[9px] font-black tracking-widest" style={{ color }}>
        {label}
      </span>
      <span className="text-[9px] font-bold cx-text-faint tabular-nums">{utcTime} UTC</span>
      {nextSession && minutesToNext > 0 && (
        <span className="text-[8px] cx-text-faint">
          · {nextSession.short} in {Math.floor(minutesToNext / 60)}h {minutesToNext % 60}m
        </span>
      )}
    </div>
  );
}

export { SESSIONS };
