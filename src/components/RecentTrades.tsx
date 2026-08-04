import React from 'react';
import { TrendingUp, TrendingDown, Link2 } from 'lucide-react';
import { useBroker } from '../contexts/BrokerContext';

const RecentTrades: React.FC = () => {
  const { trades } = useBroker();

  if (trades.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold cx-text-strong dark:cx-text-strong">
            Recent Trades
          </h3>
        </div>
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <Link2 className="w-8 h-8 cx-text-faint" />
          </div>
          <h4 className="text-lg font-medium cx-text-strong dark:cx-text-strong mb-2">
            No Trades Yet
          </h4>
          <p className="cx-text-faint dark:cx-text-faint max-w-sm mx-auto">
            Connect your broker account to view your trading history and track your positions in real-time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold cx-text-strong dark:cx-text-strong">
          Recent Trades
        </h3>
        <button className="text-sm text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium">
          View All
        </button>
      </div>

      <div className="space-y-4">
        {trades.slice(0, 10).map((trade) => (
          <div
            key={trade.id}
            className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
          >
            <div className="flex items-center space-x-4">
              <div className={`p-2 rounded-lg ${
                trade.type === 'buy' 
                  ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                  : 'bg-red-100 dark:bg-red-900/30'
              }`}>
                {trade.type === 'buy' ? (
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                )}
              </div>
              <div>
                <div className="flex items-center space-x-3">
                  <span className="font-medium cx-text-strong dark:cx-text-strong">
                    {trade.symbol}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    trade.type === 'buy'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {trade.type.toUpperCase()}
                  </span>
                  <span className="text-xs cx-text-faint dark:cx-text-faint">
                    {trade.volume} lots
                  </span>
                </div>
                <div className="text-xs cx-text-faint dark:cx-text-faint mt-1">
                  Entry: {trade.openPrice?.toFixed(5) || 'N/A'} • {new Date(trade.openTime).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className={`text-sm font-medium ${
                trade.profit >= 0 
                  ? 'text-emerald-600 dark:text-emerald-400' 
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
              </div>
              <div className={`text-xs px-2 py-1 rounded-full mt-1 ${
                trade.status === 'open'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'bg-gray-100 cx-text-muted dark:bg-gray-900/30 dark:text-gray-300'
              }`}>
                {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentTrades;
