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
    const tickInterval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tickInterval);
  }, []);

  const loadData = async () => {
    try {
      const [eventsData, newsData] = await Promise.all([
        fetchEconomicEvents(),
        fetchNews()
      ]);
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
    if (impactFilter !== 'all') {
      filtered = filtered.filter(e => e.impact === impactFilter);
    }
    if (currencyFilter !== 'all') {
      filtered = filtered.filter(e => e.currency === currencyFilter);
    }
    if (trackedOnly) {
      filtered = filtered.filter(e => TRACKED_CURRENCIES.includes(e.currency));
    }
    return filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, impactFilter, currencyFilter, trackedOnly]);

  const relevantNews = useMemo(() => {
    return trackedOnly
      ? news.filter(n => (n.relevantCurrencies || []).some(c => TRACKED_CURRENCIES.includes(c)))
      : news;
  }, [news, trackedOnly]);

  const stats = useMemo(() => {
    const today = filteredEvents.filter(e => isToday(new Date(e.date)));
    const tomorrow = filteredEvents.filter(e => isTomorrow(new Date(e.date)));
    const thisWeek = filteredEvents.filter(e => isThisWeek(new Date(e.date)));
    const next24h = filteredEvents.filter(e => {
      const diff = new Date(e.date).getTime() - now.getTime();
      return diff > 0 && diff < 24 * 3600_000;
    });
    const highImpactToday = today.filter(e => e.impact === 'high').length;
    const blockedCurrencies = new Set(
      today.filter(e => e.impact === 'high').map(e => e.currency)
    );
    return { next24h: next24h.length, today: today.length, tomorrow: tomorrow.length, thisWeek: thisWeek.length, highImpactToday, blockedCurrencies };
  }, [filteredEvents, now]);

  const inferGateStatus = (impact: string, currency: string): 'CLEAR' | 'CAUTION' | 'BLOCKED' => {
    if (!TRACKED_CURRENCIES.includes(currency)) return 'CLEAR';
    if (impact === 'high') return 'BLOCKED';
    if (impact === 'medium') return 'CAUTION';
    return 'CLEAR';
  };

  const getCountdown = (eventDate: Date) => {
    const diffMs = eventDate.getTime() - now.getTime();
    if (diffMs < 0) return { label: 'Past', urgent: false };
    const hours = differenceInHours(eventDate, now);
    const minutes = differenceInMinutes(eventDate, now) % 60;
    if (hours < 1) return { label: `${minutes}m`, urgent: true };
    if (hours < 24) return { label: `${hours}h ${minutes}m`, urgent: hours < 2 };
    const days = Math.floor(hours / 24);
    return { label: `${days}d`, urgent: false };
  };

  const getImpactStyle = (impact: string) => {
    switch (impact) {
      case 'high': return { bg: 'bg-rose-400/10', text: 'text-rose-300', border: 'border-rose-400/30', dot: 'bg-rose-400' };
      case 'medium': return { bg: 'bg-amber-400/10', text: 'text-amber-300', border: 'border-amber-400/30', dot: 'bg-amber-400' };
      case 'low': return { bg: 'bg-slate-400/10', text: 'cx-text-muted', border: 'border-slate-400/30', dot: 'bg-slate-400' };
      default: return { bg: 'bg-slate-400/10', text: 'cx-text-muted', border: 'border-slate-400/30', dot: 'bg-slate-400' };
    }
  };

  const getGateStyle = (status: 'CLEAR' | 'CAUTION' | 'BLOCKED') => {
    switch (status) {
      case 'CLEAR': return 'bg-cyan-400/10 text-cyan-300 border-cyan-400/30';
      case 'CAUTION': return 'bg-amber-400/10 text-amber-300 border-amber-400/30';
      case 'BLOCKED': return 'bg-rose-400/10 text-rose-300 border-rose-400/30';
    }
  };

  const EventCard: React.FC<{ event: EconomicEvent }> = ({ event }) => {
    const style = getImpactStyle(event.impact);
    const gate = inferGateStatus(event.impact, event.currency);
    const countdown = getCountdown(new Date(event.date));
    const isUpcoming = new Date(event.date).getTime() > now.getTime();

    return (
      <div className={`rounded-xl border p-4 ${style.bg} ${style.border} ${countdown.urgent ? 'ring-1 ring-rose-400/40' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`text-xs font-bold ${style.text}`}>{event.currency}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getGateStyle(gate)}`}>
                {gate}
              </span>
              {isUpcoming && countdown.urgent && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-400/20 text-rose-300 border border-rose-400/40 animate-pulse">
                  <Bell className="w-2.5 h-2.5 inline mr-1" />
                  {countdown.label}
                </span>
              )}
              {isUpcoming && !countdown.urgent && (
                <span className="text-[10px] font-bold cx-text-muted">
                  in {countdown.label}
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold cx-text-strong truncate">{event.title}</h3>
            <p className="mt-1 text-xs cx-text-muted line-clamp-2">{event.description}</p>
            <div className="mt-2 flex items-center gap-3 text-[10px] cx-text-faint flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {format(new Date(event.date), 'MMM d, HH:mm')} GMT
              </span>
              {event.actual && (
                <span>Actual: <b className={event.actual === event.forecast ? 'text-emerald-300' : 'text-amber-300'}>{event.actual}</b></span>
              )}
              {event.forecast && !event.actual && (
                <span>Forecast: <b className="cx-text-muted">{event.forecast}</b></span>
              )}
            </div>
          </div>
          <div className={`w-2 h-2 rounded-full ${style.dot} mt-1 shrink-0`} />
        </div>
      </div>
    );
  };

  const groupedEvents = useMemo(() => {
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
    return { today, tomorrow, thisWeek, later };
  }, [filteredEvents]);

  const uniqueCurrencies = Array.from(new Set(events.map(e => e.currency))).sort();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-black cx-text-strong">Economic News</h1>
        <div className="rounded-xl border cx-border-strong cx-bg-card">
          <LoadingSpinner size="lg" text="Loading economic events and market news..." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black cx-text-strong">Economic News</h1>
          <p className="mt-1 text-sm cx-text-muted">
            Track market-moving events and breaking news that affect your positions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="rounded-lg border cx-border-strong bg-white/5 p-2 cx-text-muted hover:bg-white/10 hover:cx-text-strong"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
            stats.blockedCurrencies.size > 0
              ? 'border-rose-400/30 bg-rose-400/10 text-rose-300'
              : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              stats.blockedCurrencies.size > 0 ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'
            }`} />
            {stats.blockedCurrencies.size > 0
              ? `${stats.blockedCurrencies.size} currency blocked`
              : 'All clear'}
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs cx-text-faint">Next 24h</span>
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-2xl font-black cx-text-strong">{stats.next24h}</div>
          <div className="text-[10px] cx-text-faint">upcoming events</div>
        </div>
        <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs cx-text-faint">Today</span>
            <CalendarIcon className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-2xl font-black cx-text-strong">{stats.today}</div>
          <div className="text-[10px] cx-text-faint">{stats.highImpactToday} high impact</div>
        </div>
        <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs cx-text-faint">This Week</span>
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-2xl font-black cx-text-strong">{stats.thisWeek}</div>
          <div className="text-[10px] cx-text-faint">total events</div>
        </div>
        <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs cx-text-faint">News</span>
            <Newspaper className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-2xl font-black cx-text-strong">{relevantNews.length}</div>
          <div className="text-[10px] cx-text-faint">relevant headlines</div>
        </div>
      </div>

      {/* View tabs + filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-1 rounded-lg border cx-border-strong cx-bg-card p-1">
          {([
            { id: 'timeline', label: 'Timeline', icon: Clock },
            { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
            { id: 'news', label: 'News', icon: Newspaper },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
                view === id
                  ? 'bg-cyan-400/15 text-cyan-300'
                  : 'cx-text-muted hover:bg-white/5 hover:cx-text-strong'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-md border cx-border-strong cx-bg-card px-2.5 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={trackedOnly}
              onChange={(e) => setTrackedOnly(e.target.checked)}
              className="accent-cyan-400"
            />
            <span className="cx-text-muted">Tracked pairs only</span>
          </label>
          <select
            value={impactFilter}
            onChange={(e) => setImpactFilter(e.target.value as any)}
            className="rounded-md border cx-border-strong cx-bg-card px-2.5 py-1.5 text-xs cx-text-muted"
          >
            <option value="all">All Impact</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            className="rounded-md border cx-border-strong cx-bg-card px-2.5 py-1.5 text-xs cx-text-muted"
          >
            <option value="all">All Currencies</option>
            {uniqueCurrencies.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* View content */}
      {view === 'timeline' && (
        <div className="space-y-6">
          {(['today', 'tomorrow', 'thisWeek', 'later'] as const).map(group => {
            const items = groupedEvents[group];
            if (items.length === 0) return null;
            const label = { today: 'Today', tomorrow: 'Tomorrow', thisWeek: 'This Week', later: 'Later' }[group];
            return (
              <section key={group}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold cx-text-muted">
                  <span className="w-1 h-4 rounded bg-cyan-400" />
                  {label}
                  <span className="cx-text-faint">({items.length})</span>
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map(event => (
                    <EventCard key={`${event.title}-${event.date}`} event={event} />
                  ))}
                </div>
              </section>
            );
          })}
          {filteredEvents.length === 0 && (
            <div className="rounded-xl border cx-border-strong cx-bg-card p-12 text-center cx-text-faint">
              No events match your filters
            </div>
          )}
        </div>
      )}

      {view === 'calendar' && (
        <div className="rounded-xl border cx-border-strong cx-bg-card p-6">
          <div className="text-center cx-text-faint">
            <CalendarIcon className="mx-auto mb-2 h-8 w-8" />
            <p>Calendar view coming soon - timeline view shows the same data grouped by time</p>
          </div>
        </div>
      )}

      {view === 'news' && (
        <div className="space-y-3">
          {relevantNews.length === 0 ? (
            <div className="rounded-xl border cx-border-strong cx-bg-card p-12 text-center cx-text-faint">
              <Newspaper className="mx-auto mb-2 h-8 w-8" />
              No relevant news headlines
            </div>
          ) : (
            relevantNews.slice(0, 30).map((item, i) => (
              <a
                key={i}
                href={item.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border cx-border-strong cx-bg-card p-4 transition hover:border-cyan-400/30 hover:bg-white/[0.02]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {item.relevantCurrencies?.map(c => (
                        <span key={c} className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                          {c}
                        </span>
                      ))}
                      {item.sentiment && (
                        <span className={`flex items-center gap-1 text-[10px] font-bold ${
                          item.sentiment === 'positive' ? 'text-emerald-400' :
                          item.sentiment === 'negative' ? 'text-rose-400' : 'cx-text-muted'
                        }`}>
                          {item.sentiment === 'positive' ? <TrendingUp className="w-3 h-3" /> :
                           item.sentiment === 'negative' ? <TrendingDown className="w-3 h-3" /> : null}
                          {item.sentiment}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold cx-text-strong">{item.title}</h3>
                    {item.summary && (
                      <p className="mt-1 text-xs cx-text-muted line-clamp-2">{item.summary}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[10px] cx-text-faint">
                      <span>{item.source}</span>
                      {item.publishedAt && (
                        <span>{format(new Date(item.publishedAt), 'MMM d, HH:mm')}</span>
                      )}
                    </div>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      )}

      {/* Legend */}
      <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
        <div className="text-xs font-bold cx-text-faint mb-2">Trading Impact Legend</div>
        <div className="flex flex-wrap gap-4 text-xs cx-text-muted">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span>High = New entries blocked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>Medium = Caution / reduced sizing</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span>Low = Clear to trade</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EconomicNews;
