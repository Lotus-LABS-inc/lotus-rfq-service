import {
  loadSportsLplWinner2026MatcherArtifacts,
  writeSportsLplWinner2026LimitedProdReadinessArtifacts,
  type SportsLplWinner2026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-lpl-winner-2026-limited-prod-readiness.js";

export interface SportsLplWinner2026LimitedProdReadinessRunResult
  extends SportsLplWinner2026LimitedProdReadinessArtifacts {}

export const runSportsLplWinner2026LimitedProdReadiness = async (input: {
  repoRoot: string;
}): Promise<SportsLplWinner2026LimitedProdReadinessRunResult> => {
  const matcherArtifacts = loadSportsLplWinner2026MatcherArtifacts(input.repoRoot);
  return writeSportsLplWinner2026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
