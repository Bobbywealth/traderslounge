import React, { useEffect, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

/**
 * Surfaces an in-app "Install ConfluenceX" prompt for the PWA.
 *
 * - Listens for the standard `beforeinstallprompt` event (Chrome / Edge /
 *   Android / Samsung / desktop PWA install flow).
 * - Hides itself automatically once the app is running in standalone mode.
 * - Includes a small iOS helper card (Add to Home Screen) since iOS never
 *   fires `beforeinstallprompt` — we detect iOS Safari via the touch + webkit
 *   user-agent probe and surface the manual instruction.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'cx.pwa.installDismissedAt';
const DISMISS_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const isWebkit = /WebKit/.test(ua);
  const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  return isIos && isWebkit && !isStandalone;
}

const InstallPwaPrompt: React.FC = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Already installed → never show.
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    // Recently dismissed → skip.
    try {
      const last = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
      if (last && Date.now() - last < DISMISS_COOLDOWN_MS) {
        setDismissed(true);
        return;
      }
    } catch {
      /* localStorage unavailable */
    }

    setShowIosHint(isIosSafari());

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;
  if (!deferred && !showIosHint) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferred(null);
    dismiss();
  };

  return (
    <div
      role="dialog"
      aria-label="Install ConfluenceX"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 sm:bottom-6"
    >
      <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-cyan-300/25 bg-[#0a0e1a]/95 shadow-[0_10px_50px_rgba(139,92,246,0.35)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-cyan-400/10 via-violet-500/10 to-fuchsia-500/10" />
        <div className="flex items-start gap-3 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-violet-500/20 ring-1 ring-cyan-300/30">
            <Smartphone className="h-5 w-5 text-cyan-300" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-bold text-white">Install ConfluenceX</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {deferred
                ? 'Add the full trading workspace to your home screen — instant launch, offline chart cache, and chart-first shortcuts.'
                : 'Add ConfluenceX to your home screen for instant chart access. Tap the Share button, then “Add to Home Screen”.'}
            </p>
            {deferred ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={install}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 px-3.5 py-2 text-xs font-bold text-[#070a12] shadow-[0_0_24px_rgba(34,211,238,0.35)] transition hover:translate-y-[-1px]"
                >
                  <Download className="h-3.5 w-3.5" /> Install
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-lg border border-slate-700/60 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800/60"
                >
                  Not now
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800/70 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstallPwaPrompt;