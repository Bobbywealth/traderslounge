import React from 'react';
import { CheckCircle, Circle, AlertTriangle } from 'lucide-react';
import type { Trigger, BlockingReason } from '../services/bwtsApi';

interface TriggerDisplayProps {
  triggers: Trigger[];
  blockingReasons: BlockingReason[];
}

const TriggerDisplay: React.FC<TriggerDisplayProps> = ({ triggers, blockingReasons }) => {
  if (!triggers.length && !blockingReasons.length) {
    return null;
  }

  const getProgress = (trigger: Trigger): number => {
    if (trigger.completed) return 100;
    if (trigger.type === 'price_enters_zone' && trigger.priceLow !== undefined && trigger.priceHigh !== undefined && trigger.currentValue !== undefined) {
      const range = trigger.priceHigh - trigger.priceLow;
      if (range <= 0) return 0;
      const progress = ((trigger.currentValue - trigger.priceLow) / range) * 100;
      return Math.max(0, Math.min(100, progress));
    }
    if (trigger.type === 'score_crosses_above' && trigger.threshold !== undefined && trigger.currentValue !== undefined) {
      const progress = (trigger.currentValue / trigger.threshold) * 100;
      return Math.max(0, Math.min(100, progress));
    }
    if (trigger.type === 'coverage_crosses_above' && trigger.threshold !== undefined && trigger.currentValue !== undefined) {
      const progress = (trigger.currentValue / trigger.threshold) * 100;
      return Math.max(0, Math.min(100, progress));
    }
    return 0;
  };

  return (
    <div className="space-y-4">
      {triggers.length > 0 && (
        <div>
          <div className="text-[10px] font-black tracking-widest text-slate-500 uppercase mb-2">
            Trigger Conditions
          </div>
          <div className="space-y-2">
            {triggers.map((trigger, index) => {
              const progress = getProgress(trigger);
              return (
                <div key={`${trigger.type}-${index}`} className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {trigger.completed ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs ${trigger.completed ? 'text-slate-400 line-through' : 'text-slate-300'}`}>
                      {trigger.humanReadable}
                    </div>
                    {!trigger.completed && progress > 0 && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {blockingReasons.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-black tracking-widest text-amber-400 uppercase mb-2">
            Blocking Reasons
          </div>
          <div className="space-y-2">
            {blockingReasons.map((reason, index) => (
              <div key={`${reason.code}-${index}`} className="flex items-start gap-3">
                <div className="mt-0.5">
                  <AlertTriangle className={`h-4 w-4 ${
                    reason.severity === 'high' ? 'text-rose-400' :
                    reason.severity === 'medium' ? 'text-amber-400' : 'text-slate-400'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-amber-200">{reason.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TriggerDisplay;