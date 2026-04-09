import {
  loadSportsEplWinner20252026MatcherArtifacts,
  writeSportsEplWinner20252026LimitedProdReadinessArtifacts,
  type SportsEplWinner20252026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-epl-winner-2025-2026-limited-prod-readiness.js";

export const runSportsEplWinner20252026LimitedProdReadinessPass = async (input: {
  repoRoot: string;
}): Promise<SportsEplWinner20252026LimitedProdReadinessArtifacts> => {
  const matcherArtifacts = loadSportsEplWinner20252026MatcherArtifacts(input.repoRoot);
  return writeSportsEplWinner20252026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
