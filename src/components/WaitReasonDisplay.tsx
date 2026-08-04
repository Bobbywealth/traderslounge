import React from 'react';
import { AlertCircle, Clock, AlertTriangle, Info } from 'lucide-react';
import { BlockingReason } from '../types/signals';

interface WaitReasonDisplayProps {
  reasons: BlockingReason[];
  compact?: boolean;
}

const severityConfig = {
  high: {
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
    icon: AlertCircle,
    badge: 'bg-red-500',
  },
  medium: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/40',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-200 dark:border-yellow-800',
    icon: AlertTriangle,
    badge: 'bg-yellow-500',
  },
  low: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-600 dark:cx-text-faint',
    border: 'border-gray-200 dark:border-gray-700',
    icon: Info,
    badge: 'bg-gray-500',
  },
};

function formatData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;

  if (data.blackout_ends) {
    const date = new Date(data.blackout_ends as string);
    return `Blackout ends: ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
  }

  if (data.remaining !== undefined) {
    return `Remaining: ${data.remaining}%`;
  }

  if (data.score !== undefined && data.minimum !== undefined) {
    return `Score ${data.score}/${data.minimum}`;
  }

  if (data.net_available_rr !== undefined && data.minimum_rr !== undefined) {
    return `${(data.net_available_rr as number).toFixed(2)}R available (min: ${data.minimum_rr}R)`;
  }

  return null;
}

const WaitReasonItem: React.FC<{ reason: BlockingReason; compact?: boolean }> = ({ reason, compact }) => {
  const config = severityConfig[reason.severity] || severityConfig.medium;
  const Icon = config.icon;
  const dataString = formatData(reason.data);

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full border ${config.bg} ${config.text} ${config.border}`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-xs font-medium">{reason.message}</span>
        {reason.blocksTrading && (
          <span className={`w-1.5 h-1.5 rounded-full ${config.badge}`} />
        )}
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-lg border ${config.bg} ${config.border}`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${config.badge}/20`}>
          <Icon className={`w-4 h-4 ${config.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`font-semibold text-sm ${config.text}`}>{reason.message}</span>
            {reason.blocksTrading && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Blocks Trading
              </span>
            )}
          </div>
          {dataString && (
            <p className={`text-xs ${config.text} opacity-75`}>{dataString}</p>
          )}
          <p className="text-xs font-mono cx-text-faint dark:cx-text-faint mt-1">
            {reason.code}
          </p>
        </div>
      </div>
    </div>
  );
};

const WaitReasonDisplay: React.FC<WaitReasonDisplayProps> = ({ reasons, compact = false }) => {
  if (!reasons || reasons.length === 0) {
    return null;
  }

  const blockingReasons = reasons.filter(r => r.blocksTrading);
  const watchReasons = reasons.filter(r => !r.blocksTrading);

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {blockingReasons.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 cx-text-faint" />
            {blockingReasons.map((reason, idx) => (
              <WaitReasonItem key={`${reason.code}-${idx}`} reason={reason} compact />
            ))}
          </div>
        )}
        {watchReasons.map((reason, idx) => (
          <WaitReasonItem key={`${reason.code}-${idx}`} reason={reason} compact />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {blockingReasons.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold cx-text-muted dark:text-gray-300">
              Blocking Reasons ({blockingReasons.length})
            </span>
          </div>
          <div className="space-y-2">
            {blockingReasons.map((reason, idx) => (
              <WaitReasonItem key={`blocking-${reason.code}-${idx}`} reason={reason} />
            ))}
          </div>
        </div>
      )}
      {watchReasons.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-semibold cx-text-muted dark:text-gray-300">
              Watching ({watchReasons.length})
            </span>
          </div>
          <div className="space-y-2">
            {watchReasons.map((reason, idx) => (
              <WaitReasonItem key={`watch-${reason.code}-${idx}`} reason={reason} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WaitReasonDisplay;
