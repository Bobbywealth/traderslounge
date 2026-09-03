/**
 * First-run onboarding wizard. Shows once per user (localStorage flag)
 * after first authenticated visit, walking them through workspace
 * picklists before they hit the Live Scanner noise.
 *
 * Three steps:
 *   1. Pick the asset classes you trade (forex, crypto, commodities, indices).
 *   2. Pick the sessions you actually sit at (London, NY, Asia).
 *   3. Optional: drop a TradeLocker paper-test account so demo orders can
 *      resolve in the Journal.
 *
 * Skippable at every step. Completion persists to localStorage so a
 * refresh doesn't re-show the wizard, and the choices persist so the
 * Live Scanner / Signals pages can pre-filter on them later.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';

const STORAGE_KEY = 'cx:onboarding:v1';
const PREFERENCES_KEY = 'cx:onboarding:preferences:v1';

export type OnboardingPreferences = {
  assetClasses: string[];
  sessions: string[];
  tradelocker: 'skip' | 'connect' | 'later';
};

const DEFAULT_PREFERENCES: OnboardingPreferences = {
  assetClasses: ['forex', 'crypto'],
  sessions: ['london', 'new_york'],
  tradelocker: 'skip',
};

const ASSET_CLASSES = [
  { id: 'forex', label: 'Forex (EURUSD, GBPUSD…)' },
  { id: 'crypto', label: 'Crypto (BTCUSD, ETHUSD…)' },
  { id: 'commodities', label: 'Commodities (XAUUSD, XAGUSD…)' },
  { id: 'indices', label: 'Indices (US30, NAS100…)' },
];

const SESSIONS = [
  { id: 'asia', label: 'Asia (Tokyo)' },
  { id: 'london', label: 'London' },
  { id: 'new_york', label: 'New York' },
];

const STEPS = ['Asset classes', 'Sessions', 'Broker connection'] as const;

const isDone = (): boolean => {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(STORAGE_KEY) === 'done'; } catch { return true; }
};

const markDone = () => {
  try { window.localStorage.setItem(STORAGE_KEY, 'done'); } catch { /* ignore quota */ }
};

const loadPreferences = (): OnboardingPreferences => {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<OnboardingPreferences>;
    return {
      assetClasses: Array.isArray(parsed.assetClasses) ? parsed.assetClasses : DEFAULT_PREFERENCES.assetClasses,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : DEFAULT_PREFERENCES.sessions,
      tradelocker: parsed.tradelocker === 'connect' || parsed.tradelocker === 'later' ? parsed.tradelocker : 'skip',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

const savePreferences = (prefs: OnboardingPreferences) => {
  try { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs)); } catch { /* ignore quota */ }
};

export interface OnboardingWizardProps {
  /**
   * Force the wizard visible (used by a /welcome deep link or an admin
   * "Replay onboarding" button). Ignored when the user already finished.
   */
  force?: boolean;
  onClose?: () => void;
}

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ force = false, onClose }) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<OnboardingPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    if (force) {
      setPrefs(loadPreferences());
      setOpen(true);
      return;
    }
    if (!isDone()) {
      setPrefs(loadPreferences());
      setOpen(true);
    }
  }, [force]);

  const finish = (completed: boolean) => {
    if (completed) savePreferences(prefs);
    markDone();
    setOpen(false);
    onClose?.();
  };

  const toggleArrayValue = <K extends 'assetClasses' | 'sessions'>(key: K, value: string) => {
    setPrefs((prev) => {
      const set = new Set(prev[key]);
      if (set.has(value)) set.delete(value); else set.add(value);
      return { ...prev, [key]: Array.from(set) };
    });
  };

  const nextDisabled = useMemo(() => {
    if (step === 0 && prefs.assetClasses.length === 0) return true;
    if (step === 1 && prefs.sessions.length === 0) return true;
    return false;
  }, [step, prefs]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace setup"
      data-testid="onboarding-wizard"
    >
      <div className="relative w-full max-w-xl rounded-3xl border border-cyan-400/20 bg-[#080d1a] p-6 shadow-2xl shadow-cyan-500/10">
        <button
          type="button"
          onClick={() => finish(false)}
          className="absolute right-4 top-4 rounded-md p-1 cx-text-faint transition hover:bg-white/[0.06]"
          aria-label="Skip onboarding"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10">
            <Sparkles className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <div className="text-[10px] font-black tracking-[0.22em] text-cyan-300">FIRST-RUN SETUP</div>
            <h2 className="text-xl font-black cx-text-strong">Shape your workspace</h2>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {STEPS.map((label, index) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[10px] font-black ${
                  index < step
                    ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                    : index === step
                    ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200'
                    : 'border-white/[0.08] bg-white/[0.04] cx-text-faint'
                }`}
              >
                {index + 1}
              </div>
              <span className={`text-[10px] font-black uppercase tracking-wider ${index <= step ? 'cx-text-strong' : 'cx-text-faint'}`}>
                {label}
              </span>
              {index < STEPS.length - 1 && <div className="flex-1 h-px bg-white/[0.06]" />}
            </div>
          ))}
        </div>

        <div className="mt-6 min-h-[180px]">
          {step === 0 && (
            <div>
              <p className="text-sm cx-text-muted">What do you actually trade? The Live Scanner and Signals feed will pre-focus on these.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ASSET_CLASSES.map((opt) => {
                  const checked = prefs.assetClasses.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleArrayValue('assetClasses', opt.id)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                        checked
                          ? 'border-cyan-400/40 bg-cyan-400/10 cx-text-strong'
                          : 'border-white/[0.06] bg-white/[0.02] cx-text-muted hover:border-white/[0.12]'
                      }`}
                      data-testid={`onboarding-asset-${opt.id}`}
                    >
                      <span>{opt.label}</span>
                      {checked && <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">on</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="text-sm cx-text-muted">Which sessions do you sit at? Calendar gates will warn you when setups fire outside these.</p>
              <div className="mt-4 grid gap-2">
                {SESSIONS.map((opt) => {
                  const checked = prefs.sessions.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleArrayValue('sessions', opt.id)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                        checked
                          ? 'border-violet-400/40 bg-violet-400/10 cx-text-strong'
                          : 'border-white/[0.06] bg-white/[0.02] cx-text-muted hover:border-white/[0.12]'
                      }`}
                      data-testid={`onboarding-session-${opt.id}`}
                    >
                      <span>{opt.label}</span>
                      {checked && <span className="text-[10px] font-black uppercase tracking-wider text-violet-300">on</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-sm cx-text-muted">Optional. Connect a TradeLocker demo account so paper-test orders resolve in the Journal automatically.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {(['skip', 'connect', 'later'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setPrefs((prev) => ({ ...prev, tradelocker: opt }))}
                    className={`flex flex-col items-start rounded-xl border px-3 py-3 text-left text-sm transition ${
                      prefs.tradelocker === opt
                        ? 'border-emerald-400/40 bg-emerald-400/10 cx-text-strong'
                        : 'border-white/[0.06] bg-white/[0.02] cx-text-muted hover:border-white/[0.12]'
                    }`}
                    data-testid={`onboarding-broker-${opt}`}
                  >
                    <span className="text-[10px] font-black uppercase tracking-wider cx-text-faint">
                      {opt === 'skip' ? 'No thanks' : opt === 'connect' ? 'Connect now' : 'Remind me later'}
                    </span>
                    <span className="mt-1">
                      {opt === 'skip'
                        ? 'Demo data only, no broker wiring.'
                        : opt === 'connect'
                        ? 'Open the Settings → Broker card.'
                        : 'Nudge me on the Command Center next visit.'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs font-black cx-text-muted transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
              disabled={nextDisabled}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2 text-xs font-black text-[#05070d] transition disabled:opacity-40"
              data-testid="onboarding-next"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => finish(true)}
              className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2 text-xs font-black text-[#05070d]"
              data-testid="onboarding-finish"
            >
              Enter workspace
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
