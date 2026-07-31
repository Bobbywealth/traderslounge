import React, { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Download, ChevronDown, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { useBroker } from '../contexts/BrokerContext';
import { bwtsApi, type BwtsClosedTrade, type BwtsPosition } from '../services/bwtsApi';
import LoadingSpinner from '../components/LoadingSpinner';

interface TradeRow {
  id: string;
  symbol: string;
  type: 'Buy' | 'Sell';
  size: number;
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number;
  rMultiple: number | null;
  status: 'Open' | 'Closed';
  openTime: Date;
  closeTime: Date | null;
  source: string;
}

const closedTradeToRow = (t: BwtsClosedTrade): TradeRow => ({
  id: `bwts_closed_${t.id}`,
  symbol: t.pair,
  type: t.direction === 'SELL' ? 'Sell' : 'Buy',
  size: t.lot_size,
  entry: t.entry,
  exit: t.exit_price,
  stopLoss: t.stop_loss,
  takeProfit: t.tp1,
  pnl: t.pnl_usd,
  rMultiple: t.r_multiple,
  status: 'Closed',
  openTime: new Date(t.opened_at * 1000),
  closeTime: new Date(t.closed_at * 1000),
  source: 'Scanner',
});

const positionToRow = (p: BwtsPosition): TradeRow => ({
  id: `bwts_pos_${p.id}`,
  symbol: p.pair,
  type: p.direction === 'SELL' ? 'Sell' : 'Buy',
  size: p.lot_size,
  entry: p.entry,
  exit: null,
  stopLoss: p.stop_loss,
  takeProfit: p.tp1,
  pnl: p.closed_pnl_usd,
  rMultiple: null,
  status: 'Open',
  openTime: new Date(p.opened_at * 1000),
  closeTime: p.closed_at ? new Date(p.closed_at * 1000) : null,
  source: 'Scanner',
});

const TradingTable: React.FC = () => {
  const { trades: brokerTrades } = useBroker();
  const [closedTrades, setClosedTrades] = useState<BwtsClosedTrade[]>([]);
  const [openPositions, setOpenPositions] = useState<BwtsPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Open' | 'Closed'>('All');
  const [sortField, setSortField] = useState<'openTime' | 'symbol' | 'pnl'>('openTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const loadTrades = async () => {
    setIsLoading(true);
    try {
      const [journal, positions] = await Promise.all([
        bwtsApi.journal({ limit: 200 }),
        bwtsApi.positions().catch(() => ({ positions: [] as BwtsPosition[], count: 0 })),
      ]);
      setClosedTrades(journal.trades);
      setOpenPositions(positions.positions);
      setLoadError(null);
    } catch {
      setLoadError('Could not reach the trade journal API — showing broker trades only.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTrades();
  }, []);

  const allTrades = useMemo<TradeRow[]>(() => {
    const brokerRows: TradeRow[] = brokerTrades.map((trade) => ({
      id: trade.id,
      symbol: trade.symbol,
      type: trade.type === 'buy' ? 'Buy' : 'Sell',
      size: trade.volume,
      entry: trade.openPrice,
      exit: trade.closePrice ?? null,
      stopLoss: trade.stopLoss ?? null,
      takeProfit: trade.takeProfit ?? null,
      pnl: trade.profit,
      rMultiple: null,
      status: trade.status === 'open' ? 'Open' : 'Closed',
      openTime: trade.openTime,
      closeTime: trade.closeTime ?? null,
      source: 'Broker',
    }));
    return [
      ...openPositions.map(positionToRow),
      ...closedTrades.map(closedTradeToRow),
      ...brokerRows,
    ];
  }, [brokerTrades, closedTrades, openPositions]);

  const visibleTrades = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = allTrades.filter((trade) => {
      if (statusFilter !== 'All' && trade.status !== statusFilter) return false;
      if (term && !trade.symbol.toLowerCase().includes(term) && !trade.id.toLowerCase().includes(term)) return false;
      return true;
    });
    const dir = sortDirection === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortField === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      if (sortField === 'pnl') return (a.pnl - b.pnl) * dir;
      return (a.openTime.getTime() - b.openTime.getTime()) * dir;
    });
  }, [allTrades, searchTerm, statusFilter, sortField, sortDirection]);

  const handleSort = (field: 'openTime' | 'symbol' | 'pnl') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'symbol' ? 'asc' : 'desc');
    }
  };

  const exportCsv = () => {
    const header = ['Trade ID', 'Symbol', 'Type', 'Size', 'Entry', 'Exit', 'Stop Loss', 'Take Profit', 'P&L (USD)', 'R Multiple', 'Status', 'Open Time', 'Close Time', 'Source'];
    const rows = visibleTrades.map((t) => [
      t.id, t.symbol, t.type, t.size, t.entry, t.exit ?? '', t.stopLoss ?? '', t.takeProfit ?? '',
      t.pnl.toFixed(2), t.rMultiple != null ? t.rMultiple.toFixed(2) : '', t.status,
      t.openTime.toISOString(), t.closeTime ? t.closeTime.toISOString() : '', t.source,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trade-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading && allTrades.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trade History</h1>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <LoadingSpinner size="lg" text="Loading trade history..." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trade History</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={loadTrades}
            className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
            title="Refresh trades"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={exportCsv}
            disabled={visibleTrades.length === 0}
            className="flex items-center space-x-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-300">
          {loadError}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 md:space-x-4">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search trades..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'All' | 'Open' | 'Closed')}
                className="appearance-none pl-4 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                <option value="All">All Status</option>
                <option value="Open">Open</option>
                <option value="Closed">Closed</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {visibleTrades.length} of {allTrades.length} trades
            </span>
          </div>
        </div>
      </div>

      {/* Trading Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSort('symbol')}
                >
                  Symbol
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Size
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Entry
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Exit
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSort('pnl')}
                >
                  P&L
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  R
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSort('openTime')}
                >
                  Open Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Source
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {visibleTrades.map((trade) => (
                <tr key={trade.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {trade.symbol}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {trade.type === 'Buy' ? (
                        <TrendingUp className="w-4 h-4 text-emerald-500 mr-2" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-500 mr-2" />
                      )}
                      <span className={`text-sm font-medium ${
                        trade.type === 'Buy' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {trade.type}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {trade.size}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {trade.entry}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {trade.exit ?? '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${
                      trade.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {trade.rMultiple != null ? `${trade.rMultiple.toFixed(2)}R` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      trade.status === 'Open'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
                    }`}>
                      {trade.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {trade.openTime.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {trade.source}
                  </td>
                </tr>
              ))}
              {visibleTrades.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    No trades yet — closed trades from the scanner and your connected broker will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TradingTable;
