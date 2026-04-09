import type { Pool } from "pg";

import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeRuleCompatibilityClass
} from "../matching/politics/politics-types.js";
import {
  writePoliticsNominee2028DemocraticLimitedProdReadinessArtifacts,
  type PoliticsNominee2028DemocraticLimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/politics-nominee-2028-democratic-limited-prod-readiness.js";
import { runPoliticsNominee2028DemocraticPairMatcherPass } from "./politics-nominee-2028-democratic-pair-matcher.js";

export interface PoliticsNominee2028DemocraticLimitedProdReadinessRunResult {
  democraticPairMatcher: Awaited<ReturnType<typeof runPoliticsNominee2028DemocraticPairMatcherPass>>;
  artifacts: PoliticsNominee2028DemocraticLimitedProdReadinessArtifacts;
}

export const runPoliticsNominee2028DemocraticLimitedProdReadinessPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028DemocraticLimitedProdReadinessRunResult> => {
  const democraticPairMatcher = await runPoliticsNominee2028DemocraticPairMatcherPass(input);
  const artifacts = writePoliticsNominee2028DemocraticLimitedProdReadinessArtifacts({
    repoRoot: input.repoRoot,
    inputSummary: democraticPairMatcher.inputSummary as {
      topicKey: string;
      refreshedRowsUsed: unknown;
      admittedVenues: string[];
      admittedCandidates: string[];
    },
    lanes: democraticPairMatcher.lanes as {
      topicKey: string;
      bestPair: string | null;
      matcherLanes: {
        venuePair: string;
        candidate: string;
        canonicalTopic: string;
        routeabilityDecision: string;
        rulesDecision: PoliticsNomineeRuleCompatibilityClass;
        evidence: {
          venue: string;
          venueMarketId: string;
          rawOutcomeLabel: string;
        }[];
        evidenceNotes: string[];
      }[];
    },
    rejections: democraticPairMatcher.rejections as {
      rejections: {
        scope: "candidate" | "lane";
        candidateIdentityKey?: string | null;
        normalizedCandidateName?: string | null;
        venuePair?: string | null;
        reason: string;
        notes: string;
      }[];
    },
    finalDecision: democraticPairMatcher.finalDecision as unknown as PoliticsNomineeDemocraticPairMatcherFinalDecision
  });

  return {
    democraticPairMatcher,
    artifacts
  };
};
