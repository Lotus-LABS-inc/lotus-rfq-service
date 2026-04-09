import { readArtifact } from "../operations/semantic-expansion/shared.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { buildPoliticsNomineeLivePassArtifacts, type PoliticsNomineeLivePassArtifacts } from "../matching/politics/politics-nominee-live-pass.js";

export const buildPoliticsNomineeLivePassArtifactsFromRepository = async (input: {
  repository: Pick<PairEdgeRepository, "listMatchingMarkets">;
  repoRoot?: string;
}): Promise<PoliticsNomineeLivePassArtifacts> => {
  const markets = await input.repository.listMatchingMarkets();
  const priorNomineeRows = input.repoRoot
    ? (() => {
        try {
          const priorSummary = readArtifact<{ families?: Record<string, { venueCounts?: Record<string, number>; totalRows?: number }> }>(
            input.repoRoot,
            "docs/politics-family-proof-summary.json"
          );
          const family = priorSummary["families"]?.["NOMINEE_WINNER"];
          return typeof family?.totalRows === "number" ? family.totalRows : 0;
        } catch {
          return 0;
        }
      })()
    : 0;
  const priorEligibility = input.repoRoot
    ? (() => {
        try {
          const eligibility = readArtifact<Record<string, { eligibility?: string }>>(
            input.repoRoot,
            "docs/politics-family-eligibility-summary.json"
          );
          return eligibility["NOMINEE_WINNER"]?.eligibility ?? "BASIS_FRAGMENTED";
        } catch {
          return "BASIS_FRAGMENTED";
        }
      })()
    : "BASIS_FRAGMENTED";

  return buildPoliticsNomineeLivePassArtifacts(markets, {
    priorNomineeRows,
    priorEligibility
  });
};
