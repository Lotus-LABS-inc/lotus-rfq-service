export interface LPReliabilityProfile {
  lpId: string;
  avgResponseTimeMs: number;
  quoteHitRate: number;
  rejectRate: number;
  executionFailRate: number;
  competitivenessScore: number;
  totalQuotes: number;
  totalExecutions: number;
}

export interface ReliabilityWeights {
  reliabilityWeight: number;
  latencyWeight: number;
  failureWeight: number;
}

export interface ReliabilityScoreInput {
  effectivePrice: number;
  profile?: LPReliabilityProfile;
  weights?: Partial<ReliabilityWeights>;
}

export interface ReliabilityScoreResult {
  score: number;
  reliabilityBonus: number;
  latencyBonus: number;
  failurePenalty: number;
}

const DEFAULT_WEIGHTS: ReliabilityWeights = {
  reliabilityWeight: 0.05,
  latencyWeight: 0.03,
  failureWeight: 0.08
};

const MAX_ADJUSTMENT_RATIO = 0.1;
const MAX_LATENCY_MS = 5000;

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const clampRate = (value: number): number => clamp(value, 0, 1);

const normalizeLatency = (avgResponseTimeMs: number): number => {
  const bounded = clamp(avgResponseTimeMs, 0, MAX_LATENCY_MS);
  return 1 - bounded / MAX_LATENCY_MS;
};

export const resolveReliabilityWeights = (
  overrides?: Partial<ReliabilityWeights>
): ReliabilityWeights => {
  return {
    reliabilityWeight: clamp(overrides?.reliabilityWeight ?? DEFAULT_WEIGHTS.reliabilityWeight, 0, 0.2),
    latencyWeight: clamp(overrides?.latencyWeight ?? DEFAULT_WEIGHTS.latencyWeight, 0, 0.2),
    failureWeight: clamp(overrides?.failureWeight ?? DEFAULT_WEIGHTS.failureWeight, 0, 0.2)
  };
};

export const computeReliabilityScore = (input: ReliabilityScoreInput): ReliabilityScoreResult => {
  const weights = resolveReliabilityWeights(input.weights);
  const effectivePrice = Math.max(0, input.effectivePrice);
  const profile = input.profile;

  if (!profile) {
    return {
      score: effectivePrice,
      reliabilityBonus: 0,
      latencyBonus: 0,
      failurePenalty: 0
    };
  }

  const quoteHitRate = clampRate(profile.quoteHitRate);
  const rejectRate = clampRate(profile.rejectRate);
  const executionFailRate = clampRate(profile.executionFailRate);
  const competitivenessScore = clampRate(profile.competitivenessScore);
  const latencyScore = normalizeLatency(profile.avgResponseTimeMs);

  const reliabilityBonus = effectivePrice * weights.reliabilityWeight * quoteHitRate * competitivenessScore;
  const latencyBonus = effectivePrice * weights.latencyWeight * latencyScore;
  const failurePenalty =
    effectivePrice * weights.failureWeight * (executionFailRate + rejectRate * 0.5);

  const maxAdjustment = effectivePrice * MAX_ADJUSTMENT_RATIO;
  const boundedReliabilityBonus = clamp(reliabilityBonus, 0, maxAdjustment);
  const boundedLatencyBonus = clamp(latencyBonus, 0, maxAdjustment);
  const boundedFailurePenalty = clamp(failurePenalty, 0, maxAdjustment);

  const totalAdjustment = -boundedReliabilityBonus - boundedLatencyBonus + boundedFailurePenalty;
  const boundedTotalAdjustment = clamp(totalAdjustment, -maxAdjustment, maxAdjustment);

  const score = effectivePrice + boundedTotalAdjustment;

  return {
    score,
    reliabilityBonus: boundedReliabilityBonus,
    latencyBonus: boundedLatencyBonus,
    failurePenalty: boundedFailurePenalty
  };
};
