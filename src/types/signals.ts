export type ReasonCode =
  | 'news_block_high_impact'
  | 'news_cooling_period'
  | 'adr_exhausted'
  | 'insufficient_volume_data'
  | 'insufficient_candle_history'
  | 'direction_conflict'
  | 'rr_below_minimum'
  | 'entry_too_extended'
  | 'stale_candles'
  | 'structure_not_confirmed'
  | 'spread_too_wide'
  | 'liquidity_not_confirmed'
  | 'volatility_too_high'
  | 'volatility_too_low'
  | 'portfolio_risk_exceeded'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'model_coverage_low'
  | 'gathering_evidence'
  | 'awaiting_trigger'
  | 'score_below_threshold'
  | 'coverage_improving'
  | 'no_usable_candles'
  | 'no_confirmed_direction'
  | 'data_quality_poor'
  | 'calendar_blocked'
  | 'invalid_structural_stop'
  | 'trade_timing_avoid';

export interface BlockingReason {
  code: ReasonCode;
  message: string;
  severity: 'low' | 'medium' | 'high';
  blocksTrading: boolean;
  data?: Record<string, unknown>;
}

export interface TradePlan {
  version: string;
  status: 'STRONG' | 'VALID' | 'WATCHLIST' | 'BLOCKED' | 'WAIT';
  eligible: boolean;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  score: number;
  entry: number | null;
  invalidation: number | null;
  stop: number | null;
  atr: number | null;
  atr_buffer: number | null;
  risk_distance: number | null;
  risk_percent_of_price: number | null;
  expected_movement: number | null;
  expected_move_percent: number | null;
  available_rr: number;
  net_available_rr: number;
  estimated_cost_r: number | null;
  estimated_round_trip_cost_bps: number;
  minimum_rr: number;
  targets: Array<{
    label: string;
    price: number;
    r_multiple: number;
    reachable: boolean;
  }>;
  daily_range: Record<string, unknown>;
  structural_targets: number[];
  account_risk_percent: number;
  calendar_status: string;
  timing_status: string;
  timing: {
    status: string;
    checks: Record<string, boolean>;
    location_ready: boolean;
    location_signals: string[];
    confirmation_signals: string[];
    nearest_sr: unknown;
    nearest_fibonacci: unknown;
    session: {
      name: string;
      preferred: boolean;
      utc_hour: number | null;
    };
    regime: {
      low_volume: boolean;
      unstable_volatility: boolean;
      adr_exhausted: boolean;
      ema20_distance_atr: number;
      chasing: boolean;
      monthly_weekly_conflict: boolean;
    };
    avoid_reasons: string[];
    wait_for: string[];
    blocking_reasons: BlockingReason[];
  };
  reasons: BlockingReason[];
  position_size_formula: string;
}
