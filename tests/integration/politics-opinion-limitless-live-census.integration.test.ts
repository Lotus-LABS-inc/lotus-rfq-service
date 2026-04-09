import { describe, expect, it } from "vitest";

import { admitNominee2028Row } from "../../src/matching/politics/politics-nominee-2028-cluster.js";
import {
  buildOpinionLimitlessLiveCensusExtractedRows,
  mergeRefreshedRowsWithOpinionLimitlessLiveCensus,
  parseOpinionDirectPage
} from "../../src/reports/politics-opinion-limitless-live-census.js";

describe("politics opinion/limitless live census", () => {
  it("turns fresh live rows into extracted nominee rows without relaxing admission rules", () => {
    const extractedRows = buildOpinionLimitlessLiveCensusExtractedRows({
      opinionRows: [
        {
          venue: "OPINION",
          venueMarketId: "opinion-1",
          slug: "will-jd-vance-win-the-2028-republican-presidential-nomination",
          title: "Will JD Vance win the 2028 Republican presidential nomination?",
          rulesText: "Resolves yes if JD Vance wins the 2028 Republican nomination for U.S. president.",
          categoryHints: ["Politics"],
          tags: ["Politics"],
          active: true,
          publishedAt: null,
          expiresAt: null,
          resolvesAt: null,
          outcomes: [{ label: "Yes" }, { label: "No" }],
          sourceUrl: null,
          rawPayload: {},
          fetchTimestamp: new Date().toISOString(),
          discoveryPath: "opinion_clob_sdk_active_markets_live_census"
        }
      ],
      limitlessRows: [
        {
          venue: "LIMITLESS",
          venueMarketId: "limitless-1",
          slug: "democratic-presidential-nominee-2028",
          title: "Who will be the Democratic nominee for U.S. president in 2028?",
          rulesText: "Market resolves to the candidate who wins and accepts the Democratic nomination for U.S. president in 2028.",
          categoryHints: ["Politics"],
          tags: ["Politics"],
          active: true,
          publishedAt: null,
          expiresAt: null,
          resolvesAt: null,
          outcomes: [{ label: "Gavin Newsom" }, { label: "Kamala Harris" }, { label: "Others" }],
          sourceUrl: null,
          rawPayload: {},
          fetchTimestamp: new Date().toISOString(),
          discoveryPath: "limitless_public_current_surface_live_census"
        }
      ]
    });

    expect(extractedRows).toHaveLength(2);
    expect(admitNominee2028Row(extractedRows[0]!).admitted).toBe(true);
    expect(admitNominee2028Row(extractedRows[1]!).admitted).toBe(true);
    expect(extractedRows[1]!.outcomeLabels).toContain("Others");
  });

  it("replaces persisted opinion/limitless rows with fresh live census rows while preserving other venues", () => {
    const merged = mergeRefreshedRowsWithOpinionLimitlessLiveCensus(
      [
        {
          interpretedContractId: "old-opinion",
          venue: "OPINION",
          venueMarketId: "opinion-stale",
          sourceMarketSlug: null,
          canonicalEventId: "old-opinion-event",
          title: "Stale opinion row",
          rulesText: null,
          category: "POLITICS",
          marketClass: "BINARY",
          tags: [],
          outcomeCount: 2,
          outcomeLabels: ["Yes", "No"],
          publishedAt: null,
          expiresAt: null,
          resolvesAt: null,
          jurisdiction: "usa",
          office: "president",
          institution: null,
          chamber: null,
          branch: "executive",
          cycleYear: "2028",
          contestStage: "nomination",
          candidateNames: ["jd vance"],
          candidateSetFingerprint: "jd vance",
          partyTerms: ["republican"],
          partyStructureFingerprint: "republican",
          thresholdSemantics: null,
          dateBoundarySemantics: null,
          eventType: null,
          outcomeStructureType: "YES_NO",
          resolutionBasisHints: [],
          family: "NOMINEE_WINNER",
          extractionConfidence: "HIGH",
          parseFailures: [],
          inventoryTemporalBasis: "LIVE_CURRENT_STATE"
        },
        {
          interpretedContractId: "polymarket-fresh",
          venue: "POLYMARKET",
          venueMarketId: "pm-1",
          sourceMarketSlug: null,
          canonicalEventId: "pm-event",
          title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
          rulesText: null,
          category: "POLITICS",
          marketClass: "BINARY",
          tags: [],
          outcomeCount: 2,
          outcomeLabels: ["Yes", "No"],
          publishedAt: null,
          expiresAt: null,
          resolvesAt: null,
          jurisdiction: "usa",
          office: "president",
          institution: null,
          chamber: null,
          branch: "executive",
          cycleYear: "2028",
          contestStage: "nomination",
          candidateNames: ["gavin newsom"],
          candidateSetFingerprint: "gavin newsom",
          partyTerms: ["democratic"],
          partyStructureFingerprint: "democratic",
          thresholdSemantics: null,
          dateBoundarySemantics: null,
          eventType: null,
          outcomeStructureType: "YES_NO",
          resolutionBasisHints: [],
          family: "NOMINEE_WINNER",
          extractionConfidence: "HIGH",
          parseFailures: [],
          inventoryTemporalBasis: "LIVE_CURRENT_STATE"
        }
      ],
      [
        {
          interpretedContractId: "new-opinion",
          venue: "OPINION",
          venueMarketId: "opinion-live",
          sourceMarketSlug: null,
          canonicalEventId: "new-opinion-event",
          title: "Will Donald Trump win the 2028 Republican presidential nomination?",
          rulesText: null,
          category: "POLITICS",
          marketClass: "BINARY",
          tags: [],
          outcomeCount: 2,
          outcomeLabels: ["Yes", "No"],
          publishedAt: null,
          expiresAt: null,
          resolvesAt: null,
          jurisdiction: "usa",
          office: "president",
          institution: null,
          chamber: null,
          branch: "executive",
          cycleYear: "2028",
          contestStage: "nomination",
          candidateNames: ["donald trump"],
          candidateSetFingerprint: "donald trump",
          partyTerms: ["republican"],
          partyStructureFingerprint: "republican",
          thresholdSemantics: null,
          dateBoundarySemantics: null,
          eventType: null,
          outcomeStructureType: "YES_NO",
          resolutionBasisHints: [],
          family: "NOMINEE_WINNER",
          extractionConfidence: "HIGH",
          parseFailures: [],
          inventoryTemporalBasis: "LIVE_CURRENT_STATE"
        }
      ]
    );

    expect(merged.map((row) => `${row.venue}:${row.venueMarketId}`)).toEqual([
      "POLYMARKET:pm-1",
      "OPINION:opinion-live"
    ]);
  });

  it("parses the current Opinion nominee metadata stream from the full document, not a narrow html window", () => {
    const parsed = parseOpinionDirectPage({
      url: "https://app.opinion.trade/market/republican-presidential-nominee-2028",
      html: `
        <html>
          <head>
            <title>Republican Presidential Nominee 2028</title>
            <meta name="description" content="J.D. Vance: 35% | Ron DeSantis: 30% | Glenn Youngkin: 27% | Marco Rubio: 18%">
            <meta name="twitter:image:src" content="https://app.opinion.trade/og/republican-presidential-nominee-2028/493142">
          </head>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBe("OPINION");
    expect(parsed?.venueMarketId).toBe("493142");
    expect(parsed?.title).toBe("Republican Presidential Nominee 2028");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Glenn Youngkin",
      "J.D. Vance",
      "Marco Rubio",
      "Ron DeSantis"
    ]);
  });
});
