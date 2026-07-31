// Trading session helpers — approximate UTC windows for the major FX sessions.
export type SessionName = 'Asia' | 'London' | 'New York';

export const SESSIONS: { name: SessionName; startUtc: number; endUtc: number }[] = [
  { name: 'Asia', startUtc: 23, endUtc: 8 },
  { name: 'London', startUtc: 7, endUtc: 16 },
  { name: 'New York', startUtc: 12, endUtc: 21 },
];

export const sessionIsOpen = (session: { startUtc: number; endUtc: number }, utcHour: number) =>
  session.startUtc < session.endUtc
    ? utcHour >= session.startUtc && utcHour < session.endUtc
    : utcHour >= session.startUtc || utcHour < session.endUtc;

/** Sessions open at a given moment (can be two during overlaps, or none). */
export const sessionsAt = (date: Date): SessionName[] => {
  const utcHour = date.getUTCHours();
  return SESSIONS.filter((session) => sessionIsOpen(session, utcHour)).map((session) => session.name);
};

export const hoursUntil = (targetUtcHour: number, now: Date) => {
  const nowH = now.getUTCHours() + now.getUTCMinutes() / 60;
  let diff = targetUtcHour - nowH;
  if (diff <= 0) diff += 24;
  return diff;
};

export const formatHours = (hours: number) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
