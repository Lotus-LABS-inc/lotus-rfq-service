import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PairShadowRuntimeWriter } from "../src/shadow/pair-shadow-runtime-writer.js";

describe("pair shadow runtime writer", () => {
  it("does not fail service startup when generated route artifacts are absent", async () => {
    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    };
    const writer = new PairShadowRuntimeWriter({
      repository: {
        createObservation: async () => {
          throw new Error("createObservation should not be called for an empty runtime catalog.");
        }
      },
      repoRoot: mkdtempSync(path.join(tmpdir(), "lotus-empty-artifacts-")),
      logger
    });

    const observation = await writer.recordSorRuntimeObservation({
      rfq: {
        rfqId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: "rfq-key",
        canonicalMarketId: "missing-artifact-market",
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
          provider_id: "POLYMARKET:market-1",
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
          provider_id: "LIMITLESS:market-1",
          available_size: 10,
          quoted_price: 1,
          fees: {},
          latency_ms: 1,
          fill_prob: 0.98,
          metadata: { venue: "LIMITLESS" }
        }
      ],
      scoredCandidates: [],
      allocations: [
        {
          candidateId: "33333333-3333-3333-3333-333333333333",
          providerId: "POLYMARKET:market-1",
          targetSize: 5,
          roundedSize: 5,
          targetPrice: 1
        },
        {
          candidateId: "55555555-5555-5555-5555-555555555555",
          providerId: "LIMITLESS:market-1",
          targetSize: 5,
          roundedSize: 5,
          targetPrice: 1
        }
      ]
    });

    expect(observation).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoRoot: expect.any(String) }),
      "Pair shadow route artifacts are unavailable; runtime shadow catalog is disabled."
    );
  });
});
