import React from 'react';
import { DivideIcon as LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  change: string;
  trend: 'up' | 'down';
  icon: LucideIcon;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, change, trend, icon: Icon }) => {
  const isUp = trend === 'up';
  
  return (
    <div className="dashboard-card p-5 card-hover group">
      <div className="flex items-center justify-between mb-4">
        <div className={`relative p-3.5 rounded-xl transition-all duration-200 ${
          isUp 
            ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20 group-hover:from-emerald-500/30 group-hover:to-teal-500/30' 
            : 'bg-gradient-to-br from-red-500/20 to-orange-500/20 group-hover:from-red-500/30 group-hover:to-orange-500/30'
        }`}>
          <Icon className={`w-6 h-6 ${
            isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`} />
          {/* Glow effect */}
          <div className={`absolute inset-0 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
            isUp ? 'bg-emerald-500/30' : 'bg-red-500/30'
          }`} />
        </div>
        <span className={`text-sm font-semibold px-3 py-1.5 rounded-full transition-all duration-200 ${
          isUp 
            ? 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40'
            : 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40'
        } group-hover:shadow-sm`}>
          {change}
        </span>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1 metric-value">
        {value}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
        {title}
      </p>
      
      {/* Subtle gradient line at bottom */}
      <div className={`absolute bottom-0 left-4 right-4 h-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
        isUp ? 'bg-gradient-to-r from-transparent via-emerald-500 to-transparent' : 'bg-gradient-to-r from-transparent via-red-500 to-transparent'
      }`} />
    </div>
  );
};

export default MetricCard;
