import type { Pool } from "pg";

import { CryptoMatchingPipeline } from "../matching/crypto/crypto-matching-pipeline.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";

export interface CryptoMatchingQualitySummary {
  observedAt: string;
  matchingVersionId: string;
  sourceCryptoMarketCount: number;
  btcMarketCount: number;
  pairEdgeCount: number;
  labels: Record<string, number>;
  families: Record<string, number>;
  venuePairs: Record<string, number>;
  blockerReasons: Record<string, number>;
  structuralLaneRejections: Record<string, number>;
}

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const buildVenuePairKey = (leftVenue: string, rightVenue: string): string =>
  leftVenue.localeCompare(rightVenue) <= 0 ? `${leftVenue}_${rightVenue}` : `${rightVenue}_${leftVenue}`;

export const buildCryptoMatchingQualitySummary = async (
  pool: Pool
): Promise<CryptoMatchingQualitySummary> => {
  const pipeline = new CryptoMatchingPipeline(new PairEdgeRepository(pool));
  const result = await pipeline.run();
  const labels: Record<string, number> = {};
  const families: Record<string, number> = {};
  const venuePairs: Record<string, number> = {};
  const blockerReasons: Record<string, number> = {};
  const structuralLaneRejections: Record<string, number> = {};

  for (const edge of result.pairEdges) {
    increment(labels, edge.label);
    increment(families, edge.family);
    increment(venuePairs, buildVenuePairKey(edge.leftVenue, edge.rightVenue));
  }
  for (const reason of result.candidateRejectionReasons) {
    increment(blockerReasons, reason);
  }
  for (const reason of result.structuralLaneRejections) {
    increment(structuralLaneRejections, reason);
  }

  return {
    observedAt: new Date().toISOString(),
    matchingVersionId: result.matchingVersion.id,
    sourceCryptoMarketCount: result.classifiedMarkets.length,
    btcMarketCount: result.btcMarkets.length,
    pairEdgeCount: result.pairEdges.length,
    labels,
    families,
    venuePairs,
    blockerReasons,
    structuralLaneRejections
  };
};

