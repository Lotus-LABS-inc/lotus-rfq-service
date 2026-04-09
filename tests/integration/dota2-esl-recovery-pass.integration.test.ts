import { describe, expect, it } from "vitest";

import { extractSportsBoundaryDetailed } from "../../src/matching/sports/sports-normalization.js";
import { SportsPocketMatchingPipeline } from "../../src/matching/sports/sports-pocket-matching-pipeline.js";
import { buildDota2EslArtifactsFromResult } from "../../src/reports/dota2-esl-recovery-pass.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

const buildDotaMarket = (input: {
  interpretedContractId: string;
  venue: "OPINION" | "POLYMARKET" | "PREDICT";
  title: string;
  outcomes?: readonly string[];
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  resolvesAt?: Date | null;
}) => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: "This market is based on the DOTA2 match in ESL One Birmingham 2026.",
    category: "ESPORTS"
  }),
  publishedAt: input.publishedAt ?? new Date("2026-03-27T04:56:31.000Z"),
  expiresAt: input.expiresAt ?? new Date("2026-03-28T00:00:00.000Z"),
  resolvesAt: input.resolvesAt ?? new Date("2026-03-28T16:31:00.000Z"),
  outcomes: (input.outcomes ?? ["Yandex", "Tundra"]).map((label) => ({ label })),
  outcomeSchema: { outcomeLabels: input.outcomes ?? ["Yandex", "Tundra"] }
});

const baseline = {
  admittedRows: 6,
  candidatePairs: 0,
  exactSafeEdges: 0,
  routeableOpportunities: 0,
  blockerCounts: {
    MATCH_INSTANCE_AMBIGUOUS: 4,
    OPPONENT_MISMATCH: 2,
    SUBJECT_ENTITY_MISMATCH: 2,
    DATE_WINDOW_MISMATCH: 2
  }
};

describe("dota2-esl-recovery-pass", () => {
  it("does not fabricate 1970 dates for dota2 esl opinion rows", () => {
    const boundary = extractSportsBoundaryDetailed(buildDotaMarket({
      interpretedContractId: "dota-epoch",
      venue: "OPINION",
      title: "DOTA2 - ESL: Yandex vs Tundra (Mar. 28 11:30AM ET)",
      resolvesAt: new Date("1970-01-01T00:00:00.000Z")
    }));

    expect(boundary.dateKey).toBe("2026-03-28");
    expect(boundary.scheduledBoundaryKey?.startsWith("2026-03-28T15:30:00.000Z")).toBe(true);
    expect(boundary.unsafeDefaultReasons).toContain("RESOLVES_AT_EPOCH_SENTINEL");
  });

  it("rejects wrong-competition and one-sided rows in the source hygiene summary", async () => {
    const repository = new InMemorySportsRepository([
      buildDotaMarket({
        interpretedContractId: "good-dota",
        venue: "OPINION",
        title: "DOTA2 - ESL: Aurora vs Tundra (Mar. 26 11:30AM ET)",
        outcomes: ["Aurora", "Tundra"]
      }),
      {
        ...buildMatchingMarket({
          interpretedContractId: "wrong-competition",
          venue: "OPINION",
          venueMarketId: "wrong-competition",
          title: "CS2 - BLAST: Vitality vs Aurora (Mar. 28 10:00AM ET)",
          rulesText: "Counter-Strike match.",
          category: "ESPORTS"
        }),
        outcomes: [{ label: "Vitality" }, { label: "Aurora" }],
        outcomeSchema: { outcomeLabels: ["Vitality", "Aurora"] }
      },
      {
        ...buildMatchingMarket({
          interpretedContractId: "single-side",
          venue: "OPINION",
          venueMarketId: "single-side",
          title: "DOTA2 - ESL: Will Yandex win? (Mar. 28 11:30AM ET)",
          rulesText: "Single-side row.",
          category: "ESPORTS"
        }),
        outcomes: [{ label: "Yes" }, { label: "No" }],
        outcomeSchema: { outcomeLabels: ["Yes", "No"] }
      }
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildDota2EslArtifactsFromResult({ result, baseline });

    expect(artifacts.sourceHygieneSummary.reasons["WRONG_ESPORT"]).toBe(1);
    expect(artifacts.sourceHygieneSummary.reasons["WRONG_COMPETITION"]).toBe(2);
    expect(artifacts.sourceHygieneSummary.reasons["SINGLE_SIDE_ROW"]).toBe(1);
  });

  it("recognizes an exact-safe dota2 esl edge when a clean counterpart exists", async () => {
    const repository = new InMemorySportsRepository([
      buildDotaMarket({
        interpretedContractId: "dota-left",
        venue: "POLYMARKET",
        title: "DOTA2 ESL: Falcons vs PARI Mar 27 at 8:00AM ET",
        outcomes: ["Falcons", "PARI"],
        publishedAt: new Date("2026-03-26T00:00:00.000Z"),
        expiresAt: new Date("2026-03-27T12:00:00.000Z"),
        resolvesAt: new Date("2026-03-27T13:00:00.000Z")
      }),
      buildDotaMarket({
        interpretedContractId: "dota-right",
        venue: "OPINION",
        title: "DOTA2 - ESL: PARI vs Falcons (Mar. 27 8:00AM ET)",
        outcomes: ["PARI", "Falcons"],
        publishedAt: new Date("2026-03-26T00:00:00.000Z"),
        expiresAt: new Date("2026-03-27T00:00:00.000Z"),
        resolvesAt: new Date("2026-03-27T13:00:00.000Z")
      })
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildDota2EslArtifactsFromResult({
      result,
      baseline: {
        ...baseline,
        admittedRows: 0
      }
    });

    expect(artifacts.routeabilitySummary.exactSafeApprovedEdges).toBe(1);
    expect(artifacts.finalDecision.decision).toBe("DOTA2_ESL_RECOVERY_SUCCESS__EXACT_SAFE_EDGES_CREATED");
  });
});
