// Settings — read-only config view for regular users.
//
// Phase 1 (ConfluenceX trust and consistency):
//   - Operational controls (kill switch, manual scan, account mode toggles)
//     are gated behind admin auth. Regular users and Demo Trader see only
//     the read-only configuration surface.
//   - Score thresholds are displayed on the canonical 0–100 scale instead
//     of the legacy /80 scale.
//   - The kill-switch code path stays in the file for Phase 5 admin tools,
//     but it is unreachable from the customer view.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Settings as SettingsIcon, ShieldOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bwtsApi, type BwtsConfig, type BwtsKillStatus } from '../services/bwtsApi';
import { isStrongScore } from '../utils/scoring';
import TradeLockerConnectCard from '../components/TradeLockerConnectCard';

const Settings: React.FC = () => {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState<BwtsConfig | null>(null);
  const [kill, setKill] = useState<BwtsKillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const [c, k] = await Promise.all([
        bwtsApi.config(),
        // The kill-status endpoint is harmless to call for everyone, but
        // never surface the result to non-admins (see render guard below).
        bwtsApi.killStatus().catch(() => null),
      ]);
      setConfig(c);
      setKill(k);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const announce = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const toggleKill = async () => {
    if (!kill || !isAdmin) return;
    setBusy(true);
    try {
      const next = await bwtsApi.setKill(!kill.engaged, !kill.engaged ? 'Engaged from admin' : '');
      setKill(next);
      announce(next.engaged ? 'Kill switch ENGAGED — execution halted' : 'Kill switch disengaged');
    } catch (e: any) {
      announce(`Failed: ${e?.message || 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  const requestScan = async () => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await bwtsApi.requestScan();
      announce('Scan requested — worker will run on next tick (within seconds)');
    } catch (e: any) {
      announce(`Failed: ${e?.message || 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold cx-text-strong flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-emerald-400" />
          Settings
        </h1>
        <p className="cx-text-faint mt-1">Read-only view of your scanner configuration.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {toast && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg px-4 py-3">
          {toast}
        </div>
      )}

      {/* Operational controls — admin only.
          Phase 5 may resurrect these in an internal admin view. Until then
          they stay in this file (not deleted) but are unreachable from the
          customer surface. */}
      {isAdmin && kill !== null && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className={`rounded-xl p-5 border ${
            kill.engaged
              ? 'bg-red-500/10 border-red-500/40'
              : 'bg-gray-900/60 border-gray-700/50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                {kill.engaged ? (
                  <ShieldOff className="w-4 h-4 text-red-400" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                )}
                Kill Switch
              </h3>
              <span
                className={`text-xs px-2 py-0.5 rounded border ${
                  kill.engaged
                    ? 'bg-red-500/20 text-red-300 border-red-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {kill.engaged ? 'ENGAGED' : 'DISENGAGED'}
              </span>
            </div>
            <p className="text-sm cx-text-faint mb-4">
              {kill.engaged
                ? 'Execution is halted. New trades are rejected by the trade manager.'
                : 'Execution is active. The trade manager will process STRONG signals.'}
            </p>
            {kill.engaged && kill.reason && (
              <p className="text-xs text-red-300/80 mb-3">Reason: {kill.reason}</p>
            )}
            <button
              onClick={toggleKill}
              disabled={busy}
              className={`w-full px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
                kill.engaged
                  ? 'bg-emerald-500 hover:bg-emerald-600 cx-text-strong'
                  : 'bg-red-500 hover:bg-red-600 cx-text-strong'
              }`}
            >
              {kill.engaged ? 'Disengage Kill Switch' : 'Engage Kill Switch'}
            </button>
          </div>

          <div className="rounded-xl p-5 border bg-gray-900/60 border-gray-700/50">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2 mb-3">
              <RefreshCw className="w-4 h-4 text-emerald-400" />
              Manual Scan
            </h3>
            <p className="text-sm cx-text-faint mb-4">
              Request the scanner to run an immediate cycle. Useful for testing
              without waiting for the next scheduled scan.
            </p>
            <button
              onClick={requestScan}
              disabled={busy}
              className="w-full px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 cx-text-strong rounded-lg font-medium text-sm transition-colors"
            >
              Trigger Scan Now
            </button>
          </div>
        </div>
      )}

      {/* Broker connection — TradeLocker demo/live link */}
      <TradeLockerConnectCard />

      {/* Read-only config */}
      {config && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Score Thresholds (0–100)">
            <Row label="Strong tier"    value={isStrongScore(config.thresholds.strong) ? `≥ ${config.thresholds.strong}/100` : '—'} />
            <Row label="Good tier"      value={isStrongScore(config.thresholds.good) ? `≥ ${config.thresholds.good}/100` : '—'} />
            <Row label="Watchlist tier" value={isStrongScore(config.thresholds.watchlist) ? `≥ ${config.thresholds.watchlist}/100` : '—'} />
          </Card>
          <Card title="Scan Cadence">
            <Row label="Scan interval"   value={`${config.scan_interval_seconds}s`} />
            <Row label="News blackout"   value={`±${config.news_blackout_minutes} min`} />
          </Card>
          <Card title={`Configured Pairs (${config.pairs.length})`}>
            <div className="flex flex-wrap gap-2">
              {config.pairs.map((p) => (
                <span
                  key={p}
                  className="px-2 py-1 bg-gray-800 text-gray-300 text-xs rounded border border-gray-700"
                >
                  {p}
                </span>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold cx-text-strong mb-1">Configuration editing not yet wired</h3>
            <p className="cx-text-faint text-sm">
              Thresholds, pairs, and scan interval are set via Render env vars
              (or <code className="text-emerald-300">render.yaml</code>). A
              live-edit endpoint will land in a follow-up.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5">
    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between py-1.5 border-b border-gray-800/50 last:border-0">
    <span className="text-sm cx-text-faint">{label}</span>
    <span className="text-sm cx-text-strong font-mono">{value}</span>
  </div>
);

export default Settings;