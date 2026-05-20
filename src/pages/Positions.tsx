// Positions — currently open trades from the execution worker.

import React, { useEffect, useState } from 'react';
import { Briefcase, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { bwtsApi, type BwtsPosition } from '../services/bwtsApi';

const Positions: React.FC = () => {
  const [positions, setPositions] = useState<BwtsPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const { positions } = await bwtsApi.positions();
      setPositions(positions);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Briefcase className="w-8 h-8 text-emerald-400" />
            Positions
          </h1>
          <p className="text-gray-400 mt-1">Currently open trades from the execution worker.</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {!error && positions.length === 0 && !loading && (
        <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-8 text-center">
          <Briefcase className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No open positions.</p>
          <p className="text-gray-500 text-sm mt-1">
            The execution worker opens trades on STRONG signals (paper or live mode).
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {positions.map((p) => (
          <PositionCard key={p.id} pos={p} />
        ))}
      </div>
    </div>
  );
};

const PositionCard: React.FC<{ pos: BwtsPosition }> = ({ pos }) => {
  const Icon = pos.direction === 'BUY' ? TrendingUp : TrendingDown;
  const directionColor = pos.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400';
  const opened = new Date(pos.opened_at * 1000);

  return (
    <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">{pos.pair}</h3>
        <span className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 bg-gray-800">
          {pos.status}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-4 h-4 ${directionColor}`} />
        <span className={`text-sm font-medium ${directionColor}`}>{pos.direction}</span>
        <span className="ml-auto text-sm text-gray-300">{pos.lot_size.toFixed(2)} lots</span>
      </div>
      <div className="space-y-1.5 text-xs">
        <Row label="Entry" value={pos.entry.toFixed(5)} />
        <Row label="SL"    value={pos.stop_loss.toFixed(5)} />
        <Row label="TP1"   value={pos.tp1.toFixed(5)} />
        <Row label="TP2"   value={pos.tp2.toFixed(5)} />
        <Row label="TP3"   value={pos.tp3.toFixed(5)} />
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Opened {opened.toLocaleString()}
      </p>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between">
    <span className="text-gray-500">{label}</span>
    <span className="text-gray-200 font-mono">{value}</span>
  </div>
);

export default Positions;
