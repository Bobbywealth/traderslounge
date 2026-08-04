import React, { useEffect, useState } from 'react';
import { bwtsApi } from '../services/bwtsApi';

export interface PerformanceStats {
  source: 'backtested' | 'forward_tested' | 'paper_traded' | 'user_journal' | 'live_broker';
  sampleSize: number;
  dateRange: string;
  lastUpdated: string;
  winRate: number;
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  stopLossRate: number;
  breakEvenRate: number;
  expirationRate: number;
  avgR: number;
  medianR: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  mfe: number;
  mae: number;
  avgHoldingBars: number;
  avgTimeToTP1: number;
  avgTimeToStop: number;
}

interface FilterState {
  assetClass: string;
  symbol: string;
  direction: string;
  scoreBand: string;
  confidenceTier: string;
  dateFrom: string;
  dateTo: string;
}

const PerformancePage: React.FC = () => {
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    assetClass: 'all',
    symbol: 'all',
    direction: 'all',
    scoreBand: 'all',
    confidenceTier: 'all',
    dateFrom: '',
    dateTo: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [filters]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const data = await bwtsApi.getPerformanceStats(filters);
      setStats(data);
    } catch (error) {
      console.error('Failed to load performance stats', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse">Loading performance data...</div>;
  }

  if (!stats) {
    return <div>No performance data available.</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-black">Performance Center</h1>
        <p className="mt-2 cx-text-muted">
          Source: {stats.source.replace('_', ' ')} | Sample: {stats.sampleSize} | Period: {stats.dateRange}
        </p>
      </header>

      <div className="flex gap-2">
        {['forward_tested', 'paper_traded', 'user_journal', 'live_broker'].map(source => (
          <span key={source} className={`px-3 py-1 rounded-full text-xs ${
            stats.source === source 
              ? 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/30'
              : 'bg-slate-800 cx-text-faint border border-slate-700'
          }`}>
            {source.replace('_', ' ')}
          </span>
        ))}
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} />
        <StatCard label="Avg R" value={stats.avgR.toFixed(2)} />
        <StatCard label="Expectancy" value={`${stats.expectancy.toFixed(2)}R`} />
        <StatCard label="Profit Factor" value={stats.profitFactor.toFixed(2)} />
      </section>

      <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
        <h2 className="text-lg font-bold mb-4">Target Hit Rates</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-3xl font-black text-emerald-300">{stats.tp1HitRate.toFixed(0)}%</div>
            <div className="text-sm cx-text-faint">TP1</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-black text-emerald-300">{stats.tp2HitRate.toFixed(0)}%</div>
            <div className="text-sm cx-text-faint">TP2</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-black text-emerald-300">{stats.tp3HitRate.toFixed(0)}%</div>
            <div className="text-sm cx-text-faint">TP3</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-black text-rose-300">{stats.stopLossRate.toFixed(0)}%</div>
            <div className="text-sm cx-text-faint">Stop Loss</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
        <h2 className="text-lg font-bold mb-4">Advanced Metrics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Median R" value={`${stats.medianR.toFixed(2)}R`} />
          <StatCard label="Max Drawdown" value={`${stats.maxDrawdown.toFixed(1)}%`} />
          <StatCard label="Max Consecutive Losses" value={String(stats.maxConsecutiveLosses)} />
          <StatCard label="MFE" value={`${stats.mfe.toFixed(2)}R`} />
          <StatCard label="MAE" value={`${stats.mae.toFixed(2)}R`} />
          <StatCard label="Avg Holding Bars" value={stats.avgHoldingBars.toFixed(1)} />
          <StatCard label="Avg Time to TP1" value={`${stats.avgTimeToTP1.toFixed(1)} bars`} />
          <StatCard label="Avg Time to Stop" value={`${stats.avgTimeToStop.toFixed(1)} bars`} />
        </div>
      </section>

      <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
        <h2 className="text-lg font-bold mb-4">Filters</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <select 
            value={filters.assetClass} 
            onChange={(e) => setFilters({...filters, assetClass: e.target.value})}
            className="rounded-lg border cx-border-strong cx-bg-elev px-3 py-2"
          >
            <option value="all">All Asset Classes</option>
            <option value="forex">Forex</option>
            <option value="metals">Metals</option>
            <option value="cryptocurrency">Crypto</option>
          </select>
          <select 
            value={filters.direction} 
            onChange={(e) => setFilters({...filters, direction: e.target.value})}
            className="rounded-lg border cx-border-strong cx-bg-elev px-3 py-2"
          >
            <option value="all">All Directions</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
          <select 
            value={filters.scoreBand} 
            onChange={(e) => setFilters({...filters, scoreBand: e.target.value})}
            className="rounded-lg border cx-border-strong cx-bg-elev px-3 py-2"
          >
            <option value="all">All Scores</option>
            <option value="strong">Strong (70+)</option>
            <option value="good">Good (50-70)</option>
            <option value="watchlist">Watchlist (&lt;50)</option>
          </select>
          <select 
            value={filters.confidenceTier} 
            onChange={(e) => setFilters({...filters, confidenceTier: e.target.value})}
            className="rounded-lg border cx-border-strong cx-bg-elev px-3 py-2"
          >
            <option value="all">All Confidence</option>
            <option value="high">High</option>
            <option value="qualified">Qualified</option>
            <option value="developing">Developing</option>
          </select>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({...filters, dateFrom: e.target.value})}
            className="rounded-lg border cx-border-strong cx-bg-elev px-3 py-2"
            placeholder="From date"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({...filters, dateTo: e.target.value})}
            className="rounded-lg border cx-border-strong cx-bg-elev px-3 py-2"
            placeholder="To date"
          />
        </div>
      </section>

      <section className="rounded-2xl border cx-border-strong cx-bg-card p-6">
        <h2 className="text-lg font-bold mb-4">Outcome Breakdown</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-black text-emerald-300">{(100 - stats.stopLossRate - stats.breakEvenRate - stats.expirationRate).toFixed(0)}%</div>
            <div className="text-sm cx-text-faint">Wins</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-cyan-300">{stats.breakEvenRate.toFixed(0)}%</div>
            <div className="text-sm cx-text-faint">Break Even</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-amber-300">{stats.expirationRate.toFixed(0)}%</div>
            <div className="text-sm cx-text-faint">Expired</div>
          </div>
        </div>
      </section>

      <section className="text-xs cx-text-faint">
        <p>Past performance is not indicative of future results. This data represents {stats.source.replace('_', ' ')} results.</p>
        <p className="mt-1">Last updated: {stats.lastUpdated}</p>
      </section>
    </div>
  );
};

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border cx-border-strong cx-bg-card p-4">
    <div className="text-sm cx-text-faint">{label}</div>
    <div className="mt-1 text-2xl font-black cx-text-strong">{value}</div>
  </div>
);

export default PerformancePage;
