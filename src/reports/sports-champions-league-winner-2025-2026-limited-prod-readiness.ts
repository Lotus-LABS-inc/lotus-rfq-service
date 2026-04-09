import {
  loadSportsChampionsLeagueWinner20252026MatcherArtifacts,
  writeSportsChampionsLeagueWinner20252026LimitedProdReadinessArtifacts,
  type SportsChampionsLeagueWinner20252026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-champions-league-winner-2025-2026-limited-prod-readiness.js";

export const runSportsChampionsLeagueWinner20252026LimitedProdReadinessPass = async (input: {
  repoRoot: string;
}): Promise<SportsChampionsLeagueWinner20252026LimitedProdReadinessArtifacts> => {
  const matcherArtifacts = loadSportsChampionsLeagueWinner20252026MatcherArtifacts(input.repoRoot);
  return writeSportsChampionsLeagueWinner20252026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
