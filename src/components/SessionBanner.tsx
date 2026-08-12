/**
 * SessionBanner — shows the current trading session (NY, London, Asian, etc.)
 * with a live clock and session status.
 */
import React from 'react';
import { Clock, Globe, Activity, Zap } from 'lucide-react';

interface SessionBannerProps {
  session: string;
  startHour: number | null;
  endHour: number | null;
  activeSetups: number;
}

const sessionColors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  new_york: { bg: 'bg-cyan-500/15 border-cyan-500/30', text: 'text-cyan-400', icon: <Zap className="w-4 h-4" /> },
  london: { bg: 'bg-violet-500/15 border-violet-500/30', text: 'text-violet-400', icon: <Globe className="w-4 h-4" /> },
  asian: { bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-400', icon: <Clock className="w-4 h-4" /> },
  overlap: { bg: 'bg-fuchsia-500/15 border-fuchsia-500/30', text: 'text-fuchsia-400', icon: <Activity className="w-4 h-4" /> },
};

const SessionBanner: React.FC<SessionBannerProps> = ({ session, startHour, endHour, activeSetups }) => {
  const style = sessionColors[session] || sessionColors.new_york;
  const label = session.replace(/_/g, ' ').toUpperCase();

  return (
    <div className={`rounded-xl border px-5 py-3 flex items-center justify-between ${style.bg}`}>
      <div className="flex items-center gap-3">
        <div className={style.text}>{style.icon}</div>
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider">Market State</div>
          <div className={`font-bold text-lg ${style.text}`}>
            {label} SESSION
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs text-gray-500">Active Setups</div>
        <div className="text-xl font-bold text-white">{activeSetups}</div>
      </div>
    </div>
  );
};

export default SessionBanner;
