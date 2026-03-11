import { describe, expect, it } from "vitest";

import { OverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import type { ResidualVector } from "../../src/core/combo-engine/types.js";

const makeVector = (overrides: Partial<ResidualVector> = {}): ResidualVector => ({
  entityId: overrides.entityId ?? "entity-a",
  userId: overrides.userId ?? "user-a",
  compatibilityBucket: overrides.compatibilityBucket ?? "bucket-1",
  vector: overrides.vector ?? { "market-1:outcome-yes": "5" },
  legCount: overrides.legCount ?? 1,
  grossAbsSize: overrides.grossAbsSize ?? "5"
});

describe("OverlapGraphBuilder", () => {
  const builder = new OverlapGraphBuilder();

  it("builds a disconnected graph when no entities offset", () => {
    const graph = builder.build([
      makeVector({ entityId: "a", vector: { "market-1:outcome-yes": "5" }, grossAbsSize: "5" }),
      makeVector({ entityId: "b", vector: { "market-1:outcome-yes": "3" }, grossAbsSize: "3" }),
      makeVector({ entityId: "c", vector: { "market-2:outcome-no": "-2" }, grossAbsSize: "2" })
    ]);

    expect(graph.nodes.map((node) => node.entityId)).toEqual(["a", "b", "c"]);
    expect(graph.edges).toEqual([]);
  });

  it("builds a simple chain graph", () => {
    const graph = builder.build([
      makeVector({ entityId: "a", vector: { "market-1:outcome-yes": "5" }, grossAbsSize: "5" }),
      makeVector({
        entityId: "b",
        vector: {
          "market-1:outcome-yes": "-2",
          "market-2:outcome-no": "4"
        },
        grossAbsSize: "6"
      }),
      makeVector({ entityId: "c", vector: { "market-2:outcome-no": "-3" }, grossAbsSize: "3" })
    ]);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toEqual([
      {
        from: "a",
        to: "b",
        overlapLegs: [
          {
            key: "market-1:outcome-yes",
            signedSizeA: "5",
            signedSizeB: "-2",
            offsetSize: "2"
          }
        ],
        compressionPotential: "2",
        exactOppositionScore: "0.33333333333333333333",
        partialOverlapScore: "0.4"
      },
      {
        from: "b",
        to: "c",
        overlapLegs: [
          {
            key: "market-2:outcome-no",
            signedSizeA: "4",
            signedSizeB: "-3",
            offsetSize: "3"
          }
        ],
        compressionPotential: "3",
        exactOppositionScore: "0.5",
        partialOverlapScore: "1"
      }
    ]);
  });

  it("builds a 3-node cycle", () => {
    const graph = builder.build([
      makeVector({
        entityId: "a",
        vector: {
          "market-1:outcome-yes": "3",
          "market-2:outcome-no": "-2"
        },
        grossAbsSize: "5"
      }),
      makeVector({
        entityId: "b",
        vector: {
          "market-1:outcome-yes": "-1",
          "market-3:outcome-yes": "2"
        },
        grossAbsSize: "3"
      }),
      makeVector({
        entityId: "c",
        vector: {
          "market-2:outcome-no": "2",
          "market-3:outcome-yes": "-2"
        },
        grossAbsSize: "4"
      })
    ]);

    expect(graph.edges).toHaveLength(3);
    expect(graph.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual(["a-b", "a-c", "b-c"]);
  });

  it("yields an exact opposition score of 1 for a full opposite pair", () => {
    const graph = builder.build([
      makeVector({ entityId: "a", vector: { "market-1:outcome-yes": "5" }, grossAbsSize: "5" }),
      makeVector({ entityId: "b", vector: { "market-1:outcome-yes": "-5" }, grossAbsSize: "5" })
    ]);

    expect(graph.edges[0]?.exactOppositionScore).toBe("1");
    expect(graph.edges[0]?.partialOverlapScore).toBe("1");
  });

  it("fails closed on bucket mismatch", () => {
    expect(() =>
      builder.build([
        makeVector({ entityId: "a", compatibilityBucket: "bucket-1" }),
        makeVector({ entityId: "b", compatibilityBucket: "bucket-2", vector: { "market-1:outcome-yes": "-1" } })
      ])
    ).toThrow("compatibility_bucket_mismatch");
  });

  it("fails closed on duplicate entity ids", () => {
    expect(() =>
      builder.build([
        makeVector({ entityId: "dup" }),
        makeVector({ entityId: "dup", vector: { "market-1:outcome-yes": "-1" } })
      ])
    ).toThrow("duplicate_entity_id");
  });

  it("fails closed on malformed numeric vector entries", () => {
    expect(() =>
      builder.build([
        makeVector({ entityId: "a", vector: { "market-1:outcome-yes": "not-a-number" } }),
        makeVector({ entityId: "b", vector: { "market-1:outcome-yes": "-1" } })
      ])
    ).toThrow("invalid_signed_size");
  });
});
