import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildSemanticRulepackSuggestions } from "../../src/operations/semantic-expansion/semantic-rulepack-suggestions.js";
import type { CrossVenueMatchReport } from "../../src/operations/semantic-expansion/shared.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("buildSemanticRulepackSuggestions", () => {
  it("produces deterministic suggestions from repeated prioritized near-miss evidence", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "semantic-suggest-"));
    tempDirs.push(repoRoot);
    mkdirSync(path.join(repoRoot, "docs"), { recursive: true });

    const report: CrossVenueMatchReport = {
      observedAt: new Date().toISOString(),
      afterRulepackRefresh: false,
      semanticsRulepackVersion: "semantic-rulepack-v1",
      inventorySummary: {
        totalMarkets: 0,
        categories: {},
        venues: {
          POLYMARKET: 0,
          LIMITLESS: 0,
          OPINION: 0,
          MYRIAD: 0,
          PREDICT: 0
        },
        evidenceLabels: {
          historical: 0,
          current_state: 0,
          recorder: 0,
          fallback: 0,
          live_inventory_only: 0
        }
      },
      matches: [
        {
          matchId: "m1",
          category: "SPORTS",
          venueSet: ["LIMITLESS", "OPINION"],
          seed: {
            venue: "LIMITLESS",
            venueMarketId: "1",
            title: "Thunder win finals",
            canonicalEventId: "event-1",
            canonicalMarketId: "market-1",
            evidenceLabel: "historical",
            historicalRowCount: 2
          },
          candidate: {
            venue: "OPINION",
            venueMarketId: "2",
            title: "OKC wins finals",
            canonicalEventId: "event-2",
            canonicalMarketId: "market-2",
            evidenceLabel: "current_state",
            historicalRowCount: 0
          },
          matchClass: "semantic_near_exact",
          exactPromotionEligible: false,
          historicalQualified: false,
          compatibilityDecisionClass: null,
          blockReason: "semantic_ambiguity",
          baseConfidence: 0.55,
          finalConfidence: 0.6,
          semanticValidation: {
            failedDimensions: ["conditionActionMatch"]
          },
          semanticProvenance: {
            normalizedPropositionElements: {
              actionOrCondition: {
                seed: { normalized: "wins championship" },
                candidate: { normalized: "win championship" }
              }
            }
          }
        },
        {
          matchId: "m2",
          category: "SPORTS",
          venueSet: ["LIMITLESS", "OPINION"],
          seed: {
            venue: "LIMITLESS",
            venueMarketId: "3",
            title: "Thunder championship",
            canonicalEventId: "event-3",
            canonicalMarketId: "market-3",
            evidenceLabel: "historical",
            historicalRowCount: 2
          },
          candidate: {
            venue: "OPINION",
            venueMarketId: "4",
            title: "OKC championship",
            canonicalEventId: "event-4",
            canonicalMarketId: "market-4",
            evidenceLabel: "current_state",
            historicalRowCount: 0
          },
          matchClass: "semantic_near_exact",
          exactPromotionEligible: false,
          historicalQualified: false,
          compatibilityDecisionClass: null,
          blockReason: "semantic_ambiguity",
          baseConfidence: 0.55,
          finalConfidence: 0.6,
          semanticValidation: {
            failedDimensions: ["conditionActionMatch"]
          },
          semanticProvenance: {
            normalizedPropositionElements: {
              actionOrCondition: {
                seed: { normalized: "wins championship" },
                candidate: { normalized: "win championship" }
              }
            }
          }
        }
      ],
      promotionCandidates: [],
      summary: {
        exactHistoricalQualified: 0,
        exactLiveOnly: 0,
        nearExact: 2,
        proxyOrMismatch: 0,
        blockedByCompatibility: 0
      },
      metrics: {
        semantic_candidate_matches_total: 2,
        semantic_rules_fired_total: 0,
        semantic_confidence_uplift_total: 0,
        semantic_match_downgraded_total: 2,
        semantic_match_blocked_by_compatibility_total: 0,
        semantic_false_positive_review_total: 2,
        semantic_candidate_to_equivalent_conversion_rate: 0,
        semantic_candidate_to_distinct_rate: 0,
        safeDiscoveryLift: 0,
        cautionDiscoveryLift: 1,
        blockedUnsafeExpansionRate: 0,
        lowConfidenceSemanticRate: 0
      }
    };

    writeFileSync(path.join(repoRoot, "docs", "cross-venue-match-report.json"), `${JSON.stringify(report)}\n`, "utf8");

    const result = buildSemanticRulepackSuggestions({ repoRoot });

    expect(result.report.mismatchFamilies).toEqual([
      {
        category: "SPORTS",
        failedDimension: "conditionActionMatch",
        count: 2
      }
    ]);
    expect(result.report.suggestions).toHaveLength(1);
    expect(result.report.suggestions[0]).toMatchObject({
      category: "SPORTS",
      targetField: "actionOrCondition",
      canonical: "wins championship",
      variants: ["win championship"],
      evidenceCount: 2
    });
  });
});
