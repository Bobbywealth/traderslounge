/**
 * Command Center — Trading Command Center homepage for ConfluenceX.
 *
 * The primary "what to trade / why this trade" dashboard showing:
 * - MARKET STATE session banner
 * - Best Opportunity hero card
 * - Why This Trade (confluence bullets + memory)
 * - Analyze Deeper (multi-agent debate)
 * - Trading Memory feed
 * - Tabbed views: Top Opportunities | News | AI Desk
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart3, Newspaper, Bot, RefreshCw, Target, AlertTriangle,
} from 'lucide-react';
import { bwtsApi, type CommandCenterData, type TradingInsight } from '../services/bwtsApi';
import SessionBanner from '../components/SessionBanner';
import BestOpportunityCard from '../components/BestOpportunityCard';
import WhyThisTrade from '../components/WhyThisTrade';
import AnalyzeDeeperButton from '../components/AnalyzeDeeperButton';
import MemoryFeed from '../components/MemoryFeed';

type Tab = 'opportunities' | 'news' | 'ai_desk';

const CommandCenter: React.FC = () => {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [memories, setMemories] = useState<TradingInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('opportunities');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [center, insights] = await Promise.all([
        bwtsApi.commandCenterBest().catch(() => null),
        bwtsApi.insights({ limit: 20 }).catch(() => ({ insights: [], count: 0 })),
      ]);
      if (center) setData(center);
      setMemories(insights?.insights || []);
      setError(null);
    } catch {
      setError('Failed to load command center data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading Command Center...
        </div>
      </div>
    );
  }

  const best = data?.best_opportunity;
  const consensus = data?.consensus;
  const session = data?.session || { name: 'unknown', start_hour: null, end_hour: null };
  const newsVetoes = data?.news_vetoes || [];

  // Build confluence bullets from consensus votes
  const confluences = (consensus?.votes || []).map(v => ({
    label: v.label,
    available: v.available,
    vote: v.vote,
    confidence: v.confidence,
    reason: v.reason,
  }));

  // Combine memories from command center + general insights
  const allMemories = [...(data?.memories || []), ...memories];
  const uniqueMemories = allMemories.filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Error banner */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Session Banner */}
        <SessionBanner
          session={session.name}
          startHour={session.start_hour}
          endHour={session.end_hour}
          activeSetups={data?.active_setups || 0}
        />

        {best ? (
          <>
            {/* Best Opportunity Card */}
            <BestOpportunityCard
              symbol={best.symbol}
              direction={best.direction}
              score={best.score}
              state={best.state}
              stopLoss={best.stop_loss}
              tp1={best.tp1}
              tp2={best.tp2}
              tp3={best.tp3}
              entryLow={best.entry_low}
              entryHigh={best.entry_high}
              expectedRr={best.expected_rr_tp1}
              marketRegime={best.market_regime}
              newsState={best.news_state}
              dataQuality={best.data_quality}
            />

            {/* Why This Trade + Analyze Deeper */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <WhyThisTrade
                  direction={best.direction}
                  confluences={confluences}
                  vetoReasons={consensus?.veto_reasons || []}
                  memories={uniqueMemories}
                  newsVetoes={newsVetoes}
                />
                <AnalyzeDeeperButton
                  symbol={best.symbol}
                  direction={best.direction}
                />
              </div>
              <div>
                <MemoryFeed memories={uniqueMemories} symbol={best.symbol} />
              </div>
            </div>
          </>
        ) : (
          <div className="bg-gray-800/60 rounded-2xl border border-gray-700/50 p-12 text-center">
            <Target className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <div className="text-lg text-gray-400 mb-2">No Active Setup</div>
            <div className="text-sm text-gray-500">The scanner is monitoring markets. A setup will appear here when conditions align.</div>
          </div>
        )}

        {/* Tabbed section */}
        <div className="bg-gray-800/60 rounded-2xl border border-gray-700/50">
          <div className="flex border-b border-gray-700/50">
            {[
              { key: 'opportunities' as Tab, label: 'Top Opportunities', icon: <Target className="w-4 h-4" /> },
              { key: 'news' as Tab, label: 'News', icon: <Newspaper className="w-4 h-4" /> },
              { key: 'ai_desk' as Tab, label: 'AI Desk', icon: <Bot className="w-4 h-4" /> },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'text-cyan-400 border-b-2 border-cyan-400'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {activeTab === 'opportunities' && (
              <div className="text-center py-8 text-gray-500 text-sm">
                <BarChart3 className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                Full opportunity list available in the{' '}
                <a href="/scanner" className="text-cyan-400 hover:underline">Hot Scanner</a>
              </div>
            )}
            {activeTab === 'news' && (
              <div className="text-center py-8 text-gray-500 text-sm">
                <Newspaper className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                Economic calendar and news events{' '}
                <a href="/calendar" className="text-cyan-400 hover:underline">View Calendar</a>
              </div>
            )}
            {activeTab === 'ai_desk' && (
              <div className="text-center py-8 text-gray-500 text-sm">
                <Bot className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                Multi-agent analysis and debate.{' '}
                Use the{' '}
                <button
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="text-cyan-400 hover:underline"
                >
                  Analyze Deeper
                </button>{' '}
                button above to launch a full council analysis.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandCenter;
