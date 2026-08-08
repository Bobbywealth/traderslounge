/**
 * EMA AI Integration
 * Provides structured EMA data for the AI analysis engine.
 */
import type { 
  CandleData, 
  EmaResult, 
  EmaAiData, 
  EmaTrendState, 
  EmaSlopeClassification,
  CrossoverState,
  MtfAlignment,
  EmaStateAnalysis,
  ConfluenceScore,
  EmaInteraction 
} from './types';

// ============================================================================
// AI Data Construction
// ============================================================================

/**
 * Construct structured EMA data for AI analysis.
 */
export const constructEmaAiData = (
  candles: CandleData[],
  emaResults: Map<number, EmaResult>,
  emaState: EmaStateAnalysis | null,
  crossoverState: CrossoverState,
  mtfAlignment: MtfAlignment,
  confluenceScore: ConfluenceScore,
  interactions: EmaInteraction[]
): EmaAiData | null => {
  if (!emaState) return null;
  
  const currentPrice = candles[candles.length - 1]?.close;
  if (!currentPrice) return null;
  
  // Get EMA values
  const getEmaValue = (period: number): number => {
    const result = emaResults.get(period);
    if (!result) return NaN;
    const validValues = result.values.filter(v => v.isValid);
    return validValues.length > 0 ? validValues[validValues.length - 1].value : NaN;
  };
  
  const ema9 = getEmaValue(9);
  const ema21 = getEmaValue(21);
  const ema50 = getEmaValue(50);
  const ema200 = getEmaValue(200);
  
  // Calculate price distance percentages
  const calcDistancePct = (ema: number): number => {
    if (!Number.isFinite(ema) || ema === 0) return 0;
    return ((currentPrice - ema) / ema) * 100;
  };
  
  // Get recent crossover
  const recentCross = crossoverState.recentCrosses.length > 0 
    ? crossoverState.recentCrosses[0] 
    : null;
  
  // Calculate trend score
  let trendScore = 0;
  if (emaState.stack === 'STRONG_BULLISH') trendScore = 80;
  else if (emaState.stack === 'BULLISH') trendScore = 40;
  else if (emaState.stack === 'NEUTRAL') trendScore = 0;
  else if (emaState.stack === 'BEARISH') trendScore = -40;
  else if (emaState.stack === 'STRONG_BEARISH') trendScore = -80;
  else if (emaState.stack === 'COMPRESSION') trendScore = 0;
  
  return {
    ema: {
      '9': {
        value: ema9,
        slope: emaState.slopes.ema9.classification,
        priceDistancePct: calcDistancePct(ema9),
      },
      '21': {
        value: ema21,
        slope: emaState.slopes.ema21.classification,
        priceDistancePct: calcDistancePct(ema21),
      },
      '50': {
        value: ema50,
        slope: emaState.slopes.ema50.classification,
        priceDistancePct: calcDistancePct(ema50),
      },
      '200': {
        value: ema200,
        slope: emaState.slopes.ema200.classification,
        priceDistancePct: calcDistancePct(ema200),
      },
    },
    stack: emaState.stack,
    trendScore,
    compressionScore: emaState.compressionScore,
    expansionScore: emaState.expansionScore,
    recentCross: recentCross?.type || null,
    barsSinceCross: recentCross?.barsAgo || null,
    multiTimeframeAlignment: mtfAlignment.overallAlignment,
    confluenceScore: confluenceScore.score,
    interactions: interactions.slice(0, 5), // Limit to 5 most recent
  };
};

// ============================================================================
// AI Data Formatting
// ============================================================================

/**
 * Format EMA AI data as a summary string for prompt injection.
 */
export const formatEmaAiSummary = (data: EmaAiData): string => {
  const lines: string[] = [];
  
  lines.push('## EMA Analysis');
  lines.push('');
  
  // EMA Values
  lines.push('### EMA Values');
  lines.push(`- EMA 9: ${data.ema['9'].value.toFixed(2)} (${data.ema['9'].slope})`);
  lines.push(`- EMA 21: ${data.ema['21'].value.toFixed(2)} (${data.ema['21'].slope})`);
  lines.push(`- EMA 50: ${data.ema['50'].value.toFixed(2)} (${data.ema['50'].slope})`);
  lines.push(`- EMA 200: ${data.ema['200'].value.toFixed(2)} (${data.ema['200'].slope})`);
  lines.push('');
  
  // Trend
  lines.push('### Trend');
  lines.push(`- Stack: ${data.stack}`);
  lines.push(`- Trend Score: ${data.trendScore}`);
  lines.push(`- MTF Alignment: ${data.multiTimeframeAlignment}`);
  lines.push('');
  
  // Expansion/Compression
  lines.push('### Expansion/Compression');
  lines.push(`- Expansion Score: ${data.expansionScore}`);
  lines.push(`- Compression Score: ${data.compressionScore}`);
  lines.push('');
  
  // Recent Cross
  if (data.recentCross) {
    lines.push('### Recent Crossover');
    lines.push(`- Type: ${data.recentCross}`);
    lines.push(`- Bars Since: ${data.barsSinceCross}`);
    lines.push('');
  }
  
  // Confluence
  lines.push('### Confluence');
  lines.push(`- Score: ${data.confluenceScore}/100`);
  
  // Recent Interactions
  if (data.interactions.length > 0) {
    lines.push('');
    lines.push('### Recent EMA Interactions');
    for (const interaction of data.interactions.slice(0, 3)) {
      lines.push(`- EMA ${interaction.emaPeriod}: ${interaction.type} (${interaction.direction})`);
    }
  }
  
  return lines.join('\n');
};

// ============================================================================
// Live State vs Confirmed State
// ============================================================================

/**
 * Separate live (forming candle) and confirmed (closed candle) EMA states.
 * This prevents forming-candle EMA events from appearing as confirmed.
 */
export const separateLiveAndConfirmedState = (
  emaResults: Map<number, EmaResult>,
  candles: CandleData[]
): {
  liveState: Map<number, number>;
  confirmedState: Map<number, number>;
} => {
  const liveState = new Map<number, number>();
  const confirmedState = new Map<number, number>();
  
  // Live state includes the forming candle
  for (const [period, result] of emaResults) {
    const validValues = result.values.filter(v => v.isValid);
    if (validValues.length > 0) {
      liveState.set(period, validValues[validValues.length - 1].value);
    }
  }
  
  // Confirmed state uses only closed candles
  if (candles.length >= 2) {
    const closedCandles = candles.slice(0, -1); // Exclude the last (forming) candle
    
    for (const [period, result] of emaResults) {
      // Recalculate with closed candles only
      const closedValues = result.values.slice(0, -1).filter(v => v.isValid);
      if (closedValues.length > 0) {
        confirmedState.set(period, closedValues[closedValues.length - 1].value);
      }
    }
  }
  
  return { liveState, confirmedState };
};

// ============================================================================
// EMA Data for Chart Legend
// ============================================================================

/**
 * Get EMA values for chart legend display.
 */
export const getEmaLegendData = (
  emaResults: Map<number, EmaResult>,
  currentPrice: number
): Array<{
  period: number;
  value: number;
  change: number;
  changePercent: number;
  color: string;
}> => {
  const legendData: Array<{
    period: number;
    value: number;
    change: number;
    changePercent: number;
    color: string;
  }> = [];
  
  const colors: Record<number, string> = {
    9: '#22D3EE',
    21: '#F472B6',
    50: '#FBBF24',
    200: '#A855F7',
  };
  
  for (const [period, result] of emaResults) {
    const validValues = result.values.filter(v => v.isValid);
    if (validValues.length >= 2) {
      const currentValue = validValues[validValues.length - 1].value;
      const previousValue = validValues[validValues.length - 2].value;
      const change = currentValue - previousValue;
      const changePercent = previousValue !== 0 ? (change / previousValue) * 100 : 0;
      
      legendData.push({
        period,
        value: currentValue,
        change,
        changePercent,
        color: colors[period] || '#9CA3AF',
      });
    }
  }
  
  return legendData;
};

// ============================================================================
// EMA Data for Hover Tooltip
// ============================================================================

/**
 * Get EMA values for a specific candle (for hover tooltip).
 */
export const getEmaValuesAtCandle = (
  emaResults: Map<number, EmaResult>,
  candleIndex: number
): Record<number, number> => {
  const values: Record<number, number> = {};
  
  for (const [period, result] of emaResults) {
    if (candleIndex < result.values.length && result.values[candleIndex].isValid) {
      values[period] = result.values[candleIndex].value;
    }
  }
  
  return values;
};
