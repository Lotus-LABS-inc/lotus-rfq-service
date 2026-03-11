import { describe, expect, it } from "vitest";

import { CandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import type { OverlapGraph } from "../../src/core/combo-engine/types.js";

const makeGraph = (graph: OverlapGraph): OverlapGraph => graph;

describe("CandidateGroupEnumerator", () => {
  const enumerator = new CandidateGroupEnumerator();

  it("enumerates a 3-party cycle including the full group", () => {
    const graph = makeGraph({
      nodes: [
        {
          entityId: "a",
          userId: "user-a",
          compatibilityBucket: "bucket-1",
          vector: { "m1:o1": "3", "m2:o2": "-2" },
          legCount: 2,
          grossAbsSize: "5"
        },
        {
          entityId: "b",
          userId: "user-b",
          compatibilityBucket: "bucket-1",
          vector: { "m1:o1": "-1", "m3:o3": "2" },
          legCount: 2,
          grossAbsSize: "3"
        },
        {
          entityId: "c",
          userId: "user-c",
          compatibilityBucket: "bucket-1",
          vector: { "m2:o2": "2", "m3:o3": "-2" },
          legCount: 2,
          grossAbsSize: "4"
        }
      ],
      edges: [
        {
          from: "a",
          to: "b",
          overlapLegs: [{ key: "m1:o1", signedSizeA: "3", signedSizeB: "-1", offsetSize: "1" }],
          compressionPotential: "1",
          exactOppositionScore: "0.2",
          partialOverlapScore: "0.33333333333333333333"
        },
        {
          from: "a",
          to: "c",
          overlapLegs: [{ key: "m2:o2", signedSizeA: "-2", signedSizeB: "2", offsetSize: "2" }],
          compressionPotential: "2",
          exactOppositionScore: "0.4",
          partialOverlapScore: "0.5"
        },
        {
          from: "b",
          to: "c",
          overlapLegs: [{ key: "m3:o3", signedSizeA: "2", signedSizeB: "-2", offsetSize: "2" }],
          compressionPotential: "2",
          exactOppositionScore: "0.5",
          partialOverlapScore: "0.66666666666666666667"
        }
      ]
    });

    const groups = enumerator.enumerate(graph);

    expect(groups.some((group) => group.participantIds.join("|") === "a|b|c")).toBe(true);
  });

  it("emits a bounded 4-party group when within limits", () => {
    const graph = makeGraph({
      nodes: [
        { entityId: "a", userId: "u1", compatibilityBucket: "bucket-1", vector: { "m1:o1": "2" }, legCount: 1, grossAbsSize: "2" },
        { entityId: "b", userId: "u2", compatibilityBucket: "bucket-1", vector: { "m1:o1": "-1", "m2:o2": "1" }, legCount: 2, grossAbsSize: "2" },
        { entityId: "c", userId: "u3", compatibilityBucket: "bucket-1", vector: { "m2:o2": "-1", "m3:o3": "1" }, legCount: 2, grossAbsSize: "2" },
        { entityId: "d", userId: "u4", compatibilityBucket: "bucket-1", vector: { "m3:o3": "-1" }, legCount: 1, grossAbsSize: "1" }
      ],
      edges: [
        {
          from: "a", to: "b",
          overlapLegs: [{ key: "m1:o1", signedSizeA: "2", signedSizeB: "-1", offsetSize: "1" }],
          compressionPotential: "1",
          exactOppositionScore: "0.5",
          partialOverlapScore: "0.5"
        },
        {
          from: "b", to: "c",
          overlapLegs: [{ key: "m2:o2", signedSizeA: "1", signedSizeB: "-1", offsetSize: "1" }],
          compressionPotential: "1",
          exactOppositionScore: "0.5",
          partialOverlapScore: "0.5"
        },
        {
          from: "c", to: "d",
          overlapLegs: [{ key: "m3:o3", signedSizeA: "1", signedSizeB: "-1", offsetSize: "1" }],
          compressionPotential: "1",
          exactOppositionScore: "0.5",
          partialOverlapScore: "1"
        }
      ]
    });

    const groups = enumerator.enumerate(graph, { maxParticipants: 4, maxUniqueLegs: 6 });

    expect(groups.some((group) => group.participantIds.join("|") === "a|b|c|d")).toBe(true);
  });

  it("rejects groups that exceed the participant limit", () => {
    const graph = makeGraph({
      nodes: [
        { entityId: "a", userId: "u1", compatibilityBucket: "bucket-1", vector: { "m1:o1": "2" }, legCount: 1, grossAbsSize: "2" },
        { entityId: "b", userId: "u2", compatibilityBucket: "bucket-1", vector: { "m1:o1": "-1", "m2:o2": "1" }, legCount: 2, grossAbsSize: "2" },
        { entityId: "c", userId: "u3", compatibilityBucket: "bucket-1", vector: { "m2:o2": "-1", "m3:o3": "1" }, legCount: 2, grossAbsSize: "2" },
        { entityId: "d", userId: "u4", compatibilityBucket: "bucket-1", vector: { "m3:o3": "-1" }, legCount: 1, grossAbsSize: "1" }
      ],
      edges: [
        {
          from: "a", to: "b",
          overlapLegs: [{ key: "m1:o1", signedSizeA: "2", signedSizeB: "-1", offsetSize: "1" }],
          compressionPotential: "1",
          exactOppositionScore: "0.5",
          partialOverlapScore: "0.5"
        },
        {
          from: "b", to: "c",
          overlapLegs: [{ key: "m2:o2", signedSizeA: "1", signedSizeB: "-1", offsetSize: "1" }],
          compressionPotential: "1",
          exactOppositionScore: "0.5",
          partialOverlapScore: "0.5"
        },
        {
          from: "c", to: "d",
          overlapLegs: [{ key: "m3:o3", signedSizeA: "1", signedSizeB: "-1", offsetSize: "1" }],
          compressionPotential: "1",
          exactOppositionScore: "0.5",
          partialOverlapScore: "1"
        }
      ]
    });

    const groups = enumerator.enumerate(graph, { maxParticipants: 3 });

    expect(groups.some((group) => group.participantIds.join("|") === "a|b|c|d")).toBe(false);
  });

  it("rejects same-user offsetting groups when STP forbids self trade", () => {
    const graph = makeGraph({
      nodes: [
        { entityId: "a", userId: "same-user", compatibilityBucket: "bucket-1", vector: { "m1:o1": "2" }, legCount: 1, grossAbsSize: "2" },
        { entityId: "b", userId: "same-user", compatibilityBucket: "bucket-1", vector: { "m1:o1": "-2" }, legCount: 1, grossAbsSize: "2" }
      ],
      edges: [
        {
          from: "a",
          to: "b",
          overlapLegs: [{ key: "m1:o1", signedSizeA: "2", signedSizeB: "-2", offsetSize: "2" }],
          compressionPotential: "2",
          exactOppositionScore: "1",
          partialOverlapScore: "1"
        }
      ]
    });

    const blocked = enumerator.enumerate(graph, { stpMode: "CANCEL_NEWEST" });
    const allowed = enumerator.enumerate(graph, { stpMode: "NONE" });

    expect(blocked).toEqual([]);
    expect(allowed.some((group) => group.participantIds.join("|") === "a|b")).toBe(true);
  });

  it("omits groups that exceed the unique leg limit", () => {
    const graph = makeGraph({
      nodes: [
        { entityId: "a", userId: "u1", compatibilityBucket: "bucket-1", vector: { "m1:o1": "1", "m2:o2": "-1" }, legCount: 2, grossAbsSize: "2" },
        { entityId: "b", userId: "u2", compatibilityBucket: "bucket-1", vector: { "m2:o2": "1", "m3:o3": "-1" }, legCount: 2, grossAbsSize: "2" },
        { entityId: "c", userId: "u3", compatibilityBucket: "bucket-1", vector: { "m3:o3": "1", "m4:o4": "-1" }, legCount: 2, grossAbsSize: "2" },
        { entityId: "d", userId: "u4", compatibilityBucket: "bucket-1", vector: { "m4:o4": "1", "m5:o5": "-1" }, legCount: 2, grossAbsSize: "2" }
      ],
      edges: [
        { from: "a", to: "b", overlapLegs: [{ key: "m2:o2", signedSizeA: "-1", signedSizeB: "1", offsetSize: "1" }], compressionPotential: "1", exactOppositionScore: "0.5", partialOverlapScore: "0.5" },
        { from: "b", to: "c", overlapLegs: [{ key: "m3:o3", signedSizeA: "-1", signedSizeB: "1", offsetSize: "1" }], compressionPotential: "1", exactOppositionScore: "0.5", partialOverlapScore: "0.5" },
        { from: "c", to: "d", overlapLegs: [{ key: "m4:o4", signedSizeA: "-1", signedSizeB: "1", offsetSize: "1" }], compressionPotential: "1", exactOppositionScore: "0.5", partialOverlapScore: "0.5" }
      ]
    });

    const groups = enumerator.enumerate(graph, { maxUniqueLegs: 4 });

    expect(groups.some((group) => group.participantIds.join("|") === "a|b|c|d")).toBe(false);
  });

  it("gives exactnessScore of 1 for zero residual groups", () => {
    const graph = makeGraph({
      nodes: [
        { entityId: "a", userId: "u1", compatibilityBucket: "bucket-1", vector: { "m1:o1": "2" }, legCount: 1, grossAbsSize: "2" },
        { entityId: "b", userId: "u2", compatibilityBucket: "bucket-1", vector: { "m1:o1": "-2" }, legCount: 1, grossAbsSize: "2" }
      ],
      edges: [
        {
          from: "a",
          to: "b",
          overlapLegs: [{ key: "m1:o1", signedSizeA: "2", signedSizeB: "-2", offsetSize: "2" }],
          compressionPotential: "2",
          exactOppositionScore: "1",
          partialOverlapScore: "1"
        }
      ]
    });

    const groups = enumerator.enumerate(graph, { stpMode: "NONE" });

    expect(groups[0]?.exactnessScore).toBe("1");
    expect(groups[0]?.residualAfterNetting).toEqual([]);
  });
});
