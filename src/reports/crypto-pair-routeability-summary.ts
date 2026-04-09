import type { Pool } from "pg";

import { CryptoMatchingPipeline } from "../matching/crypto/crypto-matching-pipeline.js";
import { listRouteableCryptoPairEdges } from "../matching/crypto/crypto-pair-graph.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";

export interface CryptoPairRouteabilitySummary {
  observedAt: string;
  matchingVersionId: string;
  sourceCryptoMarketCount: number;
  btcEligibleStructuralMarketCount: number;
  pairEdgeCount: number;
  routeablePairsByFamily: Record<string, number>;
  routeablePairsByVenuePair: Record<string, number>;
  labelDistribution: Record<string, number>;
  exactSafeApprovedCount: number;
  triCapableFamilies: readonly string[];
  blockerReasons: Record<string, number>;
  mismatchDistributions: {
    dateBoundaryMismatch: number;
    cutoffMismatch: number;
    thresholdStructureMismatch: number;
    familyMismatch: number;
  };
}

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const buildVenuePairKey = (leftVenue: string, rightVenue: string): string =>
  leftVenue.localeCompare(rightVenue) <= 0 ? `${leftVenue}_${rightVenue}` : `${rightVenue}_${leftVenue}`;

export const buildCryptoPairRouteabilitySummary = async (
  pool: Pool
): Promise<CryptoPairRouteabilitySummary> => {
  const pipeline = new CryptoMatchingPipeline(new PairEdgeRepository(pool));
  const result = await pipeline.run();
  const routeablePairs = listRouteableCryptoPairEdges(result.pairGraph);
  const routeablePairsByFamily: Record<string, number> = {};
  const routeablePairsByVenuePair: Record<string, number> = {};
  const labelDistribution: Record<string, number> = {};
  const blockerReasons: Record<string, number> = {};

  for (const edge of result.pairEdges) {
    increment(labelDistribution, edge.label);
  }
  for (const edge of routeablePairs) {
    increment(routeablePairsByFamily, edge.family);
    increment(routeablePairsByVenuePair, buildVenuePairKey(edge.leftVenue, edge.rightVenue));
  }
  for (const reason of result.candidateRejectionReasons) {
    increment(blockerReasons, reason);
  }

  const triFamilyPairs = new Map<string, Set<string>>();
  for (const edge of routeablePairs) {
    const set = triFamilyPairs.get(edge.family) ?? new Set<string>();
    set.add(buildVenuePairKey(edge.leftVenue, edge.rightVenue));
    triFamilyPairs.set(edge.family, set);
  }
  const triCapableFamilies = [...triFamilyPairs.entries()]
    .filter(([, pairs]) => pairs.size === 3)
    .map(([family]) => family)
    .sort();

  return {
    observedAt: new Date().toISOString(),
    matchingVersionId: result.matchingVersion.id,
    sourceCryptoMarketCount: result.classifiedMarkets.length,
    btcEligibleStructuralMarketCount: result.btcMarkets.length,
    pairEdgeCount: result.pairEdges.length,
    routeablePairsByFamily,
    routeablePairsByVenuePair,
    labelDistribution,
    exactSafeApprovedCount: routeablePairs.length,
    triCapableFamilies,
    blockerReasons,
    mismatchDistributions: {
      dateBoundaryMismatch: blockerReasons["DATE_BOUNDARY_MISMATCH"] ?? 0,
      cutoffMismatch: blockerReasons["CUTOFF_MISMATCH"] ?? 0,
      thresholdStructureMismatch: blockerReasons["THRESHOLD_STRUCTURE_MISMATCH"] ?? 0,
      familyMismatch: blockerReasons["FAMILY_MISMATCH"] ?? 0
    }
  };
};
