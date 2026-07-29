export type AssetClass = 'forex' | 'forex_jpy' | 'metals' | 'cryptocurrency' | 'indices' | 'commodities';

export interface PositionSizeResult {
  lotSize: number;
  riskAmountUsd: number;
  stopDistance: number;
  stopDistancePips: number;
  pipValuePerLot: number;
  assetClass: AssetClass;
}

export interface TradePlanData {
  version: string;
  status: 'STRONG' | 'VALID' | 'WATCHLIST' | 'WAIT' | 'BLOCKED';
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
  timing: Record<string, unknown>;
  reasons: string[];
  position_size_formula: string;
  position_size: PositionSizeResult;
  asset_class: AssetClass;
}
