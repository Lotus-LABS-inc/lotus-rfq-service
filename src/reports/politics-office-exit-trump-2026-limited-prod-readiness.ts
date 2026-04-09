import type { Pool } from "pg";

import {
  loadPoliticsOfficeExitTrump2026MatcherArtifacts,
  writePoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts,
  type PoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/politics-office-exit-trump-2026-limited-prod-readiness.js";

export interface PoliticsOfficeExitTrump2026LimitedProdReadinessRunResult {
  artifacts: PoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts;
}

export const runPoliticsOfficeExitTrump2026LimitedProdReadinessPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeExitTrump2026LimitedProdReadinessRunResult> => {
  void input.pool;
  const matcherArtifacts = loadPoliticsOfficeExitTrump2026MatcherArtifacts(input.repoRoot);
  const artifacts = writePoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });

  return {
    artifacts
  };
};


