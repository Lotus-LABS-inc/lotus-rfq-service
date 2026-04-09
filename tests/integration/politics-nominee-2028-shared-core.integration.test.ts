import { describe, expect, it } from "vitest";

import {
  buildNominee2028SharedCoreFinalDecision,
  buildNominee2028SharedOutcomeCore,
  buildNominee2028TopicDecision
} from "../../src/matching/politics/politics-nominee-2028-shared-core.js";
import type {
  PoliticsNomineeSharedCoreMarketRow,
  PoliticsNomineeSharedCoreOutcomeRow
} from "../../src/matching/politics/politics-types.js";

const market = (
  venue: PoliticsNomineeSharedCoreMarketRow["venue"],
  topicKey: PoliticsNomineeSharedCoreMarketRow["topicKey"],
  ruleCompatibilityClass: PoliticsNomineeSharedCoreMarketRow["ruleCompatibilityClass"] = "EXACT_RULE_COMPATIBLE"
): PoliticsNomineeSharedCoreMarketRow => ({
  interpretedContractId: `${venue}-${topicKey}`,
  venue,
  venueMarketId: `${venue}-${topicKey}`,
  title: topicKey.endsWith("REPUBLICAN")
    ? "Who will be the Republican nominee for U.S. president in 2028?"
    : "Who will be the Democratic nominee for U.S. president in 2028?",
  topicKey,
  canonicalFamily: "NOMINEE_WINNER",
  canonicalOffice: "US_PRESIDENT",
  canonicalJurisdiction: "USA",
  canonicalCycle: "2028",
  canonicalParty: topicKey.endsWith("REPUBLICAN") ? "REPUBLICAN" : "DEMOCRATIC",
  canonicalTopicLabel: topicKey.endsWith("REPUBLICAN") ? "Republican Presidential Nominee 2028" : "Democratic Presidential Nominee 2028",
  canonicalResolutionMeaning: "PRESIDENTIAL_NOMINEE_WINNER",
  canonicalResolutionSourceType: "TITLE_AND_RULES",
  interpretationConfidence: "HIGH",
  interpretationNotes: [],
  ruleCompatibilityClass,
  rejectionReason: null,
  candidateMenuType: "FIELD_MULTI_CANDIDATE",
  hasOthersBucket: false,
  fullMenuKnown: true,
  fullMenuComparable: true,
  partialMenuComparable: false,
  reviewRequired: ruleCompatibilityClass === "REVIEW_REQUIRED_RULE_VARIANCE",
  materiallyIncompatible: ruleCompatibilityClass === "RULES_MATERIALLY_INCOMPATIBLE"
});

const outcome = (
  venue: PoliticsNomineeSharedCoreOutcomeRow["venue"],
  topicKey: PoliticsNomineeSharedCoreOutcomeRow["topicKey"],
  candidateIdentityKey: string,
  routeabilityClass: PoliticsNomineeSharedCoreOutcomeRow["routeabilityClass"] = "EXCLUDED_UNKNOWN"
): PoliticsNomineeSharedCoreOutcomeRow => ({
  venue,
  venueMarketId: `${venue}-${topicKey}`,
  topicKey,
  rawOutcomeLabel: candidateIdentityKey.replace(/_/g, " "),
  normalizedCandidateName: candidateIdentityKey.replace(/_/g, " "),
  candidateIdentityKey,
  outcomeType: "NAMED_CANDIDATE",
  isNamedCandidate: true,
  isOthersBucket: false,
  sharedAcrossVenueCount: 0,
  sharedAcrossWhichVenues: [],
  routeabilityClass
});

describe("politics nominee 2028 shared core", () => {
  it("classifies a tri-shared named core as tri-ready", () => {
    const topicKey = "NOMINEE|US_PRESIDENT|2028|REPUBLICAN";
    const markets = [
      market("POLYMARKET", topicKey),
      market("OPINION", topicKey),
      market("LIMITLESS", topicKey)
    ];
    const core = buildNominee2028SharedOutcomeCore({
      topicKey,
      markets,
      outcomes: [
        outcome("POLYMARKET", topicKey, "donald_trump"),
        outcome("OPINION", topicKey, "donald_trump"),
        outcome("LIMITLESS", topicKey, "donald_trump")
      ]
    });
    const decision = buildNominee2028TopicDecision({ topicKey, markets, outcomeCore: core });

    expect(decision.topicDecision).toBe("TOPIC_SHARED_CORE_TRI_READY");
  });

  it("classifies a pair-shared core as pair-only when no tri-shared candidate exists", () => {
    const topicKey = "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC";
    const markets = [
      market("POLYMARKET", topicKey),
      market("OPINION", topicKey)
    ];
    const core = buildNominee2028SharedOutcomeCore({
      topicKey,
      markets,
      outcomes: [
        outcome("POLYMARKET", topicKey, "gavin_newsom"),
        outcome("OPINION", topicKey, "gavin_newsom"),
        outcome("POLYMARKET", topicKey, "wes_moore")
      ]
    });
    const decision = buildNominee2028TopicDecision({ topicKey, markets, outcomeCore: core });

    expect(decision.topicDecision).toBe("TOPIC_SHARED_CORE_PAIR_ONLY");
  });

  it("marks a topic single-venue-only when only one venue contributes", () => {
    const topicKey = "NOMINEE|US_PRESIDENT|2028|REPUBLICAN";
    const markets = [market("POLYMARKET", topicKey)];
    const core = buildNominee2028SharedOutcomeCore({
      topicKey,
      markets,
      outcomes: [outcome("POLYMARKET", topicKey, "jd_vance")]
    });
    const decision = buildNominee2028TopicDecision({ topicKey, markets, outcomeCore: core });

    expect(decision.topicDecision).toBe("TOPIC_SINGLE_VENUE_ONLY");
  });

  it("marks a topic too thin when shared names exist but all are excluded", () => {
    const topicKey = "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC";
    const markets = [
      market("POLYMARKET", topicKey, "RULES_MATERIALLY_INCOMPATIBLE"),
      market("OPINION", topicKey, "RULES_MATERIALLY_INCOMPATIBLE")
    ];
    const core = buildNominee2028SharedOutcomeCore({
      topicKey,
      markets,
      outcomes: [
        outcome("POLYMARKET", topicKey, "gavin_newsom"),
        outcome("OPINION", topicKey, "gavin_newsom")
      ]
    });
    const decision = buildNominee2028TopicDecision({ topicKey, markets, outcomeCore: core });

    expect(decision.topicDecision).toBe("TOPIC_SHARED_BUT_MATERIALLY_INCOMPATIBLE");
  });

  it("produces an overall matcher-ready decision when at least one topic has a routeable shared core", () => {
    const republican = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      topicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
      ruleDecision: "EXACT_RULE_COMPATIBLE",
      sharedNamedOutcomeCount: 2,
      triSharedNamedOutcomeCount: 0,
      pairSharedNamedOutcomeCount: 2,
      excludedTailCount: 1,
      othersExcluded: true,
      exactAutoRouteable: true,
      reviewRequiredRouteable: false,
      matcherEvalJustified: true
    } as const;
    const democratic = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      topicDecision: "TOPIC_SINGLE_VENUE_ONLY",
      ruleDecision: "EXACT_RULE_COMPATIBLE",
      sharedNamedOutcomeCount: 0,
      triSharedNamedOutcomeCount: 0,
      pairSharedNamedOutcomeCount: 0,
      excludedTailCount: 2,
      othersExcluded: false,
      exactAutoRouteable: false,
      reviewRequiredRouteable: false,
      matcherEvalJustified: false
    } as const;

    const finalDecision = buildNominee2028SharedCoreFinalDecision({ republican, democratic });
    expect(finalDecision.overallPoliticsNomineeDecision).toBe("NOMINEE_2028_CLUSTER_EXACT_MATCHER_READY");
  });
});
