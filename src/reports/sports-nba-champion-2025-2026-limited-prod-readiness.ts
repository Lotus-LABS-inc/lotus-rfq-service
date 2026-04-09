import {
  loadSportsNbaChampion20252026MatcherArtifacts,
  writeSportsNbaChampion20252026LimitedProdReadinessArtifacts,
  type SportsNbaChampion20252026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-nba-champion-2025-2026-limited-prod-readiness.js";

export const runSportsNbaChampion20252026LimitedProdReadinessPass = async (input: {
  repoRoot: string;
}): Promise<SportsNbaChampion20252026LimitedProdReadinessArtifacts> => {
  const matcherArtifacts = loadSportsNbaChampion20252026MatcherArtifacts(input.repoRoot);
  return writeSportsNbaChampion20252026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
