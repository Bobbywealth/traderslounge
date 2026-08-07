import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Info,
  Loader2,
  Radio,
  Save,
  Send,
  Shield,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import bwtsApi, {
  type ActivityFeed,
  type ActivityPair,
  type ActivityTransition,
  type AlertEvent,
  type AlertPreferences,
  type TelegramStatus,
} from '../services/bwtsApi';
import { isPushSupported, getPushStatus, requestPushPermissionAndSubscribe, unsubscribeFromPush } from '../services/pushNotificationService';
import DataAttribution from '../components/DataAttribution';

const ALERT_TYPE_LABELS: Record<string, string> = {
  new_trade: 'New confirmed trade',
  entry_zone: 'Entry-zone hit',
  confirmation: 'Setup confirmation',
  news_risk: 'News risk',
  invalidation: 'Setup invalidated',
  daily_briefing: 'Daily briefing',
  weekly_briefing: 'Weekly briefing',
};

const ALERT_TYPE_DESCRIPTIONS: Record<string, string> = {
  new_trade: 'Fires once when a guarded STRONG or VALID call is first published. WAIT and BLOCKED setups never trigger it.',
  entry_zone: 'Fires when price enters the planned entry zone for a setup that has already been confirmed.',
  confirmation: 'Fires when setup quality and timing both cross your minimums at the same time.',
  news_risk: 'Fires when economic calendar status flips to caution / blocked / post-news on a pair you watch.',
  invalidation: 'Fires when price crosses the invalidation level of a setup you were tracking.',
  daily_briefing: 'One concise summary of the day\'s top setups, risks, and news — delivered at session open.',
  weekly_briefing: 'Week-in-review with the setups that fired, what worked, and where the engine improved.',
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: 'In-app feed',
  push: 'Browser push',
  telegram: 'Telegram',
  email: 'Email',
};

const SEVERITY_TONE: Record<string, { chip: string; icon: React.ComponentType<{ className?: string }> }> = {
  info: { chip: 'border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-300', icon: Info },
  warning: { chip: 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300', icon: AlertTriangle },
  critical: { chip: 'border-rose-400/20 bg-rose-400/[0.06] text-rose-300', icon: XCircle },
};

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
const SESSIONS = [
  { value: 'london', label: 'London (07:00–16:00 UTC)' },
  { value: 'new_york', label: 'New York (12:00–21:00 UTC)' },
  { value: 'tokyo', label: 'Tokyo (00:00–09:00 UTC)' },
  { value: 'sydney', label: 'Sydney (21:00–06:00 UTC)' },
  { value: 'overlap', label: 'London / NY overlap (12:00–16:00 UTC)' },
];

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, description, checked, onChange, testId }) => (
  <label className="flex items-start justify-between gap-4 rounded-xl border cx-border cx-bg-card p-3 transition hover:cx-bg-card-hover">
    <div className="min-w-0">
      <div className="text-sm font-bold cx-text-strong">{label}</div>
      {description && <p className="mt-1 text-xs leading-relaxed cx-text-muted">{description}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-none rounded-full border transition ${
        checked
          ? 'border-cyan-400/40 bg-cyan-400/30'
          : 'cx-border cx-bg-card'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
          checked ? 'left-6 bg-cyan-300' : 'left-0.5 bg-slate-300'
        }`}
      />
    </button>
  </label>
);

interface NumberRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (next: number) => void;
}

const NumberRow: React.FC<NumberRowProps> = ({ label, value, min, max, step, suffix, onChange }) => (
  <div className="rounded-xl border cx-border cx-bg-card p-3">
    <div className="flex items-center justify-between text-xs cx-text-muted">
      <span>{label}</span>
      <span className="font-mono text-sm font-black cx-text-strong">
        {value}
        {suffix ?? ''}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mt-2 w-full accent-cyan-400"
    />
  </div>
);

const Alerts: React.FC = () => {
  const [prefs, setPrefs] = useState<AlertPreferences | null>(null);
  const [original, setOriginal] = useState<AlertPreferences | null>(null);
  const [feed, setFeed] = useState<AlertEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const [prefsResult, feedResult, tgStatus] = await Promise.all([
        bwtsApi.alertPreferences(),
        bwtsApi.alertFeed(50),
        bwtsApi.telegramStatus().catch(() => ({ configured: false })),
      ]);
      setPrefs(prefsResult);
      setOriginal(prefsResult);
      setFeed(feedResult.events || []);
      setTelegramStatus(tgStatus);
      setStatus('idle');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => {
    return JSON.stringify(prefs) !== JSON.stringify(original);
  }, [prefs, original]);

  const updatePrefs = (patch: Partial<AlertPreferences>) => {
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleAlertType = (type: string, enabled: boolean) => {
    if (!prefs) return;
    const set = new Set(prefs.enabled_alert_types);
    if (enabled) set.add(type); else set.delete(type);
    updatePrefs({ enabled_alert_types: Array.from(set) });
  };

  const toggleChannel = (channel: string, enabled: boolean) => {
    if (!prefs) return;
    const set = new Set(prefs.delivery_channels);
    if (enabled) set.add(channel); else set.delete(channel);
    updatePrefs({ delivery_channels: Array.from(set) });
  };

  const toggleTimeframe = (tf: string, enabled: boolean) => {
    if (!prefs) return;
    updatePrefs({ timeframes: { ...prefs.timeframes, [tf]: enabled } });
  };

  const toggleSession = (session: string, enabled: boolean) => {
    if (!prefs) return;
    const set = new Set(prefs.sessions);
    if (enabled) set.add(session); else set.delete(session);
    updatePrefs({ sessions: Array.from(set) });
  };

  const save = async () => {
    if (!prefs) return;
    setStatus('saving');
    setErrorMessage(null);
    try {
      const saved = await bwtsApi.saveAlertPreferences(prefs);
      setPrefs(saved);
      setOriginal(saved);
      setStatus('saved');
      window.setTimeout(() => setStatus((current) => (current === 'saved' ? 'idle' : current)), 1500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const watchlistInput = useMemo(() => (prefs?.watchlist ?? []).join(', '), [prefs?.watchlist]);

  const updateWatchlist = (text: string) => {
    const list = text
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    updatePrefs({ watchlist: list });
  };

  return (
    <div className="space-y-5 pb-10 cx-text" data-testid="alerts-page">
      <header className="rounded-[24px] border border-violet-400/15 cx-bg-card bg-gradient-to-br from-violet-500/10 to-cyan-500/[0.04] p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black tracking-[0.22em] text-cyan-300">ALERTS & PERSONALIZATION</div>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black cx-text-strong">
              <Bell className="h-7 w-7 text-cyan-300" /> Your alerts
            </h1>
            <p className="mt-2 text-sm cx-text-muted">
              Tell ConfluenceX what you trade, when you trade, and what should reach you. The engine
              stops sending noise the moment you set the bar.
            </p>
          </div>
          <DataAttribution provider="Internal" variant="inline" />
        </div>
      </header>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>{errorMessage}</span>
        </div>
      )}

      {status === 'loading' && !prefs && (
        <div className="flex items-center gap-2 rounded-xl border cx-border cx-bg-card p-6 text-sm cx-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
        </div>
      )}

      {prefs && (
        <>
          {/* Watchlist */}
          <section className="rounded-2xl border cx-border cx-bg-card p-5">
            <h2 className="text-sm font-black cx-text-strong">Watchlist</h2>
            <p className="mt-1 text-xs leading-relaxed cx-text-muted">
              Pairs the engine considers. Leave blank to receive alerts on every scanner pair.
            </p>
            <input
              type="text"
              value={watchlistInput}
              onChange={(e) => updateWatchlist(e.target.value)}
              placeholder="BTCUSD, ETHUSD, EURUSD…"
              className="mt-3 w-full rounded-md border cx-border cx-bg-elev px-3 py-2 text-sm cx-text-strong placeholder:cx-text-faint focus:border-cyan-400/30 focus:outline-none"
              data-testid="watchlist-input"
            />
          </section>

          {/* Timeframes + Sessions */}
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border cx-border cx-bg-card p-5">
              <h2 className="text-sm font-black cx-text-strong">Timeframes</h2>
              <p className="mt-1 text-xs leading-relaxed cx-text-muted">
                Switch off the timeframes you don\'t trade. Higher-timeframe alerts default on;
                tick / scalp timeframes default off.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TIMEFRAMES.map((tf) => (
                  <ToggleRow
                    key={tf}
                    label={tf}
                    checked={Boolean(prefs.timeframes?.[tf])}
                    onChange={(next) => toggleTimeframe(tf, next)}
                    testId={`timeframe-${tf}`}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border cx-border cx-bg-card p-5">
              <h2 className="text-sm font-black cx-text-strong">Trading sessions</h2>
              <p className="mt-1 text-xs leading-relaxed cx-text-muted">
                Limit alerts to the sessions you actually sit at the screen.
              </p>
              <div className="mt-3 space-y-2">
                {SESSIONS.map((session) => (
                  <ToggleRow
                    key={session.value}
                    label={session.label}
                    checked={prefs.sessions.includes(session.value)}
                    onChange={(next) => toggleSession(session.value, next)}
                    testId={`session-${session.value}`}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Risk + thresholds */}
          <section className="grid gap-5 lg:grid-cols-3">
            <NumberRow
              label="Setup quality minimum"
              value={prefs.setup_quality_minimum}
              min={0}
              max={100}
              step={5}
              suffix="/100"
              onChange={(next) => updatePrefs({ setup_quality_minimum: next })}
            />
            <NumberRow
              label="Timing minimum"
              value={prefs.timing_minimum}
              min={0}
              max={100}
              step={5}
              suffix="/100"
              onChange={(next) => updatePrefs({ timing_minimum: next })}
            />
            <NumberRow
              label="Risk per trade"
              value={prefs.risk_per_trade_pct}
              min={0.1}
              max={5}
              step={0.1}
              suffix="%"
              onChange={(next) => updatePrefs({ risk_per_trade_pct: next })}
            />
          </section>

          {/* Alert types */}
          <section className="rounded-2xl border cx-border cx-bg-card p-5">
            <h2 className="text-sm font-black cx-text-strong">Alert types</h2>
            <p className="mt-1 text-xs leading-relaxed cx-text-muted">
              Each one is independent. Switching any of these off stops that category across every
              delivery channel.
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {Object.entries(ALERT_TYPE_LABELS).map(([type, label]) => (
                <ToggleRow
                  key={type}
                  label={label}
                  description={ALERT_TYPE_DESCRIPTIONS[type]}
                  checked={prefs.enabled_alert_types.includes(type)}
                  onChange={(next) => toggleAlertType(type, next)}
                  testId={`alert-type-${type}`}
                />
              ))}
            </div>
          </section>

          {/* Delivery channels + briefings */}
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border cx-border cx-bg-card p-5">
              <h2 className="text-sm font-black cx-text-strong">Delivery channels</h2>
              <p className="mt-1 text-xs leading-relaxed cx-text-muted">
                In-app feed is on by default. Browser push, Telegram, and email are optional.
              </p>
              <div className="mt-3 space-y-2">
                {Object.entries(CHANNEL_LABELS).map(([channel, label]) => (
                  <ToggleRow
                    key={channel}
                    label={label}
                    checked={prefs.delivery_channels.includes(channel)}
                    onChange={(next) => toggleChannel(channel, next)}
                    testId={`channel-${channel}`}
                  />
                ))}
              </div>

              {/* Browser Push Notifications */}
              <BrowserPushToggle />

              {prefs.delivery_channels.includes('telegram') && (
                <TelegramConnect
                  status={telegramStatus}
                  chatId={prefs.telegram_chat_id}
                  onLinked={(chatId) => {
                    updatePrefs({ telegram_chat_id: chatId });
                  }}
                  onClearLink={() => updatePrefs({ telegram_chat_id: null })}
                />
              )}
            </div>

            <div className="rounded-2xl border cx-border cx-bg-card p-5">
              <h2 className="text-sm font-black cx-text-strong">Briefings</h2>
              <p className="mt-1 text-xs leading-relaxed cx-text-muted">
                Daily and weekly briefings summarize what the engine saw, what worked, and what to
                watch — written so you can read them in under a minute.
              </p>
              <div className="mt-3 space-y-2">
                <ToggleRow
                  label="Daily briefing"
                  description="Top setups, news on the calendar, and risk flags. Delivered once per day at your session open."
                  checked={prefs.daily_briefing_enabled}
                  onChange={(next) => updatePrefs({ daily_briefing_enabled: next })}
                  testId="briefing-daily"
                />
                <ToggleRow
                  label="Weekly briefing"
                  description="End-of-week review: setups that fired, what the engine improved, and what\'s calibrated now."
                  checked={prefs.weekly_briefing_enabled}
                  onChange={(next) => updatePrefs({ weekly_briefing_enabled: next })}
                  testId="briefing-weekly"
                />
              </div>
            </div>
          </section>

          {/* Save bar */}
          <div className="sticky bottom-3 z-30 flex items-center justify-between gap-3 rounded-2xl border cx-border bg-[#080d18]/90 p-3 backdrop-blur">
            <div className="flex items-center gap-2 text-xs cx-text-muted">
              {status === 'saved' && (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              {status === 'saving' && (
                <span className="inline-flex items-center gap-1 text-cyan-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                </span>
              )}
              {dirty && status === 'idle' && <span>You have unsaved changes</span>}
              {!dirty && status === 'idle' && <span>Everything is up to date</span>}
            </div>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || status === 'saving'}
              data-testid="save-preferences"
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-black text-cyan-300 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              Save preferences
            </button>
          </div>

          {/* Live Activity */}
          <LiveActivity />

          {/* Recent feed */}
          <section className="rounded-2xl border cx-border cx-bg-card p-5">
            <h2 className="text-sm font-black cx-text-strong">Recent alerts</h2>
            <p className="mt-1 text-xs leading-relaxed cx-text-muted">
              The last 50 alerts the engine fired for you across every channel. In-app feed is the
              source of truth — Telegram and email mirror it.
            </p>
            <div className="mt-3 space-y-2">
              {feed.length === 0 && (
                <div className="rounded-xl border border-dashed cx-border-strong py-10 text-center text-xs cx-text-faint">
                  No alerts yet. Once the engine finds a setup that clears your thresholds, you\'ll
                  see it here.
                </div>
              )}
              {feed.map((event, idx) => {
                const tone = SEVERITY_TONE[event.severity] || SEVERITY_TONE.info;
                const Icon = tone.icon;
                const typeLabel = ALERT_TYPE_LABELS[event.alert_type] || event.alert_type;
                return (
                  <div key={`${event.created_at}-${idx}`} className="flex items-start gap-3 rounded-xl border cx-border cx-bg-elev p-3">
                    <span className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border ${tone.chip}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="text-sm font-bold cx-text-strong">{event.title}</div>
                        <div className="text-[10px] uppercase tracking-wider cx-text-faint">
                          {new Date(event.created_at).toLocaleString()}
                        </div>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed cx-text-muted">{event.body}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider cx-text-faint">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${tone.chip}`}>
                          {typeLabel}
                        </span>
                        <span className="rounded-md border cx-border cx-bg-card px-1.5 py-0.5 cx-text-muted">
                          {event.pair}
                        </span>
                        {event.timeframe && (
                          <span className="rounded-md border cx-border cx-bg-card px-1.5 py-0.5 cx-text-muted">
                            {event.timeframe}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

// ── Browser Push Notifications Toggle ───────────────────────────────
const BrowserPushToggle: React.FC = () => {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    setSupported(true);
    getPushStatus().then((status) => {
      setSubscribed(status.subscribed);
      setPermission(status.permission);
    });
  }, []);

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        const sub = await requestPushPermissionAndSubscribe();
        if (sub) {
          setSubscribed(true);
          setPermission('granted');
        } else {
          const status = await getPushStatus();
          setPermission(status.permission);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  if (!supported) {
    return (
      <div className="mt-3 rounded-md border border-slate-700/50 bg-slate-800/30 p-3 text-xs leading-relaxed text-slate-400">
        Browser push notifications are not supported in this browser. Use Telegram or email instead.
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-200">
        Push notifications were blocked. To enable them, click the lock icon in your browser's address bar and allow notifications for this site.
      </div>
    );
  }

  return (
    <label className="mt-3 flex items-start justify-between gap-4 rounded-xl border cx-border cx-bg-card p-3 transition hover:cx-bg-card-hover">
      <div className="min-w-0">
        <div className="text-sm font-bold cx-text-strong flex items-center gap-2">
          <BellRing className="h-4 w-4 text-cyan-300" />
          Browser push notifications
        </div>
        <p className="mt-1 text-xs leading-relaxed cx-text-muted">
          Get alerts on your device even when ConfluenceX is in the background.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={subscribed}
        onClick={handleToggle}
        disabled={loading}
        data-testid="browser-push-toggle"
        className={`relative h-6 w-11 flex-none rounded-full border transition ${
          subscribed
            ? 'border-cyan-400/40 bg-cyan-400/30'
            : 'cx-border cx-bg-card'
        } ${loading ? 'opacity-50 cursor-wait' : ''}`}
      >
        {loading ? (
          <Loader2 className="absolute top-1 left-2.5 h-3.5 w-3.5 animate-spin text-cyan-300" />
        ) : (
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              subscribed ? 'left-6 bg-cyan-300' : 'left-0.5 bg-slate-300'
            }`}
          />
        )}
      </button>
    </label>
  );
};

interface TelegramConnectProps {
  status: TelegramStatus | null;
  chatId: string | null;
  onLinked: (chatId: string) => void;
  onClearLink: () => void;
}

// Polls /api/alerts/preferences for up to ~60s after the user opens the
// Telegram deep link, so the linked chat_id shows up without a manual
// page reload. Stops early as soon as the value changes.
const TelegramConnect: React.FC<TelegramConnectProps> = ({ status, chatId, onLinked, onClearLink }) => {
  const [linkState, setLinkState] = useState<'idle' | 'minting' | 'awaiting' | 'linked' | 'error'>('idle');
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
      }
    };
  }, []);

  const stopPolling = () => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const connect = async () => {
    if (!status?.configured) {
      setError('Telegram alerts are not configured on the server yet.');
      return;
    }
    setError(null);
    setLinkState('minting');
    try {
      const token = await bwtsApi.telegramLinkToken();
      setDeepLink(token.deep_link);
      setLinkState('awaiting');
      window.open(token.deep_link, '_blank', 'noopener');
      let elapsed = 0;
      pollTimer.current = window.setInterval(async () => {
        elapsed += 2000;
        try {
          const prefs = await bwtsApi.alertPreferences();
          if (prefs.telegram_chat_id) {
            stopPolling();
            setLinkState('linked');
            onLinked(prefs.telegram_chat_id);
            return;
          }
        } catch {
          // swallow — keep polling until the timer expires
        }
        if (elapsed >= 60_000) {
          stopPolling();
          setLinkState('error');
          setError("We didn't see a /start from the bot. The link expires after 10 minutes — try again.");
        }
      }, 2000);
    } catch (err) {
      setLinkState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const unlink = () => {
    stopPolling();
    setLinkState('idle');
    setDeepLink(null);
    setError(null);
    onClearLink();
  };

  if (!status?.configured) {
    return (
      <div className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-200">
        Telegram alerts are not configured on this deployment yet. Set{' '}
        <code className="font-mono">TELEGRAM_BOT_TOKEN</code> on the API service to enable them.
      </div>
    );
  }

  const botHandle = status.username ? `@${status.username}` : 'the bot';

  if (chatId) {
    return (
      <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-xs leading-relaxed text-emerald-100">
        <div className="min-w-0">
          <div className="font-bold text-emerald-200">Linked</div>
          <div className="mt-0.5 text-emerald-100/80">
            Alerts will arrive in <code className="font-mono">{botHandle}</code>. Chat id:{' '}
            <code className="font-mono">{chatId}</code>.
          </div>
          <div className="mt-1 text-emerald-100/70">
            Send <code className="font-mono">/status</code> in the chat to verify, or{' '}
            <code className="font-mono">/stop</code> to disable delivery.
          </div>
        </div>
        <button
          type="button"
          onClick={unlink}
          className="flex-none rounded border border-emerald-400/30 px-2 py-1 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-400/10"
          data-testid="telegram-unlink"
        >
          Unlink
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border cx-border cx-bg-elev p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-xs leading-relaxed cx-text-muted">
          Link <code className="font-mono">{botHandle}</code> to receive alerts in Telegram.
          <br />
          <span className="cx-text-faint">
            You'll be asked to tap <b>Start</b> in Telegram. We'll detect the link automatically.
          </span>
          {error && <div className="mt-1 text-rose-300">{error}</div>}
        </div>
        <button
          type="button"
          onClick={connect}
          disabled={linkState === 'minting' || linkState === 'awaiting'}
          data-testid="telegram-connect"
          className="inline-flex flex-none items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-black text-cyan-300 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {linkState === 'minting' || linkState === 'awaiting' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {linkState === 'minting' ? 'Opening…' : 'Waiting for /start'}
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5" />
              Connect Telegram
            </>
          )}
        </button>
      </div>
      {deepLink && linkState === 'awaiting' && (
        <div className="mt-2 break-all text-[11px] cx-text-faint">
          If Telegram didn't open:{' '}
          <a className="text-cyan-300 underline" href={deepLink} target="_blank" rel="noopener noreferrer">
            {deepLink}
          </a>
        </div>
      )}
    </div>
  );
};

// ── Live Activity ──────────────────────────────────────────────────

const LIFECYCLE_COLORS: Record<string, string> = {
  observing: 'bg-slate-400',
  developing: 'bg-amber-400',
  near_trigger: 'bg-orange-400',
  ready: 'bg-emerald-400',
  active: 'bg-cyan-400',
  tp1_reached: 'bg-green-400',
  tp2_reached: 'bg-green-500',
  tp3_reached: 'bg-green-600',
  break_even: 'bg-blue-400',
  stopped: 'bg-rose-400',
  expired: 'bg-slate-500',
  invalidated: 'bg-rose-500',
  blocked_by_news: 'bg-amber-500',
  blocked_by_data: 'bg-amber-600',
  blocked_by_spread: 'bg-amber-700',
  blocked_by_risk: 'bg-red-500',
  closed: 'bg-slate-500',
  unknown: 'bg-slate-600',
};

const TIER_COLORS: Record<string, string> = {
  STRONG: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  VALID: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  WATCHLIST: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  NO_TRADE: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
};

const CALENDAR_TONE: Record<string, { chip: string; icon: React.ComponentType<{ className?: string }> }> = {
  CLEAR: { chip: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300', icon: CheckCircle2 },
  CAUTION: { chip: 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300', icon: AlertTriangle },
  BLOCKED: { chip: 'border-rose-400/20 bg-rose-400/[0.06] text-rose-300', icon: XCircle },
  POST_NEWS: { chip: 'border-violet-400/20 bg-violet-400/[0.06] text-violet-300', icon: Clock },
  UNKNOWN: { chip: 'border-slate-500/20 bg-slate-500/[0.06] text-slate-400', icon: Info },
};

const formatTimeSince = (iso: string | null): string => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
};

const LiveActivity: React.FC = () => {
  const [data, setData] = useState<ActivityFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPair, setExpandedPair] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await bwtsApi.activityFeed();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = window.setInterval(load, 30_000);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  if (loading && !data) {
    return (
      <section className="rounded-2xl border cx-border cx-bg-card p-5">
        <div className="flex items-center gap-2 text-sm cx-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading live activity…
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-5">
        <div className="flex items-center gap-2 text-sm text-rose-300">
          <XCircle className="h-4 w-4" /> Could not load activity: {error}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const { scanner_running, pairs, transitions, calendar, generated_at } = data;

  // Sort pairs: actionable first (STRONG/VALID), then by score descending
  const sortedPairs = [...pairs].sort((a, b) => {
    const tierOrder: Record<string, number> = { STRONG: 0, VALID: 1, WATCHLIST: 2, NO_TRADE: 3 };
    const ta = tierOrder[a.tier] ?? 4;
    const tb = tierOrder[b.tier] ?? 4;
    if (ta !== tb) return ta - tb;
    return b.score - a.score;
  });

  return (
    <section className="rounded-2xl border cx-border cx-bg-card p-5">
      {/* Header with scanner status */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black cx-text-strong flex items-center gap-2">
            <Radio className="h-4 w-4 text-cyan-300" />
            Live Activity
          </h2>
          <p className="mt-1 text-xs leading-relaxed cx-text-muted">
            Real-time engine status, active setups, and lifecycle transitions across {pairs.length} pairs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider ${
            scanner_running
              ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border border-rose-400/30 bg-rose-400/10 text-rose-300'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${scanner_running ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {scanner_running ? 'RUNNING' : 'STOPPED'}
          </span>
          <span className="text-[10px] cx-text-faint">
            Updated {formatTimeSince(generated_at)}
          </span>
        </div>
      </div>

      {/* Calendar gate banner */}
      {calendar && calendar.global_status !== 'UNKNOWN' && (
        <CalendarBanner calendar={calendar} />
      )}

      {/* Active setups grid */}
      <div className="mt-4 space-y-2">
        {sortedPairs.map((p) => (
          <PairCard
            key={p.pair}
            pair={p}
            expanded={expandedPair === p.pair}
            onToggle={() => setExpandedPair(expandedPair === p.pair ? null : p.pair)}
          />
        ))}
        {sortedPairs.length === 0 && (
          <div className="rounded-xl border border-dashed cx-border-strong py-8 text-center text-xs cx-text-faint">
            No pairs configured. Add pairs in the scanner config to see live activity.
          </div>
        )}
      </div>

      {/* Recent transitions */}
      {transitions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-black cx-text-strong flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-300" />
            Recent transitions
          </h3>
          <div className="mt-2 space-y-1.5">
            {transitions.slice(0, 10).map((t, i) => (
              <TransitionRow key={`${t.pair}-${t.timestamp}-${i}`} transition={t} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const CalendarBanner: React.FC<{ calendar: ActivityFeed['calendar'] }> = ({ calendar }) => {
  const tone = CALENDAR_TONE[calendar.global_status] || CALENDAR_TONE.UNKNOWN;
  const Icon = tone.icon;

  return (
    <div className={`mt-3 flex items-start gap-3 rounded-xl border p-3 ${tone.chip}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold">
          Calendar: {calendar.global_status}
          {calendar.minutes_to_event != null && calendar.minutes_to_event > 0 && (
            <span className="ml-2 font-mono">{calendar.minutes_to_event}m to event</span>
          )}
        </div>
        {calendar.event_title && (
          <div className="mt-0.5 text-[11px] opacity-80">
            {calendar.event_title}
            {calendar.currency && <span className="ml-1.5 opacity-60">({calendar.currency})</span>}
            {calendar.impact && <span className="ml-1.5 opacity-60">· {calendar.impact}</span>}
          </div>
        )}
        {calendar.affected_symbols.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {calendar.affected_symbols.map((s) => (
              <span key={s} className="rounded border border-current/10 px-1.5 py-0.5 text-[10px] font-mono opacity-70">{s}</span>
            ))}
          </div>
        )}
        {calendar.next_event && (
          <div className="mt-1 text-[10px] opacity-60">
            Next: {calendar.next_event.title} — {new Date(calendar.next_event.scheduled_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
};

const PairCard: React.FC<{
  pair: ActivityPair;
  expanded: boolean;
  onToggle: () => void;
}> = ({ pair, expanded, onToggle }) => {
  const lifecycleColor = LIFECYCLE_COLORS[pair.lifecycle] || LIFECYCLE_COLORS.unknown;
  const tierColor = TIER_COLORS[pair.tier] || TIER_COLORS.NO_TRADE;
  const DirectionIcon = pair.direction === 'BUY' ? TrendingUp : pair.direction === 'SELL' ? TrendingDown : Circle;
  const directionColor = pair.direction === 'BUY' ? 'text-emerald-400' : pair.direction === 'SELL' ? 'text-rose-400' : 'text-slate-400';

  return (
    <div
      className={`rounded-xl border cx-border transition ${
        pair.tier === 'STRONG' || pair.tier === 'VALID'
          ? 'border-cyan-400/20 bg-cyan-400/[0.03]'
          : 'cx-bg-card'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        {/* Lifecycle dot */}
        <span className={`h-2.5 w-2.5 flex-none rounded-full ${lifecycleColor}`} />

        {/* Pair name + direction */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black cx-text-strong font-mono">{pair.pair}</span>
            <span className={directionColor}>
              <DirectionIcon className="h-3.5 w-3.5" />
            </span>
            <span className={`text-[10px] font-bold ${directionColor}`}>
              {pair.direction}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider cx-text-faint">
            <span className="font-mono">{pair.lifecycle}</span>
            {pair.timing_status !== 'UNKNOWN' && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {pair.timing_status}
              </span>
            )}
            {pair.calendar_status !== 'UNKNOWN' && (
              <span className="flex items-center gap-0.5">
                <Shield className="h-2.5 w-2.5" />
                {pair.calendar_status}
              </span>
            )}
          </div>
        </div>

        {/* Score + tier badge */}
        <div className="flex items-center gap-2">
          <span className="text-right">
            <div className="text-lg font-black font-mono cx-text-strong">{pair.score}</div>
            <div className="text-[9px] uppercase tracking-wider cx-text-faint">score</div>
          </span>
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${tierColor}`}>
            {pair.tier}
          </span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t cx-border px-3 pb-3 pt-2 space-y-2">
          {/* Trade plan summary */}
          {pair.entry && (
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="cx-text-faint">Entry</span>
                <div className="font-mono font-bold cx-text-strong">{pair.entry}</div>
              </div>
              <div>
                <span className="cx-text-faint">Stop</span>
                <div className="font-mono font-bold text-rose-300">{pair.stop_loss}</div>
              </div>
              <div>
                <span className="cx-text-faint">TP1</span>
                <div className="font-mono font-bold text-emerald-300">{pair.tp1}</div>
              </div>
            </div>
          )}
          {pair.net_rr && (
            <div className="text-[11px]">
              <span className="cx-text-faint">Net R:R</span>{' '}
              <span className="font-mono font-bold text-cyan-300">{pair.net_rr.toFixed(1)}R</span>
            </div>
          )}

          {/* Lifecycle reason */}
          {pair.reason && (
            <div className="text-[11px] cx-text-muted">
              <span className="cx-text-faint">Reason:</span> {pair.reason}
            </div>
          )}

          {/* Blocking reasons */}
          {pair.blocking_reasons.length > 0 && (
            <div className="space-y-1">
              {pair.blocking_reasons.map((br, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" />
                  {br.message || br.code || 'Blocked'}
                </div>
              ))}
            </div>
          )}

          {/* Eligibility badge */}
          <div className="flex items-center gap-2">
            {pair.eligible ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-1.5 py-0.5 text-[10px] text-emerald-300">
                <Zap className="h-3 w-3" /> Eligible for alerts
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border cx-border px-1.5 py-0.5 text-[10px] cx-text-faint">
                Not eligible
              </span>
            )}
            <span className="text-[10px] cx-text-faint">
              Status: {pair.status}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const TransitionRow: React.FC<{ transition: ActivityTransition }> = ({ transition }) => {
  const fromColor = LIFECYCLE_COLORS[transition.from_state || ''] || 'bg-slate-500';
  const toColor = LIFECYCLE_COLORS[transition.to_state] || LIFECYCLE_COLORS.unknown;

  return (
    <div className="flex items-start gap-2.5 rounded-lg cx-bg-elev px-3 py-2">
      <span className="mt-1 text-[10px] font-mono font-black cx-text-strong flex-none w-16">{transition.pair}</span>
      <div className="flex items-center gap-1.5 flex-none">
        <span className={`h-2 w-2 rounded-full ${fromColor}`} />
        <span className="text-[10px] font-mono cx-text-muted">{transition.from_state || '—'}</span>
        <ArrowRight className="h-3 w-3 cx-text-faint" />
        <span className={`h-2 w-2 rounded-full ${toColor}`} />
        <span className="text-[10px] font-mono font-bold cx-text-strong">{transition.to_state}</span>
      </div>
      <span className="text-[10px] cx-text-faint ml-auto flex-none">{formatTimeSince(transition.timestamp)}</span>
    </div>
  );
};

export default Alerts;