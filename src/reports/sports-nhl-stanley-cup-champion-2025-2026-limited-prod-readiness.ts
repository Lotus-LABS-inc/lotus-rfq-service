import {
  loadSportsNhlStanleyCupChampion20252026MatcherArtifacts,
  writeSportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts,
  type SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-nhl-stanley-cup-champion-2025-2026-limited-prod-readiness.js";

export interface SportsNhlStanleyCupChampion20252026LimitedProdReadinessRunResult
  extends SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts {}

export const runSportsNhlStanleyCupChampion20252026LimitedProdReadiness = async (input: {
  repoRoot: string;
}): Promise<SportsNhlStanleyCupChampion20252026LimitedProdReadinessRunResult> => {
  const matcherArtifacts = loadSportsNhlStanleyCupChampion20252026MatcherArtifacts(input.repoRoot);
  return writeSportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
