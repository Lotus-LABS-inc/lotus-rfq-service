import type { Pool } from "pg";

import type { PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision } from "../matching/politics/politics-types.js";
import {
  writePoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts,
  type PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/politics-office-winner-us-president-2028-limited-prod-readiness.js";
import { runPoliticsOfficeWinnerUsPresident2028MatcherPass } from "./politics-office-winner-us-president-2028-matcher.js";

export interface PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessRunResult {
  officeWinnerMatcher: Awaited<ReturnType<typeof runPoliticsOfficeWinnerUsPresident2028MatcherPass>>;
  artifacts: PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts;
}

export const runPoliticsOfficeWinnerUsPresident2028LimitedProdReadinessPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessRunResult> => {
  const officeWinnerMatcher = await runPoliticsOfficeWinnerUsPresident2028MatcherPass(input);
  const artifacts = writePoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts({
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
    finalDecision: officeWinnerMatcher.finalDecision as unknown as PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision
  });

  return {
    officeWinnerMatcher,
    artifacts
  };
};
