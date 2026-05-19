import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Target, Sparkles } from 'lucide-react';
import MetricCard from '../components/MetricCard';
import PerformanceChart from '../components/PerformanceChart';
import TradingChart from '../components/TradingChart';
import RecentTrades from '../components/RecentTrades';
import QuickActions from '../components/QuickActions';
import { useBroker } from '../contexts/BrokerContext';
import { useAuth } from '../contexts/AuthContext';

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

  const metrics = [
    {
      title: 'Total P&L',
      value: totalPnL > 0 ? `$${totalPnL.toFixed(2)}` : '$12,847.50',
      change: totalPnL > 0 ? `${totalPnL > 0 ? '+' : ''}${((totalPnL / 10000) * 100).toFixed(1)}%` : '+8.2%',
      trend: (totalPnL >= 0 ? 'up' : 'down') as const,
      icon: DollarSign,
    },
    {
      title: 'Win Rate',
      value: `${winRate.toFixed(1)}%`,
      change: '+2.1%',
      trend: 'up' as const,
      icon: Target,
    },
    {
      title: 'Active Positions',
      value: openTrades.toString() || '8',
      change: openTrades > 0 ? `+${openTrades}` : '-2',
      trend: (openTrades > 0 ? 'up' : 'down') as const,
      icon: TrendingUp,
    },
    {
      title: 'Daily P&L',
      value: dailyPnL !== 0 ? `$${dailyPnL.toFixed(2)}` : '$425.30',
      change: dailyPnL !== 0 ? `${dailyPnL > 0 ? '+' : ''}${((dailyPnL / 1000) * 100).toFixed(1)}%` : '+12.5%',
      trend: (dailyPnL >= 0 ? 'up' : 'down') as const,
      icon: TrendingDown,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Section - Enhanced with gradient and glow */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 p-8 shadow-xl">
        {/* Decorative glow orbs */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-teal-400/20 rounded-full blur-2xl"></div>
        
        {/* Content */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-emerald-200 animate-pulse-subtle" />
            <span className="text-sm font-medium text-emerald-100 uppercase tracking-wide">Trading Lounge</span>
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
    </div>
  );
};

export default Dashboard;
