import React, { useState, useEffect } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { bwtsApi, type CalendarGlobalStatus } from '../services/bwtsApi';

const SESSION_KEY = 'economic-risk-banner-dismissed';

const formatTime = (isoString: string | null): string => {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
};

const formatTimeUntil = (minutes: number | null): string => {
  if (minutes === null) return '';
  if (minutes < 0) return `${Math.abs(minutes)} minutes ago`;
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
};

const EconomicRiskBanner: React.FC = () => {
  const [status, setStatus] = useState<CalendarGlobalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    bwtsApi.calendarGlobalStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } catch {
      // ignore
    }
  };

  if (loading || !status || status.status === 'CLEAR' || dismissed) {
    return null;
  }

  const isBlocked = status.status === 'BLOCKED';
  const isCaution = status.status === 'CAUTION';
  const isPostNews = status.status === 'POST_NEWS';

  const bannerBg = isBlocked
    ? 'bg-amber-500/10 border-amber-500/30'
    : isCaution
    ? 'bg-orange-500/10 border-orange-500/30'
    : 'bg-amber-500/10 border-amber-500/30';

  const iconBg = isBlocked
    ? 'bg-amber-500/20 text-amber-300'
    : isCaution
    ? 'bg-orange-500/20 text-orange-300'
    : 'bg-amber-500/20 text-amber-300';

  return (
    <div className={`rounded-xl border ${bannerBg} p-4 mb-4`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg ${iconBg}`}>
          <AlertTriangle className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-amber-200">
              {status.currency || 'USD'} Event Risk: {status.event_title || 'Upcoming Event'}
            </span>
            {status.time_until_event_minutes !== null && (
              <span className="text-amber-300 text-sm">
                {isPostNews ? '' : 'in'} {formatTimeUntil(status.time_until_event_minutes)}
              </span>
            )}
          </div>

          <p className="text-amber-200/80 text-sm mt-1">
            {isBlocked && status.blackout_end && (
              <>New {status.currency || 'USD'} entries blocked until {formatTime(status.blackout_end)} ET</>
            )}
            {isCaution && (
              <>{status.impact === 'high' ? 'High-impact' : 'Medium-impact'} event approaching - exercise caution</>
            )}
            {isPostNews && (
              <>Post-event cooldown active - wait for clearance</>
            )}
          </p>

          {status.affected_symbols && status.affected_symbols.length > 0 && (
            <p className="text-amber-300/70 text-xs mt-1">
              Affected: {status.affected_symbols.join(', ')}
            </p>
          )}

          {expanded && (
            <div className="mt-3 pt-3 border-t border-amber-500/20 space-y-2 text-xs text-amber-200/70">
              {status.blackout_start && (
                <div className="flex justify-between">
                  <span>Blackout window:</span>
                  <span>{formatTime(status.blackout_start)} ET - {formatTime(status.blackout_end)} ET</span>
                </div>
              )}
              {status.next_eligible_time && (
                <div className="flex justify-between">
                  <span>Next eligible time:</span>
                  <span>{formatTime(status.next_eligible_time)} ET</span>
                </div>
              )}
              {status.impact && (
                <div className="flex justify-between">
                  <span>Impact level:</span>
                  <span className="uppercase">{status.impact}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Calendar source:</span>
                <span>{status.source}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs font-bold hover:bg-amber-500/20 transition"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button
            onClick={handleDismiss}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs font-bold hover:bg-amber-500/20 transition"
          >
            <X className="w-3.5 h-3.5" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default EconomicRiskBanner;