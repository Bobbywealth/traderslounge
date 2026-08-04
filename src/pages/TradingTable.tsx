import React, { useState } from 'react';
import { Search, Filter, Download, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import { useBroker } from '../contexts/BrokerContext';

const TradingTable: React.FC = () => {
  const { trades: brokerTrades } = useBroker();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Real broker trades only. This list previously spliced in three invented
  // trades (EURUSD/GBPJPY/XAUUSD with fixed 2024 timestamps) that rendered
  // identically to genuine fills — a user reading their own trade history had
  // no way to tell which rows were real.
  const allTrades = brokerTrades.map(trade => ({
    id: trade.id,
    symbol: trade.symbol,
    type: trade.type === 'buy' ? 'Buy' : 'Sell',
    size: trade.volume,
    entry: trade.openPrice,
    exit: trade.closePrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    pnl: trade.profit,
    status: trade.status === 'open' ? 'Open' : 'Closed',
    openTime: trade.openTime.toLocaleString(),
    closeTime: trade.closeTime?.toLocaleString() || null,
    commission: trade.commission,
    swap: trade.swap,
  }));

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold cx-text-strong dark:cx-text-strong">Trade History</h1>
        <button className="flex items-center space-x-2 px-4 py-2 bg-emerald-500 cx-text-strong rounded-lg hover:bg-emerald-600 transition-colors duration-200">
          <Download className="w-4 h-4" />
          <span>Export</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 md:space-x-4">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 cx-text-faint" />
              <input
                type="text"
                placeholder="Search trades..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cx-text-strong dark:cx-text-strong focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
            
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none pl-4 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cx-text-strong dark:cx-text-strong focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                <option>All Status</option>
                <option>Open</option>
                <option>Closed</option>
                <option>Pending</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 cx-text-faint" />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 cx-text-faint" />
            <span className="text-sm text-gray-600 dark:cx-text-faint">
              {allTrades.length} trades
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
                  className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSort('id')}
                >
                  Trade ID
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSort('symbol')}
                >
                  Symbol
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider">
                  Size
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider">
                  Entry
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider">
                  Exit
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSort('pnl')}
                >
                  P&L
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium cx-text-faint dark:cx-text-faint uppercase tracking-wider">
                  Open Time
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {allTrades.map((trade) => (
                <tr key={trade.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium cx-text-strong dark:cx-text-strong">
                    {trade.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium cx-text-strong dark:cx-text-strong">
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
                  <td className="px-6 py-4 whitespace-nowrap text-sm cx-text-faint dark:cx-text-faint">
                    {trade.size}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm cx-text-strong dark:cx-text-strong">
                    {trade.entry}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm cx-text-strong dark:cx-text-strong">
                    {trade.exit || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${
                      trade.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      trade.status === 'Open'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'bg-gray-100 cx-text dark:bg-gray-900/30 dark:text-gray-300'
                    }`}>
                      {trade.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm cx-text-faint dark:cx-text-faint">
                    {trade.openTime}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TradingTable;