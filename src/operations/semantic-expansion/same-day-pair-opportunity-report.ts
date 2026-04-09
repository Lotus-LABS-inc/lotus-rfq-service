import type { Pool } from "pg";

import { buildPairFamilyExactnessReport } from "./pair-family-exactness-report.js";
import { writeArtifact } from "./shared.js";

export interface SameDayPairOpportunityReport {
  observedAt: string;
  sourcePairFamilyReportPath: string;
  families: ReadonlyArray<{
    pairFamily: string;
    searchableSeedCount: number;
    exactDateFoundCount: number;
    wrongDateFoundCount: number;
    missingInventoryCount: number;
    evidenceGapCount: number;
    compatibilityGapCount: number;
    seeds: ReadonlyArray<{
      seedReference: string;
      title: string;
      exactDateKey: string | null;
      exactDateSearchable: boolean;
      exactDateStatus: string;
      status: string;
      venueAvailability: Record<string, "present" | "missing">;
      acquisitionSignals: ReadonlyArray<{
        venue: string;
        venueMarketId: string;
        exactDateAcquisition: boolean;
        curatedFallbackUsed: boolean;
      }>;
      predictReadiness: ReadonlyArray<{
        venueMarketId: string;
        state: string;
        historicalQualified: boolean;
        reason: string | null;
      }>;
      oneEdgeAwayFromTriEligibility: boolean;
    }>;
  }>;
}

export const buildSameDayPairOpportunityReport = async (input: {
  repoRoot: string;
  pool: Pool;
}): Promise<SameDayPairOpportunityReport> => {
  const pairFamilyReport = await buildPairFamilyExactnessReport(input);

  const report: SameDayPairOpportunityReport = {
    observedAt: new Date().toISOString(),
    sourcePairFamilyReportPath: "docs/pair-family-exactness-report.json",
    families: pairFamilyReport.families.map((family) => {
      const seeds = family.seeds.map((seed) => {
        const familyVenues = new Set(family.venues);
        const presentCandidateVenues = new Set(seed.selectedCandidates.map((candidate) => candidate.venue));
        const venueAvailability = Object.fromEntries(
          family.venues.map((venue) => [
            venue,
            seed.memberVenues.includes(venue) || presentCandidateVenues.has(venue) ? "present" : "missing"
          ])
        ) as Record<string, "present" | "missing">;

        return {
          seedReference: seed.seedReference,
          title: seed.title,
          exactDateKey: seed.exactDateKey,
          exactDateSearchable: seed.exactDateSearchable,
          exactDateStatus: seed.exactDateStatus,
          status: seed.status,
          venueAvailability,
          acquisitionSignals: seed.selectedCandidates.map((candidate) => ({
            venue: candidate.venue,
            venueMarketId: candidate.venueMarketId,
            exactDateAcquisition: candidate.acquisitionProvenance?.exactDateAcquisition ?? false,
            curatedFallbackUsed: candidate.acquisitionProvenance?.curatedFallbackUsed ?? false
          })),
          predictReadiness: seed.selectedCandidates
            .filter((candidate) => candidate.predictReadiness !== null)
            .map((candidate) => ({
              venueMarketId: candidate.venueMarketId,
              state: candidate.predictReadiness!.state,
              historicalQualified: candidate.predictReadiness!.historicalQualified,
              reason: candidate.predictReadiness!.reason
            })),
          oneEdgeAwayFromTriEligibility: seed.oneEdgeAwayFromTriEligibility && [...familyVenues].every((venue) => venueAvailability[venue] === "present")
        };
      });

      return {
        pairFamily: family.pairFamily,
        searchableSeedCount: family.exactDateSummary.searchableSeedCount,
        exactDateFoundCount: family.exactDateSummary.exactDateFoundCount,
        wrongDateFoundCount: family.exactDateSummary.wrongDateFoundCount,
        missingInventoryCount: seeds.filter((seed) => seed.exactDateStatus === "no_candidate_found").length,
        evidenceGapCount: seeds.filter((seed) =>
          seed.predictReadiness.some((readiness) => readiness.historicalQualified === false)
        ).length,
        compatibilityGapCount: seeds.filter((seed) => seed.status === "blocked_by_compatibility").length,
        seeds
      };
    })
  };

  writeArtifact(input.repoRoot, "docs/same-day-pair-opportunity-report.json", report);
  return report;
};
