/**
 * Classical chart pattern specifications.
 *
 * Each pattern defines the geometric requirements, confidence weighting,
 * and rendering hints used by the frontend chart overlay. Unlike harmonic
 * patterns (which use Fibonacci ratio bounds), classical patterns are
 * defined by swing structure and support/resistance geometry.
 */

export type ClassicalPatternFamily = 'classical';

export type ClassicalPatternName =
  | 'Double Top'
  | 'Double Bottom'
  | 'Triple Top'
  | 'Triple Bottom'
  | 'Head and Shoulders'
  | 'Inverse Head and Shoulders'
  | 'Ascending Triangle'
  | 'Descending Triangle'
  | 'Symmetrical Triangle'
  | 'Rising Wedge'
  | 'Falling Wedge'
  | 'Range'
  | 'Cup and Handle'
  | 'Cup (no handle)'
  | 'Bull Flag'
  | 'Bear Flag';

export type ClassicalPatternDirection = 'bullish' | 'bearish' | 'neutral';

export type ClassicalPatternSpec = {
  name: ClassicalPatternName;
  family: ClassicalPatternFamily;
  direction: ClassicalPatternDirection;
  /** Minimum number of swing pivots required to form the pattern. */
  minPivots: number;
  /** Confidence weight (0-1) reflecting pattern reliability. */
  confidenceWeight: number;
  /** How the neckline / breakout level is derived. */
  breakoutSource: 'neckline' | 'trendline' | 'boundary';
  /** Rendering hints for the chart overlay. */
  rendering: {
    /** Draw the neckline / key level as a horizontal line. */
    drawNeckline: boolean;
    /** Draw converging trendlines (triangles, wedges). */
    drawTrendlines: boolean;
    /** Label the pattern on the chart. */
    showLabel: boolean;
    /** Pattern shape for overlay drawing. */
    shape: 'm_formation' | 'w_formation' | 'triple_m' | 'triple_w' | 'head_shoulders' | 'triangle' | 'wedge' | 'rectangle' | 'cup';
  };
  /** Description for tooltip / explanation UI. */
  description: string;
};

/**
 * Classical pattern specifications keyed by lowercase-normalized name.
 * Frontend code should match pattern.name.toLowerCase() against these keys.
 */
export const classicalPatternSpecs: Record<string, ClassicalPatternSpec> = {
  'double top': {
    name: 'Double Top',
    family: 'classical',
    direction: 'bearish',
    minPivots: 3,
    confidenceWeight: 0.65,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'm_formation',
    },
    description: 'Two highs at similar resistance with a trough between. Bearish on neckline break.',
  },
  'double bottom': {
    name: 'Double Bottom',
    family: 'classical',
    direction: 'bullish',
    minPivots: 3,
    confidenceWeight: 0.65,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'w_formation',
    },
    description: 'Two lows at similar support with a peak between. Bullish on neckline break.',
  },
  'triple top': {
    name: 'Triple Top',
    family: 'classical',
    direction: 'bearish',
    minPivots: 5,
    confidenceWeight: 0.70,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'triple_m',
    },
    description: 'Three highs at similar resistance with two troughs. Stronger reversal signal than double top.',
  },
  'triple bottom': {
    name: 'Triple Bottom',
    family: 'classical',
    direction: 'bullish',
    minPivots: 5,
    confidenceWeight: 0.70,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'triple_w',
    },
    description: 'Three lows at similar support with two peaks. Stronger reversal signal than double bottom.',
  },
  'head and shoulders': {
    name: 'Head and Shoulders',
    family: 'classical',
    direction: 'bearish',
    minPivots: 5,
    confidenceWeight: 0.75,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'head_shoulders',
    },
    description: 'Three peaks with middle highest. Neckline break signals trend reversal.',
  },
  'inverse head and shoulders': {
    name: 'Inverse Head and Shoulders',
    family: 'classical',
    direction: 'bullish',
    minPivots: 5,
    confidenceWeight: 0.75,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'head_shoulders',
    },
    description: 'Three troughs with middle lowest. Neckline break signals trend reversal.',
  },
  'ascending triangle': {
    name: 'Ascending Triangle',
    family: 'classical',
    direction: 'bullish',
    minPivots: 4,
    confidenceWeight: 0.68,
    breakoutSource: 'trendline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: true,
      showLabel: true,
      shape: 'triangle',
    },
    description: 'Flat resistance with rising support. Bullish breakout expected.',
  },
  'descending triangle': {
    name: 'Descending Triangle',
    family: 'classical',
    direction: 'bearish',
    minPivots: 4,
    confidenceWeight: 0.68,
    breakoutSource: 'trendline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: true,
      showLabel: true,
      shape: 'triangle',
    },
    description: 'Flat support with falling resistance. Bearish breakout expected.',
  },
  'symmetrical triangle': {
    name: 'Symmetrical Triangle',
    family: 'classical',
    direction: 'neutral',
    minPivots: 4,
    confidenceWeight: 0.60,
    breakoutSource: 'trendline',
    rendering: {
      drawNeckline: false,
      drawTrendlines: true,
      showLabel: true,
      shape: 'triangle',
    },
    description: 'Converging trendlines. Breakout direction determined by prevailing momentum.',
  },
  'rising wedge': {
    name: 'Rising Wedge',
    family: 'classical',
    direction: 'bearish',
    minPivots: 4,
    confidenceWeight: 0.62,
    breakoutSource: 'trendline',
    rendering: {
      drawNeckline: false,
      drawTrendlines: true,
      showLabel: true,
      shape: 'wedge',
    },
    description: 'Both trendlines slope upward but converge. Bearish reversal expected.',
  },
  'falling wedge': {
    name: 'Falling Wedge',
    family: 'classical',
    direction: 'bullish',
    minPivots: 4,
    confidenceWeight: 0.62,
    breakoutSource: 'trendline',
    rendering: {
      drawNeckline: false,
      drawTrendlines: true,
      showLabel: true,
      shape: 'wedge',
    },
    description: 'Both trendlines slope downward but converge. Bullish reversal expected.',
  },
  'range': {
    name: 'Range',
    family: 'classical',
    direction: 'neutral',
    minPivots: 4,
    confidenceWeight: 0.55,
    breakoutSource: 'boundary',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'rectangle',
    },
    description: 'Horizontal consolidation between flat support and resistance. Direction determined by breakout.',
  },
  'cup and handle': {
    name: 'Cup and Handle',
    family: 'classical',
    direction: 'bullish',
    minPivots: 4,
    confidenceWeight: 0.70,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'cup',
    },
    description: 'U-shaped recovery (cup) followed by a smaller pullback (handle). Bullish on rim break.',
  },
  'cup (no handle)': {
    name: 'Cup (no handle)',
    family: 'classical',
    direction: 'bullish',
    minPivots: 3,
    confidenceWeight: 0.50,
    breakoutSource: 'neckline',
    rendering: {
      drawNeckline: true,
      drawTrendlines: false,
      showLabel: true,
      shape: 'cup',
    },
    description: 'U-shaped recovery without handle formation. Lower confidence until handle completes.',
  },
  'bull flag': {
    name: 'Bull Flag',
    family: 'classical',
    direction: 'bullish',
    minPivots: 4,
    confidenceWeight: 0.65,
    breakoutSource: 'trendline',
    rendering: {
      drawNeckline: false,
      drawTrendlines: true,
      showLabel: true,
      shape: 'wedge',
    },
    description: 'Strong upward impulse followed by shallow downward drift. Continuation pattern.',
  },
  'bear flag': {
    name: 'Bear Flag',
    family: 'classical',
    direction: 'bearish',
    minPivots: 4,
    confidenceWeight: 0.65,
    breakoutSource: 'trendline',
    rendering: {
      drawNeckline: false,
      drawTrendlines: true,
      showLabel: true,
      shape: 'wedge',
    },
    description: 'Strong downward impulse followed by shallow upward drift. Continuation pattern.',
  },
};

/**
 * All recognized classical pattern names (for dropdown/filter UI).
 */
export const classicalPatternNames: ClassicalPatternName[] = Object.values(classicalPatternSpecs).map(s => s.name);

/**
 * Confidence tiers for classical patterns.
 * Used to categorize pattern reliability in the UI.
 */
export const classicalConfidenceTiers = {
  high: { min: 0.70, patterns: ['Head and Shoulders', 'Inverse Head and Shoulders', 'Triple Top', 'Triple Bottom', 'Cup and Handle'] },
  medium: { min: 0.60, patterns: ['Double Top', 'Double Bottom', 'Ascending Triangle', 'Descending Triangle', 'Bull Flag', 'Bear Flag', 'Rising Wedge', 'Falling Wedge'] },
  low: { min: 0.0, patterns: ['Symmetrical Triangle', 'Range', 'Cup (no handle)'] },
} as const;
