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
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow duration-200">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${
          trend === 'up' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'
        }`}>
          <Icon className={`w-6 h-6 ${
            trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`} />
        </div>
        <span className={`text-sm font-medium px-2 py-1 rounded-full ${
          trend === 'up' 
            ? 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/30'
            : 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30'
        }`}>
          {change}
        </span>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        {value}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {title}
      </p>
    </div>
  );
};

export default MetricCard;