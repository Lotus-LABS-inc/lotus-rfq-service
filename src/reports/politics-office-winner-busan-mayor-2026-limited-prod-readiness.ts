import type { Pool } from "pg";

import type { PoliticsOfficeWinnerBusanMayor2026MatcherFinalDecision } from "../matching/politics/politics-types.js";
import {
  writePoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts,
  type PoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/politics-office-winner-busan-mayor-2026-limited-prod-readiness.js";
import { runPoliticsOfficeWinnerBusanMayor2026MatcherPass } from "./politics-office-winner-busan-mayor-2026-matcher.js";

export interface PoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessRunResult {
  officeWinnerMatcher: Awaited<ReturnType<typeof runPoliticsOfficeWinnerBusanMayor2026MatcherPass>>;
  artifacts: PoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts;
}

export const runPoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessRunResult> => {
  const officeWinnerMatcher = await runPoliticsOfficeWinnerBusanMayor2026MatcherPass(input);
  const artifacts = writePoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    inputSummary: officeWinnerMatcher.inputSummary as {
      exactTopic: string;
      refreshedRowsUsed: unknown;
      familyComparabilitySourceArtifacts: Record<string, string>;
      admittedVenues: string[];
      admittedCandidates: string[];
    },
    lanes: officeWinnerMatcher.lanes as {
      canonicalTopicKey: string;
      bestPair: string | null;
      matcherLanes: {
        venuePair: string;
        candidate: string;
        canonicalTopic: string;
        routeabilityDecision: string;
        rulesDecision: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING" | "REVIEW_REQUIRED_RULE_VARIANCE" | "RULES_MATERIALLY_INCOMPATIBLE" | "UNKNOWN_RULE_MEANING";
        evidence: {
          venue: string;
          venueMarketId: string;
          rawOutcomeLabel: string;
        }[];
        evidenceNotes: string[];
      }[];
    },
    rejections: officeWinnerMatcher.rejections as {
      rejections: {
        scope: "candidate" | "lane" | "venue";
        candidateIdentityKey?: string | null;
        normalizedCandidateName?: string | null;
        venuePair?: string | null;
        venue?: string | null;
        reason: string;
        notes: string;
      }[];
    },
    finalDecision: officeWinnerMatcher.finalDecision as unknown as PoliticsOfficeWinnerBusanMayor2026MatcherFinalDecision
  });

  return {
    officeWinnerMatcher,
    artifacts
  };
};
