import type { Pool } from "pg";

import {
  writePoliticsNomineeLimitedProdArtifacts,
  type PoliticsNomineeLimitedProdReadinessArtifacts
} from "../operations/semantic-expansion/politics-nominee-limited-prod-readiness.js";
import { runPoliticsNominee2028DemocraticPairMatcherPass } from "./politics-nominee-2028-democratic-pair-matcher.js";
import { runPoliticsNominee2028PairMatcherEvalPass } from "./politics-nominee-2028-pair-matcher-eval.js";
import { runPoliticsNominee2028RepublicanPairMatcherPass } from "./politics-nominee-2028-republican-pair-matcher.js";
import { runPoliticsNominee2028RepublicanPairReviewPackagePass } from "./politics-nominee-2028-republican-pair-review-package.js";
import { runPoliticsNominee2028RepublicanTriMatcherPass } from "./politics-nominee-2028-republican-tri-matcher.js";
import { runPoliticsNominee2028RepublicanTriReviewPackagePass } from "./politics-nominee-2028-republican-tri-review-package.js";

export interface PoliticsNomineeLimitedProdReadinessRunResult {
  pairEval: Awaited<ReturnType<typeof runPoliticsNominee2028PairMatcherEvalPass>>;
  democraticPairMatcher: Awaited<ReturnType<typeof runPoliticsNominee2028DemocraticPairMatcherPass>>;
  republicanPairMatcher: Awaited<ReturnType<typeof runPoliticsNominee2028RepublicanPairMatcherPass>>;
  republicanPairReview: Awaited<ReturnType<typeof runPoliticsNominee2028RepublicanPairReviewPackagePass>>;
  republicanTriMatcher: Awaited<ReturnType<typeof runPoliticsNominee2028RepublicanTriMatcherPass>>;
  republicanTriReview: Awaited<ReturnType<typeof runPoliticsNominee2028RepublicanTriReviewPackagePass>>;
  artifacts: PoliticsNomineeLimitedProdReadinessArtifacts;
}

export const runPoliticsNomineeLimitedProdReadinessPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNomineeLimitedProdReadinessRunResult> => {
  const pairEval = await runPoliticsNominee2028PairMatcherEvalPass(input);
  const democraticPairMatcher = await runPoliticsNominee2028DemocraticPairMatcherPass(input);
  const republicanPairMatcher = await runPoliticsNominee2028RepublicanPairMatcherPass(input);
  const republicanPairReview = await runPoliticsNominee2028RepublicanPairReviewPackagePass(input);
  const republicanTriMatcher = await runPoliticsNominee2028RepublicanTriMatcherPass(input);
  const republicanTriReview = await runPoliticsNominee2028RepublicanTriReviewPackagePass(input);
  const artifacts = writePoliticsNomineeLimitedProdArtifacts(input.repoRoot);

  return {
    pairEval,
    democraticPairMatcher,
    republicanPairMatcher,
    republicanPairReview,
    republicanTriMatcher,
    republicanTriReview,
    artifacts
  };
};
