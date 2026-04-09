import type { Pool } from "pg";

import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { MatchingPipeline } from "../matching/matching-pipeline.js";

export interface MatchingQualitySummary {
  observedAt: string;
  matchingVersionId: string;
  marketCount: number;
  pairEdgeCount: number;
  labels: Record<string, number>;
  families: Record<string, { exact: number; equivalent: number; similar: number; different: number }>;
  bases: Record<string, number>;
  candidateRejectionReasons: Record<string, number>;
  crypto: {
    pairEdgeCount: number;
    exactApprovedCount: number;
    equivalentPendingCount: number;
  };
}

const increment = <T extends string>(target: Record<T, number>, key: T): void => {
  target[key] = (target[key] ?? 0) + 1;
};

export const buildMatchingQualitySummary = async (
  pool: Pool,
  options: { refresh?: boolean } = {}
): Promise<MatchingQualitySummary> => {
  const repository = new PairEdgeRepository(pool);
  const pipeline = new MatchingPipeline(repository);
  const pipelineResult = options.refresh ? await pipeline.run() : await pipeline.run();

  const labels: Record<string, number> = {};
  const bases: Record<string, number> = {};
  const families: Record<string, { exact: number; equivalent: number; similar: number; different: number }> = {};
  const candidateRejectionReasons: Record<string, number> = {};

  for (const edge of pipelineResult.pairEdges) {
    increment(labels, edge.label);
    increment(bases, edge.temporalBasis);
    const family = families[edge.family] ?? { exact: 0, equivalent: 0, similar: 0, different: 0 };
    if (edge.label === "EXACT") family.exact += 1;
    if (edge.label === "EQUIVALENT") family.equivalent += 1;
    if (edge.label === "SIMILAR") family.similar += 1;
    if (edge.label === "DIFFERENT") family.different += 1;
    families[edge.family] = family;
  }

  for (const reason of pipelineResult.candidateRejectionReasons) {
    increment(candidateRejectionReasons, reason);
  }

  const cryptoEdges = pipelineResult.pairEdges.filter((edge) => edge.family.includes("DATE") || edge.family.includes("DIRECTIONAL") || edge.family.includes("PRICE"));

  return {
    observedAt: new Date().toISOString(),
    matchingVersionId: pipelineResult.matchingVersion.id,
    marketCount: pipelineResult.markets.length,
    pairEdgeCount: pipelineResult.pairEdges.length,
    labels,
    families,
    bases,
    candidateRejectionReasons,
    crypto: {
      pairEdgeCount: cryptoEdges.length,
      exactApprovedCount: cryptoEdges.filter((edge) => edge.label === "EXACT" && (edge.approvalState === "approved" || edge.approvalState === "autoApproved")).length,
      equivalentPendingCount: cryptoEdges.filter((edge) => edge.label === "EQUIVALENT" && edge.approvalState === "pendingReview").length
    }
  };
};
