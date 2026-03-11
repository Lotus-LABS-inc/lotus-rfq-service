import { describe, expect, it } from "vitest";

import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import type { ResidualVectorEntity, ResidualVectorLeg } from "../../src/core/combo-engine/types.js";

const defaultMetadata = {
  resolutionUniverse: "binary-us-election",
  expiryClass: "daily",
  settlementModel: "cash",
  resolutionRuleClass: "market-rules-v1"
} as const;

const makeLeg = (overrides: Partial<ResidualVectorLeg> = {}): ResidualVectorLeg => ({
  id: overrides.id ?? "leg-1",
  canonicalMarketId: overrides.canonicalMarketId ?? "market-1",
  canonicalOutcomeId: overrides.canonicalOutcomeId ?? "outcome-1",
  side: overrides.side ?? "buy",
  remainingSize: overrides.remainingSize ?? "5",
  metadata: overrides.metadata ?? { ...defaultMetadata }
});

const makeEntity = (legs: readonly ResidualVectorLeg[]): ResidualVectorEntity => ({
  entityId: "entity-1",
  userId: "user-1",
  legs
});

describe("ResidualVectorBuilder", () => {
  const builder = new ResidualVectorBuilder();

  it("builds a single-leg residual vector", () => {
    const result = builder.build(makeEntity([makeLeg()]));

    expect(result.compatibilityBucket).toBe("binary-us-election|daily|cash|market-rules-v1");
    expect(result.vector).toEqual({
      "market-1:outcome-1": "5"
    });
    expect(result.legCount).toBe(1);
    expect(result.grossAbsSize).toBe("5");
  });

  it("builds a two-leg combo residual vector with signed sizes", () => {
    const result = builder.build(
      makeEntity([
        makeLeg({
          id: "leg-1",
          canonicalMarketId: "market-1",
          canonicalOutcomeId: "outcome-yes",
          side: "buy",
          remainingSize: "4"
        }),
        makeLeg({
          id: "leg-2",
          canonicalMarketId: "market-2",
          canonicalOutcomeId: "outcome-no",
          side: "sell",
          remainingSize: "3"
        })
      ])
    );

    expect(result.vector).toEqual({
      "market-1:outcome-yes": "4",
      "market-2:outcome-no": "-3"
    });
    expect(result.legCount).toBe(2);
    expect(result.grossAbsSize).toBe("7");
  });

  it("uses only partially-filled combo residual legs", () => {
    const result = builder.build(
      makeEntity([
        makeLeg({
          id: "leg-1",
          canonicalMarketId: "market-1",
          canonicalOutcomeId: "outcome-yes",
          side: "buy",
          remainingSize: "2.5"
        }),
        makeLeg({
          id: "leg-2",
          canonicalMarketId: "market-2",
          canonicalOutcomeId: "outcome-no",
          side: "sell",
          remainingSize: "0"
        })
      ])
    );

    expect(result.vector).toEqual({
      "market-1:outcome-yes": "2.5"
    });
    expect(result.legCount).toBe(1);
    expect(result.grossAbsSize).toBe("2.5");
  });

  it("aggregates residuals for the same canonical key", () => {
    const result = builder.build(
      makeEntity([
        makeLeg({
          id: "leg-1",
          canonicalMarketId: "market-1",
          canonicalOutcomeId: "outcome-yes",
          side: "buy",
          remainingSize: "3"
        }),
        makeLeg({
          id: "leg-2",
          canonicalMarketId: "market-1",
          canonicalOutcomeId: "outcome-yes",
          side: "sell",
          remainingSize: "1"
        })
      ])
    );

    expect(result.vector).toEqual({
      "market-1:outcome-yes": "2"
    });
    expect(result.grossAbsSize).toBe("4");
  });

  it("fails closed when bucket metadata is missing", () => {
    expect(() =>
      builder.build(
        makeEntity([
          makeLeg({
            metadata: {
              resolutionUniverse: "binary-us-election",
              expiryClass: "daily",
              settlementModel: "cash"
            }
          })
        ])
      )
    ).toThrow("missing_bucket_metadata");
  });

  it("fails closed when bucket metadata conflicts", () => {
    expect(() =>
      builder.build(
        makeEntity([
          makeLeg(),
          makeLeg({
            id: "leg-2",
            metadata: {
              ...defaultMetadata,
              expiryClass: "weekly"
            }
          })
        ])
      )
    ).toThrow("bucket_mismatch");
  });

  it("fails closed on negative residuals", () => {
    expect(() =>
      builder.build(
        makeEntity([
          makeLeg({
            remainingSize: "-1"
          })
        ])
      )
    ).toThrow("negative_residual_size");
  });

  it("fails closed on empty residual sets", () => {
    expect(() =>
      builder.build(
        makeEntity([
          makeLeg({ remainingSize: "0" }),
          makeLeg({ id: "leg-2", remainingSize: "0" })
        ])
      )
    ).toThrow("no_residual_legs");
  });
});
