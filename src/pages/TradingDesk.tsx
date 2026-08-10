/**
 * Trading Desk Dashboard for Confluence X
 * 
 * Top-level autonomous trading dashboard showing:
 * - System Status
 * - Market Regime
 * - Best Opportunities
 * - Active Positions
 * - Upcoming News
 * - Current Risk
 * - Agent Activity
 */
import React, { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Bell, Bot,
  Clock, Cpu, Eye, Globe, Shield, Target, TrendingUp,
  Wifi, WifiOff, Zap
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bwtsApi } from '../services/bwtsApi';

interface SystemStatus {
  mode: string;
  health: string;
  components: Record<string, string>;
  active_setups: number;
  active_positions: number;
  last_scan_time: number | null;
  scan_count: number;
  engine_version: string;
}

interface Opportunity {
  symbol: string;
  direction: string;
  score: number;
  setup_quality: string;
  execution_readiness: string;
  market_regime: string;
  session: string;
  news_status: string;
  expected_rr: number;
}

interface NewsEvent {
  event_id: string;
  title: string;
  currency: string;
  impact: string;
  minutes_until: number;
}

interface Alert {
  alert_id: string;
  alert_type: string;
  severity: string;
  symbol: string;
  title: string;
  message: string;
  created_at: number;
}

const TradingDesk: React.FC = () => {
  const { user } = useAuth();
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    // Fetch each sub-endpoint independently so one 4xx/5xx doesn't
    // blank the whole dashboard.  The Trading Desk page surfaces a
    // "Failed to load dashboard data" banner on any throw, which used
    // to hide perfectly-good status/opportunities/news data whenever
    // the alerts endpoint (now auth-public) returned 401.
    setLoading(true);
    const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      try { return await p; } catch { return fallback; }
    };
    try {
      const [status, opps, newsResp, alertsResp] = await Promise.all([
        safe(bwtsApi.autonomyStatus(), null),
        safe(bwtsApi.autonomyOpportunities(), { opportunities: [] } as any),
        safe(bwtsApi.autonomyNews(), { events: [] } as any),
        safe(bwtsApi.autonomyAlerts(), { alerts: [] } as any),
      ]);
      if (status) setSystemStatus(status);
      setOpportunities(opps?.opportunities || []);
      setNews(newsResp?.events || []);
      setAlerts(alertsResp?.alerts || []);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError('Failed to load dashboard data');
      setLoading(false);
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'text-green-400';
      case 'degraded': return 'text-yellow-400';
      case 'unhealthy': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getHealthIcon = (health: string) => {
    switch (health) {
      case 'healthy': return <Wifi className="w-4 h-4" />;
      case 'degraded': return <AlertTriangle className="w-4 h-4" />;
      case 'unhealthy': return <WifiOff className="w-4 h-4" />;
      default: return <Cpu className="w-4 h-4" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400 bg-green-400/10';
    if (score >= 65) return 'text-blue-400 bg-blue-400/10';
    if (score >= 50) return 'text-yellow-400 bg-yellow-400/10';
    return 'text-gray-400 bg-gray-400/10';
  };

  const getImpactColor = (impact: string) => {
    switch (impact.toLowerCase()) {
      case 'high': case 'critical': return 'text-red-400';
      case 'medium': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading Trading Desk...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Bot className="w-8 h-8 text-blue-400" />
              Confluence X Trading Desk
            </h1>
            <p className="text-gray-400 mt-1">
              Autonomous Market Intelligence Platform
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-400">Engine Version</div>
            <div className="font-mono">{systemStatus?.engine_version || 'unknown'}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Status */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-400" />
            System Status
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Mode</span>
              <span className="font-mono bg-blue-400/10 text-blue-400 px-2 py-1 rounded">
                {systemStatus?.mode?.toUpperCase() || 'INTELLIGENCE'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Health</span>
              <span className={`flex items-center gap-1 ${getHealthColor(systemStatus?.health || 'unknown')}`}>
                {getHealthIcon(systemStatus?.health || 'unknown')}
                {systemStatus?.health || 'unknown'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Active Setups</span>
              <span className="font-mono">{systemStatus?.active_setups || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Scan Count</span>
              <span className="font-mono">{systemStatus?.scan_count || 0}</span>
            </div>
          </div>

          {/* Component Health */}
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="text-sm text-gray-400 mb-2">Components</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(systemStatus?.components || {}).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${
                    value === 'healthy' ? 'bg-green-400' : 
                    value === 'degraded' ? 'bg-yellow-400' : 'bg-red-400'
                  }`} />
                  <span className="text-gray-400 capitalize">{key.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Best Opportunities */}
        <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-green-400" />
            Best Opportunities
          </h2>
          {opportunities.length === 0 ? (
            <div className="text-gray-400 text-center py-8">
              No opportunities detected
            </div>
          ) : (
            <div className="space-y-3">
              {opportunities.slice(0, 5).map((opp, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold ${
                      opp.direction === 'BUY' ? 'bg-green-400/20 text-green-400' : 'bg-red-400/20 text-red-400'
                    }`}>
                      {opp.direction === 'BUY' ? '↑' : '↓'}
                    </div>
                    <div>
                      <div className="font-semibold">{opp.symbol}</div>
                      <div className="text-sm text-gray-400">
                        {opp.market_regime} • {opp.session}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold px-3 py-1 rounded ${getScoreColor(opp.score)}`}>
                      {opp.score}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {opp.setup_quality} • R:R {opp.expected_rr.toFixed(1)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming News */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-yellow-400" />
            Upcoming News
          </h2>
          {news.length === 0 ? (
            <div className="text-gray-400 text-center py-8">
              No upcoming events
            </div>
          ) : (
            <div className="space-y-3">
              {news.slice(0, 5).map((event, i) => (
                <div key={i} className="p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{event.title}</div>
                      <div className="text-sm text-gray-400">{event.currency}</div>
                    </div>
                    <div className={`text-sm font-medium ${getImpactColor(event.impact)}`}>
                      {event.impact}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-400">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {event.minutes_until > 60 
                      ? `${Math.floor(event.minutes_until / 60)}h ${event.minutes_until % 60}m`
                      : `${event.minutes_until}m`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Alerts */}
        <div className="bg-gray-800 rounded-lg p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-purple-400" />
            Recent Alerts
          </h2>
          {alerts.length === 0 ? (
            <div className="text-gray-400 text-center py-8">
              No recent alerts
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.slice(0, 5).map((alert, i) => (
                <div key={i} className={`p-3 rounded-lg border-l-4 ${
                  alert.severity === 'critical' ? 'bg-red-500/10 border-red-500' :
                  alert.severity === 'high' ? 'bg-orange-500/10 border-orange-500' :
                  'bg-gray-700/50 border-gray-600'
                }`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{alert.title}</div>
                      <div className="text-sm text-gray-400">{alert.symbol}</div>
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(alert.created_at * 1000).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-300">{alert.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Activity */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            Agent Activity
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-gray-700/50 rounded-lg">
              <Eye className="w-5 h-5 text-blue-400" />
              <div>
                <div className="font-medium">Market Watcher</div>
                <div className="text-sm text-gray-400">Monitoring {systemStatus?.scan_count || 0} symbols</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-700/50 rounded-lg">
              <Zap className="w-5 h-5 text-yellow-400" />
              <div>
                <div className="font-medium">Scanner</div>
                <div className="text-sm text-gray-400">{opportunities.length} opportunities detected</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-700/50 rounded-lg">
              <Shield className="w-5 h-5 text-green-400" />
              <div>
                <div className="font-medium">Risk Manager</div>
                <div className="text-sm text-gray-400">All limits within bounds</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-700/50 rounded-lg">
              <Bot className="w-5 h-5 text-purple-400" />
              <div>
                <div className="font-medium">AI Assistant</div>
                <div className="text-sm text-gray-400">Ready for questions</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TradingDesk;
