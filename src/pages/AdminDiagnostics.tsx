import React, { useEffect, useState } from 'react';
import { bwtsApi } from '../services/bwtsApi';

interface SystemHealth {
  status: string;
  uptime_seconds: number;
  db_signals: number;
  pairs: string[];
  dependencies: Record<string, string>;
  cache: { entries: number; analysis_ttl_seconds: number };
  engine: Record<string, unknown>;
}

interface ProviderHealth {
  provider: string;
  status: string;
  is_realtime: boolean;
  last_successful_candle: string | null;
  cache_age_seconds: number;
  available_timeframes: string[];
  missing_timeframes: string[];
  rate_limit_remaining: number | null;
  rate_limit_resets_at: string | null;
  last_error: string | null;
  avg_latency_ms: number;
  success_rate: number;
}

interface WorkerStatus {
  status: string;
  last_scan: string | null;
  next_scan: string | null;
  signals_scanned: number;
  errors: string[];
}

interface AlertDelivery {
  status: string;
  delivered_today: number;
  failed_today: number;
  queue_depth: number;
}

export const AdminDiagnostics: React.FC = () => {
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealth>>({});
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [alertDelivery, setAlertDelivery] = useState<AlertDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadDiagnostics = async () => {
    try {
      setLoading(true);
      const [health, providers, workers, alerts] = await Promise.all([
        bwtsApi.health(),
        bwtsApi.providerHealth().catch(() => ({})),
        bwtsApi.workerStatus().catch(() => null),
        bwtsApi.alertDeliveryStatus().catch(() => null),
      ]);
      setSystemHealth(health);
      setProviderHealth(providers);
      setWorkerStatus(workers);
      setAlertDelivery(alerts);
      setError(null);
    } catch (err) {
      setError('Failed to load diagnostics');
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
    switch (status) {
      case 'ok': return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30';
      case 'degraded': return 'text-amber-300 bg-amber-400/10 border-amber-400/30';
      case 'error': return 'text-rose-300 bg-rose-400/10 border-rose-400/30';
      default: return 'text-slate-300 bg-slate-400/10 border-slate-400/30';
    }
  };

  if (loading && !systemHealth) {
    return <div className="animate-pulse p-6">Loading diagnostics...</div>;
  }

  if (error && !systemHealth) {
    return <div className="p-6 text-rose-300">{error}</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Admin Diagnostics</h1>
        <button
          onClick={loadDiagnostics}
          className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-300 hover:bg-cyan-400/20"
        >
          Refresh
        </button>
      </div>

      {/* System Health */}
      <section className="rounded-2xl border border-white/10 bg-[#090d18] p-6">
        <h2 className="mb-4 text-lg font-bold">System Health</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-slate-500">Status</div>
            <div className={`mt-1 text-2xl font-black ${systemHealth?.status === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {systemHealth?.status?.toUpperCase() || 'UNKNOWN'}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-slate-500">Uptime</div>
            <div className="mt-1 text-2xl font-black text-white">
              {systemHealth ? formatUptime(systemHealth.uptime_seconds) : '-'}
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
              {systemHealth?.cache?.entries || 0}
            </div>
          </div>
        </div>

        {/* Dependencies */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-bold text-slate-400">Dependencies</h3>
          <div className="flex flex-wrap gap-2">
            {systemHealth?.dependencies && Object.entries(systemHealth.dependencies).map(([key, value]) => (
              <span
                key={key}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${statusColor(value)}`}
              >
                {key}: {value}
              </span>
            ))}
          </div>
        </div>

        {/* Engine Config */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-bold text-slate-400">Engine Configuration</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-slate-400">Min Score: <span className="text-white">{systemHealth?.engine?.minimum_score}</span></div>
            <div className="text-slate-400">Min R:R: <span className="text-white">{systemHealth?.engine?.minimum_rr}</span></div>
            <div className="text-slate-400">Actionable Status: <span className="text-white">{systemHealth?.engine?.actionable_status}</span></div>
            <div className="text-slate-400">Analysis TTL: <span className="text-white">{systemHealth?.cache?.analysis_ttl_seconds}s</span></div>
          </div>
        </div>
      </section>

      {/* Provider Health */}
      <section className="rounded-2xl border border-white/10 bg-[#090d18] p-6">
        <h2 className="mb-4 text-lg font-bold">Market Data Providers</h2>
        {Object.keys(providerHealth).length === 0 ? (
          <div className="text-slate-500">No provider health data available</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(providerHealth).map(([name, health]) => (
              <div key={name} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-white">{name}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusColor(health.status)}`}>
                      {health.status?.toUpperCase()}
                    </span>
                    {health.is_realtime && (
                      <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">REAL-TIME</span>
                    )}
                  </div>
                  <div className="text-right text-sm text-slate-400">
                    <div>Latency: {health.avg_latency_ms?.toFixed(0)}ms</div>
                    <div>Success: {(health.success_rate * 100).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-slate-400">
                    Available: {health.available_timeframes?.join(', ') || 'none'}
                  </div>
                  <div className="text-slate-400">
                    Missing: {health.missing_timeframes?.join(', ') || 'none'}
                  </div>
                  {health.rate_limit_remaining !== null && (
                    <div className="text-slate-400">
                      Rate Limit: {health.rate_limit_remaining} remaining
                    </div>
                  )}
                  {health.last_error && (
                    <div className="col-span-2 text-rose-400">
                      Last Error: {health.last_error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Worker Status */}
      <section className="rounded-2xl border border-white/10 bg-[#090d18] p-6">
        <h2 className="mb-4 text-lg font-bold">Scanner Worker</h2>
        {workerStatus ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm text-slate-500">Status</div>
              <div className={`mt-1 text-xl font-black ${workerStatus.status === 'running' ? 'text-emerald-300' : 'text-amber-300'}`}>
                {workerStatus.status?.toUpperCase()}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm text-slate-500">Signals Scanned</div>
              <div className="mt-1 text-xl font-black text-white">
                {workerStatus.signals_scanned?.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm text-slate-500">Last Scan</div>
              <div className="mt-1 text-sm text-white">
                {workerStatus.last_scan ? new Date(workerStatus.last_scan).toLocaleString() : 'Never'}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm text-slate-500">Next Scan</div>
              <div className="mt-1 text-sm text-white">
                {workerStatus.next_scan ? new Date(workerStatus.next_scan).toLocaleString() : 'Soon'}
              </div>
            </div>
            {workerStatus.errors && workerStatus.errors.length > 0 && (
              <div className="col-span-2 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4">
                <div className="text-sm font-bold text-rose-300">Errors</div>
                <div className="mt-1 space-y-1 text-sm text-rose-200">
                  {workerStatus.errors.map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-slate-500">Worker status not available</div>
        )}
      </section>

      {/* Alert Delivery */}
      <section className="rounded-2xl border border-white/10 bg-[#090d18] p-6">
        <h2 className="mb-4 text-lg font-bold">Alert Delivery</h2>
        {alertDelivery ? (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm text-slate-500">Status</div>
              <div className={`mt-1 text-xl font-black ${alertDelivery.status === 'ok' ? 'text-emerald-300' : 'text-amber-300'}`}>
                {alertDelivery.status?.toUpperCase()}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm text-slate-500">Delivered Today</div>
              <div className="mt-1 text-xl font-black text-emerald-300">
                {alertDelivery.delivered_today}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm text-slate-500">Failed Today</div>
              <div className="mt-1 text-xl font-black text-rose-300">
                {alertDelivery.failed_today}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-slate-500">Alert delivery not configured</div>
        )}
      </section>

      {/* Tracked Pairs */}
      <section className="rounded-2xl border border-white/10 bg-[#090d18] p-6">
        <h2 className="mb-4 text-lg font-bold">Tracked Markets</h2>
        <div className="flex flex-wrap gap-2">
          {systemHealth?.pairs?.map((pair) => (
            <span
              key={pair}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm font-medium text-cyan-300"
            >
              {pair}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
};

export default AdminDiagnostics;
