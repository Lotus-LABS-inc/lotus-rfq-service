import {
  loadSportsWorldCupWinner2026MatcherArtifacts,
  writeSportsWorldCupWinner2026LimitedProdReadinessArtifacts,
  type SportsWorldCupWinner2026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-world-cup-winner-2026-limited-prod-readiness.js";

export const runSportsWorldCupWinner2026LimitedProdReadinessPass = async (input: {
  repoRoot: string;
}): Promise<SportsWorldCupWinner2026LimitedProdReadinessArtifacts> => {
  const matcherArtifacts = loadSportsWorldCupWinner2026MatcherArtifacts(input.repoRoot);
  return writeSportsWorldCupWinner2026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
