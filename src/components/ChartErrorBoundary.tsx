/**
 * Chart-specific Error Boundary
 * 
 * Catches errors in the chart component tree and provides
 * recovery options without crashing the entire application.
 */
import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ChartErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    
    // Log to console for debugging
    console.error('[ChartErrorBoundary] Chart error:', error);
    console.error('[ChartErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  private handleGoBack = () => {
    window.history.back();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-gray-900/50 rounded-xl border border-gray-700/50 p-8">
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
              {this.state.error?.message || 'An unexpected error occurred while loading the chart.'}
            </p>
            
            {/* Error Details (in development) */}
            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="w-full mb-6 text-left">
                <summary className="text-gray-500 text-xs cursor-pointer hover:text-gray-400">
                  Error Details
                </summary>
                <pre className="mt-2 p-3 bg-gray-800 rounded text-xs text-gray-300 overflow-auto max-h-40">
                  {this.state.error?.stack}
                  {'\n\n'}
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
            
            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={this.handleGoBack}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Go Back
              </button>
              
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap components with ChartErrorBoundary
 */
export function withChartErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WrappedComponent(props: P) {
    return (
      <ChartErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ChartErrorBoundary>
    );
  };
}
