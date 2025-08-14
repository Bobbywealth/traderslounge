import React from 'react';
import { TrendingUp } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', text = 'Loading...' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <div className={`${sizeClasses[size]} text-emerald-500 animate-spin mb-4`}>
        <TrendingUp className="w-full h-full" />
      </div>
      <p className="text-gray-600 dark:text-gray-400 text-sm">{text}</p>
    </div>
  );
};

export default LoadingSpinner;