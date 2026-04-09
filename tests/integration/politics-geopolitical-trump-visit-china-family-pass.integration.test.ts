import { describe, expect, it } from "vitest";

import { extractPoliticsInventoryRow } from "../../src/matching/politics/politics-inventory-extractor.js";
import { buildPoliticsGeopoliticalTrumpVisitChinaFamilyArtifacts } from "../../src/matching/politics/politics-geopolitical-trump-visit-china-family-pass.js";
import type { MatchingMarketRecord } from "../../src/matching/matching-types.js";

const makeRecord = (input: {
  venue: "OPINION" | "POLYMARKET" | "PREDICT";
  venueMarketId: string;
  deadlineLabel: string;
}): MatchingMarketRecord => ({
  interpretedContractId: `${input.venue}:${input.venueMarketId}`,
  venueMarketProfileId: `${input.venue}:${input.venueMarketId}`,
  canonicalEventId: `evt:${input.deadlineLabel}`,
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  title: `Will Trump visit China by ${input.deadlineLabel}?`,
  description: null,
  rulesText: `If U.S. President Donald Trump visits China by ${input.deadlineLabel}, 11:59 PM ET, this market will resolve to "Yes". Otherwise, this market will resolve to "No". For the purpose of this market, a "visit" is defined as Trump physically entering the terrestrial or maritime territory of China.`,
  category: "POLITICS",
  marketClass: "BINARY",
  sourceMetadataVersion: "test",
  confidenceScore: "1",
  propositionSemantics: {},
  outcomeSemantics: {},
  timingSemantics: {},
  resolutionSemantics: {},
  settlementSemantics: {},
  ambiguityFlags: {},
  rawLineageReferences: {},
  publishedAt: null,
  expiresAt: new Date(`${input.deadlineLabel} 23:59:59 UTC`),
  resolvesAt: new Date(`${input.deadlineLabel} 23:59:59 UTC`),
  outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  outcomeSchema: {
    marketShape: "binary",
    outcomeLabels: ["Yes", "No"]
  },
  historicalRowCount: 0,
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics geopolitical trump visit china family pass", () => {
  it("keeps future pair and tri lanes while excluding expired date buckets", () => {
    const rows = [
      makeRecord({ venue: "OPINION", venueMarketId: "op:march", deadlineLabel: "March 31, 2026" }),
      makeRecord({ venue: "POLYMARKET", venueMarketId: "poly:march", deadlineLabel: "March 31, 2026" }),
      makeRecord({ venue: "PREDICT", venueMarketId: "pred:march", deadlineLabel: "March 31, 2026" }),
      makeRecord({ venue: "OPINION", venueMarketId: "op:april", deadlineLabel: "April 30, 2026" }),
      makeRecord({ venue: "POLYMARKET", venueMarketId: "poly:april", deadlineLabel: "April 30, 2026" }),
      makeRecord({ venue: "PREDICT", venueMarketId: "pred:april", deadlineLabel: "April 30, 2026" }),
      makeRecord({ venue: "OPINION", venueMarketId: "op:may", deadlineLabel: "May 31, 2026" }),
      makeRecord({ venue: "POLYMARKET", venueMarketId: "poly:may", deadlineLabel: "May 31, 2026" }),
      makeRecord({ venue: "OPINION", venueMarketId: "op:june", deadlineLabel: "June 30, 2026" }),
      makeRecord({ venue: "POLYMARKET", venueMarketId: "poly:june", deadlineLabel: "June 30, 2026" })
    ].map((record) => extractPoliticsInventoryRow(record));

    const artifacts = buildPoliticsGeopoliticalTrumpVisitChinaFamilyArtifacts(rows, new Date("2026-04-08T00:00:00Z"));

    expect(artifacts.admissionSummary.rowsRejectedByReason.DEADLINE_ALREADY_PASSED).toBe(3);
    expect(artifacts.comparabilitySummary.map((topic) => ({
      topicKey: topic.topicKey,
      routeabilityCandidate: topic.routeabilityCandidate,
      venuesPresent: topic.venuesPresent
    }))).toEqual([
      {
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        routeabilityCandidate: "TRI",
        venuesPresent: ["OPINION", "POLYMARKET", "PREDICT"]
      },
      {
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-05-31",
        routeabilityCandidate: "PAIR",
        venuesPresent: ["OPINION", "POLYMARKET"]
      },
      {
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-06-30",
        routeabilityCandidate: "PAIR",
        venuesPresent: ["OPINION", "POLYMARKET"]
      }
    ]);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND");
    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30");
  });
});
