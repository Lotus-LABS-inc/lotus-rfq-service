import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PairShadowRuntimeWriter } from "../../src/shadow/pair-shadow-runtime-writer.js";

const loadSafeCanonicalMarketId = (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION"): string => {
  const artifact = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "docs/pair-route-rollout-summary.json"), "utf8")
  ) as {
    routes: Array<{
      routeClassId: string;
      safeSubsetMarkets: Array<{ canonicalMarketId: string | null; canonicalEventId: string }>;
    }>;
  };
  const route = artifact.routes.find((entry) => entry.routeClassId === routeClass);
  if (!route || route.safeSubsetMarkets.length === 0) {
    throw new Error(`No safe subset markets found for ${routeClass}.`);
  }
  return route.safeSubsetMarkets[0]!.canonicalMarketId ?? route.safeSubsetMarkets[0]!.canonicalEventId;
};

describe("pair shadow runtime persistence", () => {
  it("persists a live exact-safe PM+Opinion runtime observation and supports exact-safe top-up", async () => {
    const created: Array<Record<string, unknown>> = [];
    const writer = new PairShadowRuntimeWriter({
      repository: {
        createObservation: async (input) => {
          const record = {
            id: `obs-${created.length + 1}`,
            createdAt: "2026-03-30T00:00:00.000Z",
            ...input
          };
          created.push(record);
          return record as never;
        }
      },
      repoRoot: process.cwd()
    });

    const canonicalMarketId = loadSafeCanonicalMarketId("PAIR_PM_OPINION");
    const runtimeObservation = await writer.recordSorRuntimeObservation({
      rfq: {
        rfqId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: "rfq-key",
        canonicalMarketId,
        takerId: "22222222-2222-2222-2222-222222222222",
        side: "buy",
        quantity: "10",
        stpMode: "NONE"
      },
      selectedQuote: {
        quoteId: "quote-1",
        price: 1,
        quantity: 10,
        feeBps: 0
      },
      routeCandidates: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          leg_id: "44444444-4444-4444-4444-444444444444",
          provider_type: "VENUE",
          provider_id: "POLYMARKET:btc-1",
          available_size: 10,
          quoted_price: 1,
          fees: {},
          latency_ms: 1,
          fill_prob: 0.99,
          metadata: { venue: "POLYMARKET" }
        },
        {
          id: "55555555-5555-5555-5555-555555555555",
          leg_id: "44444444-4444-4444-4444-444444444444",
          provider_type: "VENUE",
          provider_id: "OPINION:btc-1",
          available_size: 10,
          quoted_price: 1,
          fees: {},
          latency_ms: 1,
          fill_prob: 0.98,
          metadata: { venue: "OPINION" }
        }
      ],
      scoredCandidates: [
        {
          candidateId: "33333333-3333-3333-3333-333333333333",
          providerId: "POLYMARKET:btc-1",
          effectiveUnitCost: 0.99,
          totalExpectedCost: 0.99,
          breakdown: {
            effectiveUnitCost: 0.99,
            basePrice: 0.99,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        },
        {
          candidateId: "55555555-5555-5555-5555-555555555555",
          providerId: "OPINION:btc-1",
          effectiveUnitCost: 0.98,
          totalExpectedCost: 0.98,
          breakdown: {
            effectiveUnitCost: 0.98,
            basePrice: 0.98,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        }
      ],
      allocations: [
        {
          candidateId: "33333333-3333-3333-3333-333333333333",
          providerId: "POLYMARKET:btc-1",
          targetSize: 5,
          roundedSize: 5,
          targetPrice: 1
        },
        {
          candidateId: "55555555-5555-5555-5555-555555555555",
          providerId: "OPINION:btc-1",
          targetSize: 5,
          roundedSize: 5,
          targetPrice: 1
        }
      ],
      replayEnvelopeId: "replay-1"
    });

    expect(runtimeObservation?.routeClass).toBe("PAIR_PM_OPINION");
    expect(runtimeObservation?.scopeKind).toBe("SAFE_EXACT_SUBSET");
    expect(runtimeObservation?.basisMode).toBe("LIVE_ONLY");

    const topUpObservation = await writer.recordTopUpObservation({
      routeClass: "PAIR_PM_OPINION",
      canonicalMarketId,
      operatorIdentity: "admin-user",
      reason: "fill exact-safe sample gap"
    });

    expect(topUpObservation.metadata.topUp).toBe(true);
    expect(created).toHaveLength(2);
  });
});

