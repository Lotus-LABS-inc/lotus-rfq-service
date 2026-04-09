import {
  loadSportsLaLigaWinner20252026MatcherArtifacts,
  writeSportsLaLigaWinner20252026LimitedProdReadinessArtifacts,
  type SportsLaLigaWinner20252026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/sports-la-liga-winner-2025-2026-limited-prod-readiness.js";

export const runSportsLaLigaWinner20252026LimitedProdReadinessPass = async (input: {
  repoRoot: string;
}): Promise<SportsLaLigaWinner20252026LimitedProdReadinessArtifacts> => {
  const matcherArtifacts = loadSportsLaLigaWinner20252026MatcherArtifacts(input.repoRoot);
  return writeSportsLaLigaWinner20252026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    ...matcherArtifacts
  });
};
