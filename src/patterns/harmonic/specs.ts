export type RatioBound = {
  min: number;
  max: number;
};

export type PatternRatios = {
  abRetracementOfXa: RatioBound;
  bcRetracementOfAb: RatioBound;
  cdExtensionOfBc: RatioBound;
  adRetracementOfXa?: RatioBound;
  adExtensionOfXa?: RatioBound;
};

export type HarmonicPatternSpec = {
  name: string;
  ratios: PatternRatios;
  maxDeviationPercent: number;
  confidenceWeight: number;
};

export type PRZClusterRule = {
  minConfluenceHits: number;
  maxWidthPercentOfPrice: number;
  scoreBoost: number;
  description: string;
};

export type OverlapTieBreaker = {
  priority: Array<
    | 'higherConfidenceScore'
    | 'tighterPRZ'
    | 'lowerMeanRatioError'
    | 'earlierCompletion'
  >;
  fallback: 'firstDetected';
};

export type HarmonicPatternOutput = {
  patternName: string;
  completionZone: {
    low: number;
    high: number;
  };
  confidenceContribution: {
    baseWeight: number;
    ratioFitScore: number;
    przClusterBoost: number;
    total: number;
  };
  invalidationLevel: number;
};

export const harmonicPatternSpecs: Record<string, HarmonicPatternSpec> = {
  gartley: {
    name: 'Gartley',
    ratios: {
      abRetracementOfXa: { min: 0.618, max: 0.618 },
      bcRetracementOfAb: { min: 0.382, max: 0.886 },
      cdExtensionOfBc: { min: 1.13, max: 1.618 },
      adRetracementOfXa: { min: 0.786, max: 0.786 },
    },
    maxDeviationPercent: 3,
    confidenceWeight: 0.85,
  },
  bat: {
    name: 'Bat',
    ratios: {
      abRetracementOfXa: { min: 0.382, max: 0.5 },
      bcRetracementOfAb: { min: 0.382, max: 0.886 },
      cdExtensionOfBc: { min: 1.618, max: 2.618 },
      adRetracementOfXa: { min: 0.886, max: 0.886 },
    },
    maxDeviationPercent: 3,
    confidenceWeight: 0.88,
  },
  butterfly: {
    name: 'Butterfly',
    ratios: {
      abRetracementOfXa: { min: 0.786, max: 0.786 },
      bcRetracementOfAb: { min: 0.382, max: 0.886 },
      cdExtensionOfBc: { min: 1.618, max: 2.24 },
      adExtensionOfXa: { min: 1.27, max: 1.618 },
    },
    maxDeviationPercent: 3.5,
    confidenceWeight: 0.86,
  },
  crab: {
    name: 'Crab',
    ratios: {
      abRetracementOfXa: { min: 0.382, max: 0.618 },
      bcRetracementOfAb: { min: 0.382, max: 0.886 },
      cdExtensionOfBc: { min: 2.24, max: 3.618 },
      adExtensionOfXa: { min: 1.618, max: 1.618 },
    },
    maxDeviationPercent: 4,
    confidenceWeight: 0.82,
  },
  deepCrab: {
    name: 'Deep Crab',
    ratios: {
      abRetracementOfXa: { min: 0.886, max: 0.886 },
      bcRetracementOfAb: { min: 0.382, max: 0.886 },
      cdExtensionOfBc: { min: 2.0, max: 3.618 },
      adExtensionOfXa: { min: 1.618, max: 1.618 },
    },
    maxDeviationPercent: 4,
    confidenceWeight: 0.83,
  },
  shark: {
    name: 'Shark',
    ratios: {
      abRetracementOfXa: { min: 0.0, max: 0.0 },
      bcRetracementOfAb: { min: 1.13, max: 1.618 },
      cdExtensionOfBc: { min: 1.618, max: 2.24 },
      adExtensionOfXa: { min: 0.886, max: 1.13 },
    },
    maxDeviationPercent: 4.5,
    confidenceWeight: 0.75,
  },
  cypher: {
    name: 'Cypher',
    ratios: {
      abRetracementOfXa: { min: 0.382, max: 0.618 },
      bcRetracementOfAb: { min: 1.13, max: 1.414 },
      cdExtensionOfBc: { min: 0.786, max: 0.786 },
      adRetracementOfXa: { min: 0.786, max: 0.786 },
    },
    maxDeviationPercent: 3.5,
    confidenceWeight: 0.8,
  },
};

export const przClusteringRules: PRZClusterRule[] = [
  {
    minConfluenceHits: 2,
    maxWidthPercentOfPrice: 0.75,
    scoreBoost: 0.06,
    description: 'Two PRZ components converge in a narrow zone',
  },
  {
    minConfluenceHits: 3,
    maxWidthPercentOfPrice: 0.5,
    scoreBoost: 0.1,
    description: 'Three PRZ components converge in a tight zone',
  },
  {
    minConfluenceHits: 4,
    maxWidthPercentOfPrice: 0.35,
    scoreBoost: 0.14,
    description: 'Exceptional confluence across all PRZ components',
  },
];

export const overlapTieBreaker: OverlapTieBreaker = {
  priority: [
    'higherConfidenceScore',
    'tighterPRZ',
    'lowerMeanRatioError',
    'earlierCompletion',
  ],
  fallback: 'firstDetected',
};
