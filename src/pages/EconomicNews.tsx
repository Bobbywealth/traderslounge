import React, { useState, useEffect, useMemo } from 'react';
import { Clock, Globe, AlertTriangle, TrendingUp, TrendingDown, RefreshCw, Newspaper, Calendar as CalendarIcon, Zap, Filter, Bell } from 'lucide-react';
import { format, isToday, isTomorrow, isThisWeek, differenceInMinutes, differenceInHours } from 'date-fns';
import { fetchEconomicEvents, fetchNews, EconomicEvent, NewsItem } from '../services/newsApi';
import LoadingSpinner from '../components/LoadingSpinner';

const TRACKED_CURRENCIES = ['USD', 'GBP', 'JPY', 'EUR', 'CAD', 'CHF', 'AUD', 'NZD', 'XAU'];

const EconomicNews: React.FC = () => {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [impactFilter, setImpactFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [trackedOnly, setTrackedOnly] = useState(true);
  const [view, setView] = useState<'timeline' | 'calendar' | 'news'>('timeline');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    loadData();
    const refreshInterval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(refreshInterval);
  }, []);

  useEffect(() => {
    const tickInterval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tickInterval);
  }, []);

  const loadData = async () => {
    try {
      const [eventsData, newsData] = await Promise.all([fetchEconomicEvents(), fetchNews()]);
      setEvents(eventsData);
      setNews(newsData);
    } catch (error) {
      console.error('Failed to load economic data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (impactFilter !== 'all') filtered = filtered.filter(e => e.impact === impactFilter);
    if (currencyFilter !== 'all') filtered = filtered.filter(e => e.currency === currencyFilter);
    if (trackedOnly) filtered = filtered.filter(e => TRACKED_CURRENCIES.includes(e.currency));
    return filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, impactFilter, currencyFilter, trackedOnly]);

  const relevantNews = useMemo(() => {
    return trackedOnly ? news.filter(n => (n.relevantCurrencies || []).some(c => TRACKED_CURRENCIES.includes(c))) : news;
  }, [news, trackedOnly]);

  const stats = useMemo(() => {
    const today = filteredEvents.filter(e => isToday(new Date(e.date)));
    const next24h = filteredEvents.filter(e => { const diff = new Date(e.date).getTime() - now.getTime(); return diff > 0 && diff < 24 * 3600_000; });
    const highImpactToday = today.filter(e => e.impact === 'high').length;
    const blockedCurrencies = new Set(today.filter(e => e.impact === 'high').map(e => e.currency));
    return { next24h: next24h.length, today: today.length, thisWeek: filteredEvents.length, highImpactToday, blockedCurrencies };
  }, [filteredEvents, now]);

  const inferGateStatus = (impact: string, currency: string): 'CLEAR' | 'CAUTION' | 'BLOCKED' => {
    if (!TRACKED_CURRENCIES.includes(currency)) return 'CLEAR';
    if (impact === 'high') return 'BLOCKED';
    if (impact === 'medium') return 'CAUTION';
    return 'CLEAR';
  };

  const getCountdown = (eventDate: Date) => {
    const diffMs = eventDate.getTime() - now.getTime();
    if (diffMs < 0) return { label: 'Past', urgent: false, hours: 999 };
    const hours = differenceInHours(eventDate, now);
    const minutes = differenceInMinutes(eventDate, now) % 60;
    if (hours < 1) return { label: `${minutes}m`, urgent: true, hours: 0 };
    if (hours < 24) return { label: `${hours}h ${minutes}m`, urgent: hours < 2, hours };
    const days = Math.floor(hours / 24);
    return { label: `${days}d`, urgent: false, hours };
  };

  const getImpactStyle = (impact: string) => {
    switch (impact) {
      case 'high': return { bg: 'bg-rose-500/8', text: 'text-rose-300', border: 'border-rose-400/25', dot: 'bg-rose-400', glow: 'shadow-[0_0_12px_rgba(244,63,94,0.3)]' };
      case 'medium': return { bg: 'bg-amber-500/8', text: 'text-amber-300', border: 'border-amber-400/25', dot: 'bg-amber-400', glow: 'shadow-[0_0_8px_rgba(251,191,36,0.2)]' };
      default: return { bg: 'bg-slate-500/5', text: 'text-slate-400', border: 'border-slate-500/15', dot: 'bg-slate-500', glow: '' };
    }
  };

  const getGateStyle = (status: 'CLEAR' | 'CAUTION' | 'BLOCKED') => {
    switch (status) {
      case 'CLEAR': return 'bg-cyan-400/15 text-cyan-300 border-cyan-400/30';
      case 'CAUTION': return 'bg-amber-400/15 text-amber-300 border-amber-400/30';
      case 'BLOCKED': return 'bg-rose-400/15 text-rose-300 border-rose-400/30';
    }
  };

  const nextHighImpact = useMemo(() => {
    return filteredEvents.find(e => e.impact === 'high' && new Date(e.date).getTime() > now.getTime());
  }, [filteredEvents, now]);

  const timelineGroups = useMemo(() => {
    const today: EconomicEvent[] = [];
    const tomorrow: EconomicEvent[] = [];
    const thisWeek: EconomicEvent[] = [];
    const later: EconomicEvent[] = [];
    filteredEvents.forEach(e => {
      const d = new Date(e.date);
      if (isToday(d)) today.push(e);
      else if (isTomorrow(d)) tomorrow.push(e);
      else if (isThisWeek(d)) thisWeek.push(e);
      else later.push(e);
    });
    const groups: { label: string; id: string; events: EconomicEvent[] }[] = [];
    if (today.length) groups.push({ label: 'Today', id: 'today', events: today });
    if (tomorrow.length) groups.push({ label: 'Tomorrow', id: 'tomorrow', events: tomorrow });
    if (thisWeek.length) groups.push({ label: 'This Week', id: 'thisWeek', events: thisWeek });
    if (later.length) groups.push({ label: 'Later', id: 'later', events: later });
    return groups;
  }, [filteredEvents]);

  const uniqueCurrencies = Array.from(new Set(events.map(e => e.currency))).sort();

  const TimelineEvent: React.FC<{ event: EconomicEvent; isPast: boolean }> = ({ event, isPast }) => {
    const style = getImpactStyle(event.impact);
    const gate = inferGateStatus(event.impact, event.currency);
    const countdown = getCountdown(new Date(event.date));
    const isUpcoming = new Date(event.date).getTime() > now.getTime();
    const isNow = isUpcoming && countdown.hours === 0 && countdown.urgent;
    return (
      <div className={`group relative flex items-start gap-4 ${isPast ? 'opacity-50' : ''}`}>
        <div className="w-14 shrink-0 text-right pt-0.5">
          <span className={`text-xs font-bold tabular-nums ${isNow ? 'text-rose-300 animate-pulse' : isPast ? 'text-slate-600' : 'text-slate-300'}`}>
            {format(new Date(event.date), 'HH:mm')}
          </span>
          <div className="text-[9px] text-slate-600 mt-0.5">{format(new Date(event.date), 'EEE d')}</div>
        </div>
        <div className="relative flex flex-col items-center shrink-0">
          <div className={`w-3 h-3 rounded-full border-2 ${style.dot} ${style.glow} ${isNow ? 'ring-2 ring-rose-400/50 ring-offset-2 ring-offset-[#0b1020]' : ''} ${isPast ? 'opacity-40' : ''}`} />
        </div>
        <div className={`flex-1 min-w-0 rounded-xl border p-3 ${style.bg} ${style.border} ${isNow ? 'ring-1 ring-rose-400/40 ' + style.glow : ''} transition-all duration-300 hover:border-opacity-60`}>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-black uppercase tracking-wider ${style.text}`}>{event.currency}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black border ${getGateStyle(gate)}`}>{gate}</span>
            {isNow && <span className="px-2 py-0.5 rounded text-[9px] font-black bg-rose-500/20 text-rose-200 border border-rose-400/40 animate-pulse">LIVE NOW</span>}
            {isUpcoming && countdown.urgent && !isNow && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-400/15 text-amber-300 border border-amber-400/30"><Bell className="w-2.5 h-2.5 inline mr-0.5" />{countdown.label}</span>}
            {isUpcoming && !countdown.urgent && <span className="text-[9px] text-slate-500">in {countdown.label}</span>}
          </div>
          <h3 className={`text-sm font-bold ${isPast ? 'text-slate-400' : 'text-white'}`}>{event.title}</h3>
          {event.forecast && !event.actual && <div className="mt-1 text-[10px] text-slate-500">Forecast: <span className="text-slate-300 font-medium">{event.forecast}</span></div>}
          {event.actual && <div className="mt-1 text-[10px]">Actual: <span className={`font-bold ${event.actual === event.forecast ? 'text-emerald-400' : 'text-amber-300'}`}>{event.actual}</span>{event.forecast && <span className="text-slate-500 ml-1">(f/c: {event.forecast})</span>}</div>}
        </div>
      </div>
    );
  };

  const TimelineGroup: React.FC<{ label: string; events: EconomicEvent[]; isPast?: boolean }> = ({ label, events, isPast }) => {
    const highCount = events.filter(e => e.impact === 'high').length;
    return (
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4 pl-[4.5rem]">
          <div className="flex items-center gap-2">
            <h2 className={`text-xs font-black uppercase tracking-widest ${isPast ? 'text-slate-600' : 'text-slate-400'}`}>{label}</h2>
            {highCount > 0 && <span className="rounded bg-rose-400/15 px-1.5 py-0.5 text-[9px] font-black text-rose-400">{highCount} high impact</span>}
          </div>
          <div className={`flex-1 h-px ${isPast ? 'bg-slate-800' : 'bg-slate-700/50'}`} />
          <span className="text-[10px] text-slate-600">{events.length} events</span>
        </div>
        <div className="space-y-2">
          {events.map(event => <TimelineEvent key={`${event.title}-${event.date}`} event={event} isPast={isPast || false} />)}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-black cx-text-strong">Economic Calendar</h1>
        <div className="rounded-xl border cx-border-strong cx-bg-card">
          <LoadingSpinner size="lg" text="Loading economic events and market news..." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-black cx-text-strong">Economic Calendar</h1>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="rounded-lg border cx-border-strong bg-white/5 p-2 cx-text-muted hover:bg-white/10 hover:cx-text-strong" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${stats.blockedCurrencies.size > 0 ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${stats.blockedCurrencies.size > 0 ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'}`} />
            {stats.blockedCurrencies.size > 0 ? `${stats.blockedCurrencies.size} currency blocked` : 'All clear'}
          </span>
        </div>
      </div>

      {nextHighImpact && (() => {
        const countdown = getCountdown(new Date(nextHighImpact.date));
        const style = getImpactStyle(nextHighImpact.impact);
        return (
          <div className={`rounded-xl border ${style.border} ${style.bg} p-4 flex items-center justify-between gap-4`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${style.bg} border ${style.border}`}><Zap className={`w-5 h-5 ${style.text}`} /></div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Next high-impact event</div>
                <div className="text-sm font-bold text-white">{nextHighImpact.title}</div>
                <div className="text-[11px] text-slate-400">{nextHighImpact.currency} · {format(new Date(nextHighImpact.date), 'EEE MMM d · HH:mm')} GMT</div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-2xl font-black tabular-nums ${countdown.urgent ? 'text-rose-300 animate-pulse' : 'text-white'}`}>{countdown.label}</div>
              <div className="text-[10px] text-slate-500">{countdown.urgent ? 'until release' : 'away'}</div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Next 24h', value: stats.next24h, icon: Clock, color: 'text-cyan-400' },
          { label: 'Today', value: stats.today, icon: CalendarIcon, color: 'text-cyan-400', sub: `${stats.highImpactToday} high` },
          { label: 'This Week', value: stats.thisWeek, icon: Globe, color: 'text-cyan-400' },
          { label: 'News', value: relevantNews.length, icon: Newspaper, color: 'text-cyan-400' },
        ].map(({ label, value, icon: Icon, color, sub }) => (
          <div key={label} className="rounded-lg border cx-border-strong cx-bg-card px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
              <Icon className={`w-3 h-3 ${color}`} />
            </div>
            <div className="text-lg font-black text-white">{value}</div>
            {sub && <div className="text-[9px] text-slate-500">{sub}</div>}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-1 rounded-lg border cx-border-strong cx-bg-card p-1">
          {([
            { id: 'timeline', label: 'Timeline', icon: Clock },
            { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
            { id: 'news', label: 'News', icon: Newspaper },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setView(id)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${view === id ? 'bg-cyan-400/15 text-cyan-300' : 'cx-text-muted hover:bg-white/5 hover:cx-text-strong'}`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-md border cx-border-strong cx-bg-card px-2.5 py-1.5 text-xs">
            <input type="checkbox" checked={trackedOnly} onChange={(e) => setTrackedOnly(e.target.checked)} className="accent-cyan-400" />
            <span className="cx-text-muted">Tracked pairs</span>
          </label>
          <select value={impactFilter} onChange={(e) => setImpactFilter(e.target.value as any)} className="rounded-md border cx-border-strong cx-bg-card px-2.5 py-1.5 text-xs cx-text-muted">
            <option value="all">All Impact</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)} className="rounded-md border cx-border-strong cx-bg-card px-2.5 py-1.5 text-xs cx-text-muted">
            <option value="all">All Currencies</option>
            {uniqueCurrencies.map(c => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
      </div>

      {view === 'timeline' && (
        <div className="relative">
          {timelineGroups.length === 0 ? (
            <div className="rounded-xl border cx-border-strong cx-bg-card p-12 text-center cx-text-faint">No events match your filters</div>
          ) : (
            timelineGroups.map((group) => <TimelineGroup key={group.id} label={group.label} events={group.events} isPast={group.id !== 'today' && group.id !== 'tomorrow'} />)
          )}
        </div>
      )}

      {view === 'calendar' && (
        <div className="rounded-xl border cx-border-strong cx-bg-card p-6"><div className="text-center cx-text-faint"><CalendarIcon className="mx-auto mb-2 h-8 w-8" /><p>Calendar view coming soon — timeline shows the same data</p></div></div>
      )}

      {view === 'news' && (
        <div className="space-y-2">
          {relevantNews.length === 0 ? (
            <div className="rounded-xl border cx-border-strong cx-bg-card p-12 text-center cx-text-faint"><Newspaper className="mx-auto mb-2 h-8 w-8" />No relevant news headlines</div>
          ) : relevantNews.slice(0, 30).map((item, i) => (
            <a key={i} href={item.url || '#'} target="_blank" rel="noopener noreferrer" className="block rounded-xl border cx-border-strong cx-bg-card p-3 transition hover:border-cyan-400/30 hover:bg-white/[0.02]">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {item.relevantCurrencies?.map(c => <span key={c} className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">{c}</span>)}
                  </div>
                  <h3 className="text-sm font-bold cx-text-strong">{item.title}</h3>
                  {item.summary && <p className="mt-1 text-xs cx-text-muted line-clamp-2">{item.summary}</p>}
                  <div className="mt-1 text-[10px] cx-text-faint">{item.source} {item.publishedAt && `· ${format(new Date(item.publishedAt), 'MMM d, HH:mm')}`}</div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      <div className="rounded-xl border cx-border-strong cx-bg-card p-3 flex flex-wrap gap-4 text-[10px] cx-text-muted">
        <span className="font-bold uppercase tracking-wider text-slate-600">Impact:</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" />High = entries blocked</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Medium = caution</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500" />Low = clear</span>
      </div>
    </div>
  );
};

export default EconomicNews;
