import React, { useEffect, useState } from 'react';
import { bwtsApi, type BwtsHealth } from '../services/bwtsApi';

export const AdminDiagnostics: React.FC = () => {
  const [systemHealth, setSystemHealth] = useState<BwtsHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadDiagnostics = async () => {
    try {
      setLoading(true);
      const health = await bwtsApi.health();
      setSystemHealth(health);
      setLastRefreshed(new Date());
      setError(null);
    } catch {
      setError('Failed to load diagnostics — scanner API unreachable');
    } finally {
      setLoading(false);
    }
  };

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  };

  const statusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'ok':
      case 'live':
      case 'configured':
        return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30';
      case 'degraded':
      case 'stale':
        return 'text-amber-300 bg-amber-400/10 border-amber-400/30';
      case 'error':
      case 'unavailable':
      case 'unconfigured':
        return 'text-rose-300 bg-rose-400/10 border-rose-400/30';
      default:
        return 'text-slate-300 bg-slate-400/10 border-slate-400/30';
    }
  };

  if (loading && !systemHealth) {
    return <div className="animate-pulse p-6">Loading diagnostics...</div>;
  }

  if (error && !systemHealth) {
    return <div className="p-6 text-rose-300">{error}</div>;
  }

  const ready = systemHealth?.ready !== false;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Admin Diagnostics</h1>
          {lastRefreshed && (
            <p className="mt-1 text-xs text-slate-500">
              Last refreshed {lastRefreshed.toLocaleTimeString()} · auto-refreshes every 30s
            </p>
          )}
        </div>
        <button
          onClick={loadDiagnostics}
          className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-300 hover:bg-cyan-400/20"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">
          {error} — showing last known state
        </div>
      )}

      {/* System Health */}
      <section className="rounded-2xl border border-white/10 bg-[#090d18] p-6">
        <h2 className="mb-4 text-lg font-bold">System Health</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-slate-500">Status</div>
            <div className={`mt-1 text-2xl font-black ${ready ? 'text-emerald-300' : 'text-amber-300'}`}>
              {ready ? 'READY' : 'DEGRADED'}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-slate-500">Uptime</div>
            <div className="mt-1 text-2xl font-black text-white">
              {systemHealth?.uptime_seconds != null ? formatUptime(systemHealth.uptime_seconds) : '-'}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-slate-500">Signals in DB</div>
            <div className="mt-1 text-2xl font-black text-white">
              {systemHealth?.db_signals?.toLocaleString() || '0'}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-slate-500">Cache Entries</div>
            <div className="mt-1 text-2xl font-black text-white">
              {systemHealth?.cache?.entries ?? 0}
            </div>
          </div>
        </div>

        {/* Dependencies / data providers */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-bold text-slate-400">Data Providers &amp; Dependencies</h3>
          <div className="flex flex-wrap gap-2">
            {systemHealth?.dependencies && Object.entries(systemHealth.dependencies).map(([key, value]) => (
              <span
                key={key}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${statusColor(String(value))}`}
              >
                {key}: {String(value)}
              </span>
            ))}
            {!systemHealth?.dependencies && (
              <span className="text-sm text-slate-500">No dependency data available</span>
            )}
          </div>
        </div>

        {/* Engine Config */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-bold text-slate-400">Engine Configuration</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-slate-400">Min Score: <span className="text-white">{systemHealth?.engine?.minimum_score ?? '-'}</span></div>
            <div className="text-slate-400">Min R:R: <span className="text-white">{systemHealth?.engine?.minimum_rr ?? '-'}</span></div>
            <div className="text-slate-400">Actionable Status: <span className="text-white">{systemHealth?.engine?.actionable_status ?? '-'}</span></div>
            <div className="text-slate-400">Analysis TTL: <span className="text-white">{systemHealth?.cache?.analysis_ttl_seconds ?? '-'}s</span></div>
          </div>
        </div>
      </section>

      {/* Tracked Pairs */}
      <section className="rounded-2xl border border-white/10 bg-[#090d18] p-6">
        <h2 className="mb-4 text-lg font-bold">Tracked Markets</h2>
        <div className="flex flex-wrap gap-2">
          {(systemHealth?.pairs ?? []).map((pair) => (
            <span
              key={pair}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm font-medium text-cyan-300"
            >
              {pair}
            </span>
          ))}
          {(systemHealth?.pairs ?? []).length === 0 && (
            <span className="text-sm text-slate-500">No tracked pairs reported</span>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminDiagnostics;
