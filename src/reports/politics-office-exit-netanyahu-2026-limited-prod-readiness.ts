import type { Pool } from "pg";

import {
  loadPoliticsOfficeExitNetanyahu2026MatcherArtifacts,
  writePoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts,
  type PoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/politics-office-exit-netanyahu-2026-limited-prod-readiness.js";

export interface PoliticsOfficeExitNetanyahu2026LimitedProdReadinessRunResult {
  artifacts: PoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts;
}

export const runPoliticsOfficeExitNetanyahu2026LimitedProdReadinessPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeExitNetanyahu2026LimitedProdReadinessRunResult> => {
  void input.pool;
  const matcherArtifacts = loadPoliticsOfficeExitNetanyahu2026MatcherArtifacts(input.repoRoot);
  const artifacts = writePoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });

  return {
    artifacts
  };
};
