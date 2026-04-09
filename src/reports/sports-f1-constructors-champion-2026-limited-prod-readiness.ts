import {
  loadSportsF1ConstructorsChampion2026MatcherArtifacts,
  writeSportsF1ConstructorsChampion2026LimitedProdReadinessArtifacts,
  type SportsF1ConstructorsChampion2026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-f1-constructors-champion-2026-limited-prod-readiness.js";

export const runSportsF1ConstructorsChampion2026LimitedProdReadinessPass = async (input: {
  repoRoot: string;
}): Promise<SportsF1ConstructorsChampion2026LimitedProdReadinessArtifacts> => {
  const matcherArtifacts = loadSportsF1ConstructorsChampion2026MatcherArtifacts(input.repoRoot);
  return writeSportsF1ConstructorsChampion2026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
