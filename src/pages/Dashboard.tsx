import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Target, Sparkles, LucideIcon, Wallet, Activity } from 'lucide-react';
import MetricCard from '../components/MetricCard';
import PerformanceChart from '../components/PerformanceChart';
import TradingChart from '../components/TradingChart';
import RecentTrades from '../components/RecentTrades';
import QuickActions from '../components/QuickActions';
import BwtsStatusBar from '../components/BwtsStatusBar';
import { useBroker } from '../contexts/BrokerContext';
import { useAuth } from '../contexts/AuthContext';

interface MetricData {
  title: string;
  value: string;
  change: string;
  trend: 'up' | 'down';
  icon: LucideIcon;
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { accounts, trades } = useBroker();
  
  // Calculate metrics from real broker data if available
  const totalPnL = trades.reduce((sum, trade) => sum + trade.profit, 0);
  const openTrades = trades.filter(trade => trade.status === 'open').length;
  const closedTrades = trades.filter(trade => trade.status === 'closed');
  const winRate = closedTrades.length > 0 
    ? (closedTrades.filter(trade => trade.profit > 0).length / closedTrades.length) * 100 
    : 73.5;
  const dailyPnL = trades
    .filter(trade => {
      const today = new Date();
      const tradeDate = new Date(trade.openTime);
      return tradeDate.toDateString() === today.toDateString();
    })
    .reduce((sum, trade) => sum + trade.profit, 0);

  const metrics: MetricData[] = [
    {
      title: 'Total P&L',
      value: accounts.length > 0 && totalPnL !== 0 ? `$${totalPnL.toFixed(2)}` : '$0.00',
      change: accounts.length > 0 && totalPnL !== 0 ? `${totalPnL > 0 ? '+' : ''}${((totalPnL / Math.abs(totalPnL)) * 100).toFixed(1)}%` : '0.0%',
      trend: (totalPnL >= 0 ? 'up' : 'down') as 'up' | 'down',
      icon: DollarSign,
    },
    {
      title: 'Win Rate',
      value: `${winRate.toFixed(1)}%`,
      change: closedTrades.length > 0 ? '+0.0%' : '0.0%',
      trend: 'up' as const,
      icon: Target,
    },
    {
      title: 'Active Positions',
      value: openTrades.toString(),
      change: openTrades > 0 ? `+${openTrades}` : '0',
      trend: (openTrades > 0 ? 'up' : 'down') as 'up' | 'down',
      icon: TrendingUp,
    },
    {
      title: 'Daily P&L',
      value: accounts.length > 0 && dailyPnL !== 0 ? `$${dailyPnL.toFixed(2)}` : '$0.00',
      change: accounts.length > 0 && dailyPnL !== 0 ? `${dailyPnL > 0 ? '+' : ''}${((dailyPnL / Math.abs(dailyPnL)) * 100).toFixed(1)}%` : '0.0%',
      trend: (dailyPnL >= 0 ? 'up' : 'down') as 'up' | 'down',
      icon: TrendingDown,
    },
  ];

  const formatCurrency = (value: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <div className="space-y-6">
      {/* Welcome Section - Enhanced with gradient and glow */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 via-violet-600 to-fuchsia-600 p-8 shadow-xl shadow-violet-950/30">
        {/* Decorative glow orbs */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-teal-400/20 rounded-full blur-2xl"></div>
        
        {/* Content */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-emerald-200 animate-pulse-subtle" />
            <span className="text-sm font-semibold text-cyan-100 uppercase tracking-[0.18em]">ConfluenceX · Market Intelligence</span>
          </div>
          <h1 className="text-3xl font-bold mb-2 text-white drop-shadow-sm">
            Good morning, {user?.name || 'Trader'}!
          </h1>
          {accounts.length > 0 ? (
            <p className="text-emerald-100/90 text-lg">
              Connected to {accounts.length} broker account{accounts.length !== 1 ? 's' : ''}. 
              {totalPnL > 0 && ` You're up $${totalPnL.toFixed(2)} today!`}
            </p>
          ) : (
            <p className="text-emerald-100/90 text-lg">
              Welcome to your professional trading dashboard. Connect your brokers to get started!
            </p>
          )}
        </div>
      </div>

      {/* BWTS Scanner status — live data from the Python API */}
      <BwtsStatusBar />

      {/* Metrics Grid - Enhanced cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {metrics.map((metric, index) => (
          <MetricCard key={index} {...metric} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Chart */}
        <div className="lg:col-span-2 dashboard-card p-5 card-hover">
          <PerformanceChart />
        </div>

        {/* Quick Actions */}
        <div className="dashboard-card p-5 card-hover">
          <QuickActions />
        </div>
      </div>

      {/* Additional Charts - Enhanced with glass effect */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="dashboard-card p-5 card-hover overflow-hidden">
          <TradingChart 
            symbol="GBPUSD" 
            timeframe="4H" 
            height={350}
            showVolume={false}
            chartType="line"
          />
        </div>
        <div className="dashboard-card p-5 card-hover overflow-hidden">
          <TradingChart 
            symbol="XAUUSD" 
            timeframe="1D" 
            height={350}
            showVolume={true}
            chartType="area"
          />
        </div>
      </div>

      {/* Recent Trades */}
      <div className="dashboard-card p-5 card-hover">
        <RecentTrades />
      </div>

      {/* TradeLocker account overview */}
      <div className="dashboard-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">TradeLocker Accounts</h2>
          <Wallet className="w-5 h-5 text-emerald-500" />
        </div>

        {accounts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Connect and sync your TradeLocker account to view balances, equity, and open positions here.
          </p>
        ) : (
          <div className="space-y-4">
            {accounts.map((account) => {
              const accountOpenPositions = trades.filter(
                (trade) => trade.status === 'open' && trade.id.startsWith(`trade_${account.id.replace('account_', '')}_`)
              );
              const accountPositionPnL = accountOpenPositions.reduce((sum, trade) => sum + trade.profit, 0);

              return (
                <div
                  key={account.id}
                  className="rounded-xl border border-gray-200/80 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">{account.brokerName}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        #{account.accountNumber} • {account.accountType.toUpperCase()} • {account.isConnected ? 'Connected' : 'Disconnected'}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      <Activity className="w-3.5 h-3.5" />
                      {accountOpenPositions.length} Open Position{accountOpenPositions.length !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Balance</p>
                      <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(account.balance, account.currency)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Equity</p>
                      <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(account.equity, account.currency)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Margin Used</p>
                      <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(account.margin, account.currency)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Free Margin</p>
                      <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(account.freeMargin, account.currency)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Open P&L</p>
                      <p className={`font-semibold ${accountPositionPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatCurrency(accountPositionPnL, account.currency)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
