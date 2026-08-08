/**
 * EMA System Types
 * Core type definitions for the EMA indicator system.
 */
import type { UTCTimestamp } from 'lightweight-charts';

// ============================================================================
// Price Source Types
// ============================================================================

export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';

export interface CandleData {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ============================================================================
// EMA Configuration
// ============================================================================

export interface EmaConfig {
  period: number;
  source: PriceSource;
  color: string;
  width: number;
  opacity: number;
  visible: boolean;
  label: string;
}

export interface EmaSettings {
  emas: EmaConfig[];
  showOnTimeframes: string[];
  persistSettings: boolean;
}

// ============================================================================
// EMA Calculation Results
// ============================================================================

export interface EmaValue {
  time: UTCTimestamp;
  value: number;
  isValid: boolean; // false when insufficient history
}

export interface EmaResult {
  period: number;
  values: EmaValue[];
  isWarmedUp: boolean; // true when we have enough history
  warmupCandles: number; // how many candles needed for full accuracy
}

// ============================================================================
// EMA State Analysis
// ============================================================================

export type EmaTrendState = 
  | 'STRONG_BULLISH'
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'STRONG_BEARISH'
  | 'COMPRESSION';

export type EmaSlopeClassification = 
  | 'STRONGLY_RISING'
  | 'RISING'
  | 'FLAT'
  | 'FALLING'
  | 'STRONGLY_FALLING';

export interface EmaSlope {
  classification: EmaSlopeClassification;
  normalizedValue: number; // -1 to 1
  rawSlope: number;
  lookbackUsed: number;
}

export interface EmaDistance {
  absolute: number;
  percentage: number;
  atrNormalized: number; // distance in ATR units
}

export interface EmaStateAnalysis {
  stack: EmaTrendState;
  slopes: {
    ema9: EmaSlope;
    ema21: EmaSlope;
    ema50: EmaSlope;
    ema200: EmaSlope;
  };
  distances: {
    distance9_21: EmaDistance;
    distance21_50: EmaDistance;
    distance50_200: EmaDistance;
  };
  expansionScore: number; // 0-100
  compressionScore: number; // 0-100
  priceDistances: {
    priceVsEma9: EmaDistance;
    priceVsEma21: EmaDistance;
    priceVsEma50: EmaDistance;
    priceVsEma200: EmaDistance;
  };
}

// ============================================================================
// Crossover Detection
// ============================================================================

export type CrossoverType = 
  | 'EMA_9_21'
  | 'EMA_9_50'
  | 'EMA_21_50'
  | 'EMA_50_200';

export type CrossDirection = 'BULLISH' | 'BEARISH';

export type CrossoverQuality = 'WEAK' | 'MODERATE' | 'STRONG';

export interface CrossoverEvent {
  type: CrossoverType;
  direction: CrossDirection;
  timestamp: UTCTimestamp;
  barsAgo: number;
  quality: CrossoverQuality;
  qualityScore: number; // 0-100
  isGoldenCross: boolean; // 50 crossing above 200
  isDeathCross: boolean; // 50 crossing below 200
}

export interface CrossoverState {
  recentCrosses: CrossoverEvent[];
  lastGoldenCross: CrossoverEvent | null;
  lastDeathCross: CrossoverEvent | null;
  activeCrosses: CrossoverEvent[];
}

// ============================================================================
// Dynamic Support/Resistance
// ============================================================================

export type InteractionType = 'TOUCH' | 'REJECTION' | 'BREAK' | 'RECLAIM' | 'RETEST';

export interface EmaInteraction {
  emaPeriod: 21 | 50 | 200;
  type: InteractionType;
  timestamp: UTCTimestamp;
  priceAtInteraction: number;
  emaValueAtInteraction: number;
  direction: 'BULLISH' | 'BEARISH';
  strength: number; // 0-100
}

// ============================================================================
// Multi-Timeframe Analysis
// ============================================================================

export type Timeframe = '5M' | '15M' | '30M' | '1H' | '4H' | '1D' | '1W';

export interface MtfEmaState {
  timeframe: Timeframe;
  stack: EmaTrendState;
  trendScore: number;
  timestamp: UTCTimestamp;
}

export interface MtfAlignment {
  states: MtfEmaState[];
  overallAlignment: EmaTrendState;
  alignmentScore: number; // 0-100
  higherTfDominant: boolean;
}

// ============================================================================
// Confluence Analysis
// ============================================================================

export interface ConfluenceZone {
  price: number;
  type: 'EMA' | 'FIBONACCI' | 'SUPPORT_RESISTANCE' | 'VWAP' | 'ORDER_BLOCK' | 'LIQUIDITY';
  label: string;
  strength: number; // 0-100
  distanceFromPrice: number;
}

export interface ConfluenceScore {
  score: number; // 0-100
  zones: ConfluenceZone[];
  nearestZone: ConfluenceZone | null;
  explanation: string;
}

// ============================================================================
// AI Integration
// ============================================================================

export interface EmaAiData {
  ema: {
    '9': { value: number; slope: EmaSlopeClassification; priceDistancePct: number };
    '21': { value: number; slope: EmaSlopeClassification; priceDistancePct: number };
    '50': { value: number; slope: EmaSlopeClassification; priceDistancePct: number };
    '200': { value: number; slope: EmaSlopeClassification; priceDistancePct: number };
  };
  stack: EmaTrendState;
  trendScore: number;
  compressionScore: number;
  expansionScore: number;
  recentCross: CrossoverType | null;
  barsSinceCross: number | null;
  multiTimeframeAlignment: EmaTrendState;
  confluenceScore: number;
  interactions: EmaInteraction[];
}

// ============================================================================
// Alert Types
// ============================================================================

export type EmaAlertType = 
  | 'PRICE_CROSSES_EMA'
  | 'EMA_CROSSES_EMA'
  | 'GOLDEN_CROSS'
  | 'DEATH_CROSS'
  | 'ALIGNMENT_BEGINS'
  | 'COMPRESSION_THRESHOLD'
  | 'EXPANSION_BEGINS'
  | 'PRICE_RETESTS_EMA'
  | 'MTF_ALIGNMENT';

export interface EmaAlert {
  id: string;
  type: EmaAlertType;
  timestamp: UTCTimestamp;
  data: Record<string, unknown>;
  confirmed: boolean; // true when based on closed candle
}

// ============================================================================
// Chart Display
// ============================================================================

export interface EmaLegendItem {
  period: number;
  value: number;
  color: string;
  change: number; // change from previous candle
  changePercent: number;
}

export interface EmaChartState {
  visibleEmas: EmaConfig[];
  legendItems: EmaLegendItem[];
  trendBadge: {
    state: EmaTrendState;
    score: number;
    label: string;
  };
  hoveredCandleEmaValues: Record<number, number> | null;
}
