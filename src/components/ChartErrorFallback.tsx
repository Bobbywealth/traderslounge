/**
 * Chart Error Fallback Component
 * 
 * Displays when the chart fails to load and provides recovery options.
 */
import React from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

interface ChartErrorFallbackProps {
  error: string;
  onRetry: () => void;
  onGoBack?: () => void;
}

const ChartErrorFallback: React.FC<ChartErrorFallbackProps> = ({ 
  error, 
  onRetry, 
  onGoBack 
}) => {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-gray-900 rounded-xl border border-gray-700/50 p-8">
      <div className="flex flex-col items-center text-center max-w-md">
        {/* Error Icon */}
        <div className="w-16 h-16 mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        
        {/* Error Title */}
        <h3 className="text-xl font-semibold text-white mb-2">
          Chart Failed to Load
        </h3>
        
        {/* Error Message */}
        <p className="text-gray-400 text-sm mb-6">
          {error || 'An unexpected error occurred while loading the chart.'}
        </p>
        
        {/* Action Buttons */}
        <div className="flex gap-3">
          {onGoBack && (
            <button
              onClick={onGoBack}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </button>
          )}
          
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChartErrorFallback;
