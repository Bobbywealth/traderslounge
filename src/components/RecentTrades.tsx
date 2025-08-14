import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

const RecentTrades: React.FC = () => {
  const trades = [
    {
      id: 1,
      symbol: 'EURUSD',
      type: 'Buy',
      size: '0.5',
      entry: 1.0892,
      current: 1.0915,
      pnl: 115.0,
      status: 'Open',
      time: '2 hours ago',
    },
    {
      id: 2,
      symbol: 'GBPJPY',
      type: 'Sell',
      size: '0.3',
      entry: 185.42,
      exit: 184.95,
      pnl: 141.0,
      status: 'Closed',
      time: '4 hours ago',
    },
    {
      id: 3,
      symbol: 'XAUUSD',
      type: 'Buy',
      size: '0.1',
      entry: 2045.50,
      current: 2038.20,
      pnl: -73.0,
      status: 'Open',
      time: '6 hours ago',
    },
    {
      id: 4,
      symbol: 'USDJPY',
      type: 'Buy',
      size: '0.8',
      entry: 149.85,
      exit: 150.24,
      pnl: 312.0,
      status: 'Closed',
      time: '1 day ago',
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Recent Trades
        </h3>
        <button className="text-sm text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium">
          View All
        </button>
      </div>

      <div className="space-y-4">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
          >
            <div className="flex items-center space-x-4">
              <div className={`p-2 rounded-lg ${
                trade.type === 'Buy' 
                  ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                  : 'bg-red-100 dark:bg-red-900/30'
              }`}>
                {trade.type === 'Buy' ? (
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                )}
              </div>
              <div>
                <div className="flex items-center space-x-3">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {trade.symbol}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    trade.type === 'Buy'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {trade.type}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {trade.size} lots
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Entry: {trade.entry} • {trade.time}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className={`text-sm font-medium ${
                trade.pnl >= 0 
                  ? 'text-emerald-600 dark:text-emerald-400' 
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
              </div>
              <div className={`text-xs px-2 py-1 rounded-full mt-1 ${
                trade.status === 'Open'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300'
              }`}>
                {trade.status}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentTrades;