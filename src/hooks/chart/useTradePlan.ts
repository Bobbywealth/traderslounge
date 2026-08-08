/**
 * Hook for trade plan calculations and management.
 * 
 * Handles:
 * - Trade plan state
 * - Target calculations
 * - Risk/reward calculations
 * - Setup snapshots for calculator
 */
import { useMemo } from 'react';
import type { CryptoAnalysis } from '../../services/bwtsApi';

interface TradeTarget {
  label: string;
  price: number;
  rMultiple: number;
  reachable: boolean;
}

interface TradePlan {
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  entry: number | null;
  stop: number | null;
  invalidation: number | null;
  targets: TradeTarget[];
  atr: number | null;
  riskReward: number | null;
  accountRiskPercent: number;
  calendarStatus: string;
  timingStatus: string;
  eligible: boolean;
}

interface SetupSnapshot {
  direction: 'BUY' | 'SELL' | null;
  entry: number | null;
  stop: number | null;
  invalidation: number | null;
  targets: number[];
  atr: number | null;
}

interface UseTradePlanOptions {
  analysis: CryptoAnalysis | null;
}

interface UseTradePlanReturn {
  plan: TradePlan | null;
  setupSnapshot: SetupSnapshot | null;
  hasValidPlan: boolean;
  canExecute: boolean;
}

export function useTradePlan({ analysis }: UseTradePlanOptions): UseTradePlanReturn {
  // Extract and normalize trade plan
  const plan = useMemo((): TradePlan | null => {
    if (!analysis?.trade_plan) return null;
    
    const tradePlan = analysis.trade_plan;
    
    // Extract targets
    const targets: TradeTarget[] = Array.isArray(tradePlan.targets)
      ? tradePlan.targets.slice(0, 3).map((t: any) => ({
          label: t.label || `TP${tradePlan.targets.indexOf(t) + 1}`,
          price: Number(t?.price ?? t) || 0,
          rMultiple: Number(t?.r_multiple ?? t?.rMultiple) || 0,
          reachable: Boolean(t?.reachable ?? true),
        }))
      : [];
    
    // Calculate risk/reward
    const entry = Number.isFinite(Number(tradePlan.entry)) ? Number(tradePlan.entry) : null;
    const stop = Number.isFinite(Number(tradePlan.stop)) ? Number(tradePlan.stop) : null;
    const riskReward = (entry && stop && targets.length > 0) 
      ? Math.abs(targets[0].price - entry) / Math.abs(entry - stop)
      : null;
    
    return {
      direction: (tradePlan.direction || 'NEUTRAL') as 'BUY' | 'SELL' | 'NEUTRAL',
      entry,
      stop,
      invalidation: Number.isFinite(Number(tradePlan.invalidation)) ? Number(tradePlan.invalidation) : null,
      targets,
      atr: Number.isFinite(Number(tradePlan.atr || analysis.indicators?.atr)) 
        ? Number(tradePlan.atr || analysis.indicators?.atr) 
        : null,
      riskReward,
      accountRiskPercent: Number(tradePlan.account_risk_percent) || 1,
      calendarStatus: String(tradePlan.calendar_status || '').toUpperCase(),
      timingStatus: String(tradePlan.timing_status || 'WAIT').toUpperCase(),
      eligible: Boolean(tradePlan.eligible),
    };
  }, [analysis]);
  
  // Create setup snapshot for calculator
  const setupSnapshot = useMemo((): SetupSnapshot | null => {
    if (!plan) return null;
    
    return {
      direction: plan.direction === 'NEUTRAL' ? null : plan.direction,
      entry: plan.entry,
      stop: plan.stop,
      invalidation: plan.invalidation,
      targets: plan.targets.map(t => t.price).filter(p => p > 0),
      atr: plan.atr,
    };
  }, [plan]);
  
  // Check if plan has valid values
  const hasValidPlan = useMemo(() => {
    return plan !== null && 
           plan.entry !== null && 
           plan.stop !== null && 
           plan.targets.length > 0;
  }, [plan]);
  
  // Check if plan can be executed
  const canExecute = useMemo(() => {
    return hasValidPlan && 
           plan!.eligible && 
           plan!.timingStatus === 'READY' && 
           !['BLOCKED', 'POST_NEWS', 'UNAVAILABLE'].includes(plan!.calendarStatus);
  }, [hasValidPlan, plan]);
  
  return {
    plan,
    setupSnapshot,
    hasValidPlan,
    canExecute,
  };
}
