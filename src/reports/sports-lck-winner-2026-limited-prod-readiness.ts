import {
  loadSportsLckWinner2026MatcherArtifacts,
  writeSportsLckWinner2026LimitedProdReadinessArtifacts,
  type SportsLckWinner2026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-lck-winner-2026-limited-prod-readiness.js";

export interface SportsLckWinner2026LimitedProdReadinessRunResult
  extends SportsLckWinner2026LimitedProdReadinessArtifacts {}

export const runSportsLckWinner2026LimitedProdReadiness = async (input: {
  repoRoot: string;
}): Promise<SportsLckWinner2026LimitedProdReadinessRunResult> => {
  const matcherArtifacts = loadSportsLckWinner2026MatcherArtifacts(input.repoRoot);
  return writeSportsLckWinner2026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
