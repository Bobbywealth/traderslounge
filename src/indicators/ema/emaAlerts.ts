/**
 * EMA Alert Engine
 * Generates alerts for EMA events with candle-close confirmation support.
 */
import type { UTCTimestamp } from 'lightweight-charts';
import type { 
  CandleData, 
  EmaResult, 
  EmaAlert, 
  EmaAlertType, 
  CrossoverState,
  MtfAlignment,
  EmaStateAnalysis 
} from './types';

// ============================================================================
// Alert Generation
// ============================================================================

/**
 * Generate EMA alerts based on current state.
 * Alerts fire on state transitions, not continuously.
 */
export const generateEmaAlerts = (
  candles: CandleData[],
  emaResults: Map<number, EmaResult>,
  crossoverState: CrossoverState,
  mtfAlignment: MtfAlignment,
  emaState: EmaStateAnalysis | null,
  previousAlerts: EmaAlert[],
  confirmOnClose: boolean = true
): EmaAlert[] => {
  const newAlerts: EmaAlert[] = [];
  const currentCandle = candles[candles.length - 1];
  
  if (!currentCandle) return newAlerts;
  
  // Only generate alerts on confirmed (closed) candles if confirmation is enabled
  const alertTimestamp = confirmOnClose 
    ? currentCandle.time 
    : currentCandle.time;
  
  // 1. Price crosses EMA alerts
  const priceCrossEmaAlerts = detectPriceCrossesEma(
    candles,
    emaResults,
    alertTimestamp,
    previousAlerts
  );
  newAlerts.push(...priceCrossEmaAlerts);
  
  // 2. EMA crosses EMA alerts
  const emaCrossEmaAlerts = detectEmaCrossesEma(
    crossoverState,
    alertTimestamp,
    previousAlerts
  );
  newAlerts.push(...emaCrossEmaAlerts);
  
  // 3. Golden Cross / Death Cross alerts
  const goldenDeathAlerts = detectGoldenDeathCross(
    crossoverState,
    alertTimestamp,
    previousAlerts
  );
  newAlerts.push(...goldenDeathAlerts);
  
  // 4. Alignment alerts
  const alignmentAlerts = detectAlignmentEvents(
    mtfAlignment,
    emaState,
    alertTimestamp,
    previousAlerts
  );
  newAlerts.push(...alignmentAlerts);
  
  // 5. Compression/Expansion alerts
  const compressionAlerts = detectCompressionExpansion(
    emaState,
    alertTimestamp,
    previousAlerts
  );
  newAlerts.push(...compressionAlerts);
  
  // 6. Price retests EMA alerts
  const retestAlerts = detectPriceRetestsEma(
    candles,
    emaResults,
    alertTimestamp,
    previousAlerts
  );
  newAlerts.push(...retestAlerts);
  
  return newAlerts;
};

// ============================================================================
// Price Crosses EMA Detection
// ============================================================================

const detectPriceCrossesEma = (
  candles: CandleData[],
  emaResults: Map<number, EmaResult>,
  timestamp: UTCTimestamp,
  previousAlerts: EmaAlert[]
): EmaAlert[] => {
  const alerts: EmaAlert[] = [];
  
  if (candles.length < 2) return alerts;
  
  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  
  const emaPeriods = [9, 21, 50, 200];
  
  for (const period of emaPeriods) {
    const emaResult = emaResults.get(period);
    if (!emaResult) continue;
    
    const validValues = emaResult.values.filter(v => v.isValid);
    if (validValues.length < 2) continue;
    
    const currentEma = validValues[validValues.length - 1].value;
    const previousEma = validValues[validValues.length - 2].value;
    
    // Check for crossover
    const prevAboveEma = previousCandle.close > previousEma;
    const currAboveEma = currentCandle.close > currentEma;
    
    if (prevAboveEma !== currAboveEma) {
      const direction = currAboveEma ? 'ABOVE' : 'BELOW';
      const alertId = `price_cross_ema_${period}_${direction}_${Number(timestamp)}`;
      
      // Check if this alert already exists
      const exists = previousAlerts.some(a => a.id === alertId);
      if (!exists) {
        alerts.push({
          id: alertId,
          type: 'PRICE_CROSSES_EMA',
          timestamp,
          data: {
            emaPeriod: period,
            direction,
            price: currentCandle.close,
            emaValue: currentEma,
          },
          confirmed: true,
        });
      }
    }
  }
  
  return alerts;
};

// ============================================================================
// EMA Crosses EMA Detection
// ============================================================================

const detectEmaCrossesEma = (
  crossoverState: CrossoverState,
  timestamp: UTCTimestamp,
  previousAlerts: EmaAlert[]
): EmaAlert[] => {
  const alerts: EmaAlert[] = [];
  
  for (const cross of crossoverState.activeCrosses) {
    const alertId = `ema_cross_${cross.type}_${cross.direction}_${Number(cross.timestamp)}`;
    
    // Check if this alert already exists
    const exists = previousAlerts.some(a => a.id === alertId);
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'EMA_CROSSES_EMA',
        timestamp: cross.timestamp,
        data: {
          crossType: cross.type,
          direction: cross.direction,
          quality: cross.quality,
          barsAgo: cross.barsAgo,
        },
        confirmed: true,
      });
    }
  }
  
  return alerts;
};

// ============================================================================
// Golden Cross / Death Cross Detection
// ============================================================================

const detectGoldenDeathCross = (
  crossoverState: CrossoverState,
  timestamp: UTCTimestamp,
  previousAlerts: EmaAlert[]
): EmaAlert[] => {
  const alerts: EmaAlert[] = [];
  
  // Golden Cross
  if (crossoverState.lastGoldenCross) {
    const cross = crossoverState.lastGoldenCross;
    const alertId = `golden_cross_${Number(cross.timestamp)}`;
    
    const exists = previousAlerts.some(a => a.id === alertId);
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'GOLDEN_CROSS',
        timestamp: cross.timestamp,
        data: {
          quality: cross.quality,
          barsAgo: cross.barsAgo,
        },
        confirmed: true,
      });
    }
  }
  
  // Death Cross
  if (crossoverState.lastDeathCross) {
    const cross = crossoverState.lastDeathCross;
    const alertId = `death_cross_${Number(cross.timestamp)}`;
    
    const exists = previousAlerts.some(a => a.id === alertId);
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'DEATH_CROSS',
        timestamp: cross.timestamp,
        data: {
          quality: cross.quality,
          barsAgo: cross.barsAgo,
        },
        confirmed: true,
      });
    }
  }
  
  return alerts;
};

// ============================================================================
// Alignment Events Detection
// ============================================================================

const detectAlignmentEvents = (
  mtfAlignment: MtfAlignment,
  emaState: EmaStateAnalysis | null,
  timestamp: UTCTimestamp,
  previousAlerts: EmaAlert[]
): EmaAlert[] => {
  const alerts: EmaAlert[] = [];
  
  // Strong bullish alignment
  if (mtfAlignment.overallAlignment === 'STRONG_BULLISH') {
    const alertId = `alignment_bullish_${Number(timestamp)}`;
    const exists = previousAlerts.some(a => a.id === alertId);
    
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'ALIGNMENT_BEGINS',
        timestamp,
        data: {
          alignment: 'STRONG_BULLISH',
          alignmentScore: mtfAlignment.alignmentScore,
          higherTfDominant: mtfAlignment.higherTfDominant,
        },
        confirmed: true,
      });
    }
  }
  
  // Strong bearish alignment
  if (mtfAlignment.overallAlignment === 'STRONG_BEARISH') {
    const alertId = `alignment_bearish_${Number(timestamp)}`;
    const exists = previousAlerts.some(a => a.id === alertId);
    
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'ALIGNMENT_BEGINS',
        timestamp,
        data: {
          alignment: 'STRONG_BEARISH',
          alignmentScore: mtfAlignment.alignmentScore,
          higherTfDominant: mtfAlignment.higherTfDominant,
        },
        confirmed: true,
      });
    }
  }
  
  return alerts;
};

// ============================================================================
// Compression/Expansion Detection
// ============================================================================

const detectCompressionExpansion = (
  emaState: EmaStateAnalysis | null,
  timestamp: UTCTimestamp,
  previousAlerts: EmaAlert[]
): EmaAlert[] => {
  const alerts: EmaAlert[] = [];
  
  if (!emaState) return alerts;
  
  // Compression threshold
  if (emaState.compressionScore > 70) {
    const alertId = `compression_${Number(timestamp)}`;
    const exists = previousAlerts.some(a => a.id === alertId);
    
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'COMPRESSION_THRESHOLD',
        timestamp,
        data: {
          compressionScore: emaState.compressionScore,
        },
        confirmed: true,
      });
    }
  }
  
  // Expansion begins
  if (emaState.expansionScore > 60) {
    const alertId = `expansion_${Number(timestamp)}`;
    const exists = previousAlerts.some(a => a.id === alertId);
    
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'EXPANSION_BEGINS',
        timestamp,
        data: {
          expansionScore: emaState.expansionScore,
        },
        confirmed: true,
      });
    }
  }
  
  return alerts;
};

// ============================================================================
// Price Retests EMA Detection
// ============================================================================

const detectPriceRetestsEma = (
  candles: CandleData[],
  emaResults: Map<number, EmaResult>,
  timestamp: UTCTimestamp,
  previousAlerts: EmaAlert[]
): EmaAlert[] => {
  const alerts: EmaAlert[] = [];
  
  if (candles.length < 5) return alerts;
  
  const currentCandle = candles[candles.length - 1];
  const emaPeriods = [21, 50, 200] as const;
  
  for (const period of emaPeriods) {
    const emaResult = emaResults.get(period);
    if (!emaResult) continue;
    
    const validValues = emaResult.values.filter(v => v.isValid);
    if (validValues.length === 0) continue;
    
    const currentEma = validValues[validValues.length - 1].value;
    const tolerance = currentCandle.close * 0.002; // 0.2% tolerance
    
    // Check if price is near EMA (retesting)
    const distance = Math.abs(currentCandle.close - currentEma);
    if (distance <= tolerance) {
      // Determine direction of retest
      const prevCandle = candles[candles.length - 2];
      const wasAbove = prevCandle.close > currentEma;
      const isAbove = currentCandle.close > currentEma;
      
      const direction = isAbove ? 'FROM_ABOVE' : 'FROM_BELOW';
      const alertId = `retest_ema_${period}_${direction}_${Number(timestamp)}`;
      
      const exists = previousAlerts.some(a => a.id === alertId);
      if (!exists) {
        alerts.push({
          id: alertId,
          type: 'PRICE_RETESTS_EMA',
          timestamp,
          data: {
            emaPeriod: period,
            direction,
            price: currentCandle.close,
            emaValue: currentEma,
            distance,
          },
          confirmed: true,
        });
      }
    }
  }
  
  return alerts;
};

// ============================================================================
// MTF Alignment Detection
// ============================================================================

const detectMtfAlignment = (
  mtfAlignment: MtfAlignment,
  timestamp: UTCTimestamp,
  previousAlerts: EmaAlert[]
): EmaAlert[] => {
  const alerts: EmaAlert[] = [];
  
  if (mtfAlignment.alignmentScore >= 70) {
    const alertId = `mtf_alignment_${Number(timestamp)}`;
    const exists = previousAlerts.some(a => a.id === alertId);
    
    if (!exists) {
      alerts.push({
        id: alertId,
        type: 'MTF_ALIGNMENT',
        timestamp,
        data: {
          alignment: mtfAlignment.overallAlignment,
          score: mtfAlignment.alignmentScore,
          higherTfDominant: mtfAlignment.higherTfDominant,
        },
        confirmed: true,
      });
    }
  }
  
  return alerts;
};

// ============================================================================
// Alert Filtering
// ============================================================================

/**
 * Filter alerts by type and time range.
 */
export const filterAlerts = (
  alerts: EmaAlert[],
  options: {
    types?: EmaAlertType[];
    since?: UTCTimestamp;
    until?: UTCTimestamp;
    confirmedOnly?: boolean;
  } = {}
): EmaAlert[] => {
  return alerts.filter(alert => {
    if (options.types && !options.types.includes(alert.type)) {
      return false;
    }
    
    if (options.since && Number(alert.timestamp) < Number(options.since)) {
      return false;
    }
    
    if (options.until && Number(alert.timestamp) > Number(options.until)) {
      return false;
    }
    
    if (options.confirmedOnly && !alert.confirmed) {
      return false;
    }
    
    return true;
  });
};
