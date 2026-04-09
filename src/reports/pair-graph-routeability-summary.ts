import type { Pool } from "pg";

import { MatchingPipeline } from "../matching/matching-pipeline.js";
import { listRouteablePairEdges } from "../matching/pair-graph.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";

export interface PairGraphRouteabilitySummary {
  observedAt: string;
  matchingVersionId: string;
  routeablePairsByFamily: Record<string, number>;
  routeablePairsByBasis: Record<string, number>;
  labels: Record<string, number>;
  tri: {
    exactSafeCount: number;
    blockerReasons: Record<string, number>;
  };
}

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

export const buildPairGraphRouteabilitySummary = async (
  pool: Pool,
  options: { refresh?: boolean } = {}
): Promise<PairGraphRouteabilitySummary> => {
  const repository = new PairEdgeRepository(pool);
  const pipeline = new MatchingPipeline(repository);
  const pipelineResult = options.refresh ? await pipeline.run() : await pipeline.run();
  const routeablePairs = listRouteablePairEdges({
    nodes: new Map(),
    edges: pipelineResult.pairEdges
  });
  const routeablePairsByFamily: Record<string, number> = {};
  const routeablePairsByBasis: Record<string, number> = {};
  const labels: Record<string, number> = {};
  const triBlockers: Record<string, number> = {};

  for (const edge of pipelineResult.pairEdges) {
    increment(labels, edge.label);
  }
  for (const edge of routeablePairs) {
    increment(routeablePairsByFamily, edge.family);
    increment(routeablePairsByBasis, edge.temporalBasis);
  }
  for (const tri of pipelineResult.triCandidates) {
    for (const blocker of tri.blockerReasons) {
      increment(triBlockers, blocker);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    matchingVersionId: pipelineResult.matchingVersion.id,
    routeablePairsByFamily,
    routeablePairsByBasis,
    labels,
    tri: {
      exactSafeCount: pipelineResult.triCandidates.filter((candidate) => candidate.exactSafe).length,
      blockerReasons: triBlockers
    }
  };
};
