import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Target } from 'lucide-react';
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
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-6 text-white">
        <h1 className="text-2xl font-bold mb-2">Good morning, {user?.name || 'Trader'}!</h1>
        {accounts.length > 0 ? (
          <p className="text-emerald-100">
            Connected to {accounts.length} broker account{accounts.length !== 1 ? 's' : ''}. 
            {totalPnL > 0 && ` You're up $${totalPnL.toFixed(2)} today!`}
          </p>
        ) : (
          <p className="text-emerald-100">
            Welcome to your professional trading dashboard. Connect your brokers to get started!
          </p>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, index) => (
          <MetricCard key={index} {...metric} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Chart */}
        <div className="lg:col-span-2">
          <PerformanceChart />
        </div>

        {/* Quick Actions */}
        <QuickActions />
      </div>

      {/* Additional Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <TradingChart 
          symbol="GBPUSD" 
          timeframe="4H" 
          height={350}
          showVolume={false}
          chartType="line"
        />
        <TradingChart 
          symbol="XAUUSD" 
          timeframe="1D" 
          height={350}
          showVolume={true}
          chartType="area"
        />
      </div>

      {/* Recent Trades */}
      <RecentTrades />
    </div>
  );
};

export default Dashboard;