// Settings — read-only view of the live scanner config (from /api/config).
// Editing requires a PUT endpoint that re-loads worker env, which is a
// follow-up.

import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, AlertCircle } from 'lucide-react';
import { bwtsApi, type BwtsConfig } from '../services/bwtsApi';

const Settings: React.FC = () => {
  const [config, setConfig] = useState<BwtsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bwtsApi
      .config()
      .then(setConfig)
      .catch((e) => setError(e?.message || 'Failed to load config'));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-emerald-400" />
          Settings
        </h1>
        <p className="text-gray-400 mt-1">Live scanner configuration (read-only).</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {config && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Score Thresholds">
            <Row label="Strong tier"    value={`≥ ${config.thresholds.strong}/80`} />
            <Row label="Good tier"      value={`≥ ${config.thresholds.good}/80`} />
            <Row label="Watchlist tier" value={`≥ ${config.thresholds.watchlist}/80`} />
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

      <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <AlertCircle className="w-6 h-6 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Editing not yet wired</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              These values are read-only for now. Changing them updates the
              worker env vars on Render (or in <code className="text-emerald-300">render.yaml</code>).
              A live-edit endpoint (PUT /api/config) lands in a follow-up.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5">
    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between py-1.5 border-b border-gray-800/50 last:border-0">
    <span className="text-sm text-gray-400">{label}</span>
    <span className="text-sm text-white font-mono">{value}</span>
  </div>
);

export default Settings;
