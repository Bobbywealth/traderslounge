// Compact BWTS status widget — shows scanner health + recent signal counts.
// Pulls from the Python read API. Auto-refreshes every 30s. Designed to
// drop into the Dashboard above existing content.

import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { bwtsApi, type BwtsHealth, type BwtsSignal } from '../services/bwtsApi';

const BwtsStatusBar: React.FC = () => {
  const [health, setHealth] = useState<BwtsHealth | null>(null);
  const [recent, setRecent] = useState<BwtsSignal[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [h, s] = await Promise.all([
          bwtsApi.health(),
          bwtsApi.signals({ limit: 25 }),
        ]);
        setHealth(h);
        setRecent(s.signals);
        setError(null);
      } catch (e: any) {
        setError(e?.message || 'BWTS API unreachable');
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const strong = recent.filter((s) => s.tier === 'STRONG').length;
  const good = recent.filter((s) => s.tier === 'GOOD').length;

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-200">BWTS scanner unreachable</p>
          <p className="text-xs text-amber-300/70">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-700/50 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            health?.status === 'ok' ? 'bg-emerald-500/20' : 'bg-gray-700/40'
          }`}>
            {health?.status === 'ok' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <Activity className="w-5 h-5 text-gray-400" />
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">BWTS Scanner</p>
            <p className="text-sm font-medium text-white">
              {health ? `${(health.status || 'unknown').toUpperCase()} · ${(health.pairs ?? []).length} pairs tracked` : 'Loading…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <Stat label="Total signals"  value={health?.db_signals ?? 0} />
          <Stat label="Strong (recent)" value={strong} color="text-emerald-400" />
          <Stat label="Good (recent)"   value={good} color="text-blue-400" />
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/scanner"
            className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Activity className="w-3.5 h-3.5" />
            Live Scanner
          </Link>
          <Link
            to="/signals"
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            Signals
          </Link>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; color?: string }> = ({ label, value, color }) => (
  <div className="text-center">
    <p className={`text-lg font-bold ${color || 'text-white'}`}>{value}</p>
    <p className="text-xs text-gray-500">{label}</p>
  </div>
);

export default BwtsStatusBar;
