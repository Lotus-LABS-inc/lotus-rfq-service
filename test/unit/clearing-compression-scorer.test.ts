import { describe, expect, it } from "vitest";

import { ClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import type { CandidateGroup, ScorableResidualVector } from "../../src/core/combo-engine/types.js";

const makeGroup = (overrides: Partial<CandidateGroup> = {}): CandidateGroup => ({
  participantIds: overrides.participantIds ?? ["a", "b", "c"],
  uniqueLegs: overrides.uniqueLegs ?? ["m1:o1", "m2:o2", "m3:o3"],
  estimatedCompressionScore: overrides.estimatedCompressionScore ?? "0.75",
  residualAfterNetting: overrides.residualAfterNetting ?? [],
  exactnessScore: overrides.exactnessScore ?? "1"
});

const makeVector = (overrides: Partial<ScorableResidualVector> = {}): ScorableResidualVector => ({
  entityId: overrides.entityId ?? "a",
  userId: overrides.userId ?? "user-a",
  compatibilityBucket: overrides.compatibilityBucket ?? "bucket-1",
  vector: overrides.vector ?? { "m1:o1": "3" },
  legCount: overrides.legCount ?? 1,
  grossAbsSize: overrides.grossAbsSize ?? "3",
  createdAt: overrides.createdAt ?? "2026-03-10T10:00:00.000Z"
});

describe("ClearingCompressionScorer", () => {
  const scorer = new ClearingCompressionScorer();

  it("scores an exact cycle with zero residual", () => {
    const group = makeGroup();
    const score = scorer.score(group, [
      makeVector({
        entityId: "a",
        userId: "user-a",
        vector: { "m1:o1": "3", "m2:o2": "-2" },
        grossAbsSize: "5",
        createdAt: "2026-03-10T09:00:00.000Z"
      }),
      makeVector({
        entityId: "b",
        userId: "user-b",
        vector: { "m1:o1": "-1", "m3:o3": "2" },
        grossAbsSize: "3",
        createdAt: "2026-03-10T09:05:00.000Z"
      }),
      makeVector({
        entityId: "c",
        userId: "user-c",
        vector: { "m2:o2": "2", "m3:o3": "-2", "m1:o1": "-2" },
        grossAbsSize: "6",
        createdAt: "2026-03-10T09:10:00.000Z"
      })
    ]);

    expect(score.preNetAbsExposure).toBe("14");
    expect(score.postNetAbsResidual).toBe("0");
    expect(score.compressionScore).toBe("14");
    expect(score.rankingPenalty).toBe("2");
    expect(score.finalScore).toBe("12");
    expect(score.tieBreak.smallestResidual).toBe("0");
    expect(score.tieBreak.oldestParticipantAt).toBe("2026-03-10T09:00:00.000Z");
    expect(score.tieBreak.participantCount).toBe(3);
  });

  it("scores a partial compression group", () => {
    const group = makeGroup({
      participantIds: ["a", "b"],
      uniqueLegs: ["m1:o1", "m2:o2"],
      estimatedCompressionScore: "0.5",
      exactnessScore: "0.5"
    });

    const score = scorer.score(group, [
      makeVector({
        entityId: "a",
        vector: { "m1:o1": "5" },
        grossAbsSize: "5",
        createdAt: "2026-03-10T10:00:00.000Z"
      }),
      makeVector({
        entityId: "b",
        vector: { "m1:o1": "-2", "m2:o2": "1" },
        grossAbsSize: "3",
        createdAt: "2026-03-10T10:05:00.000Z"
      })
    ]);

    expect(score.preNetAbsExposure).toBe("8");
    expect(score.postNetAbsResidual).toBe("4");
    expect(score.compressionScore).toBe("4");
    expect(score.rankingPenalty).toBe("2");
    expect(score.finalScore).toBe("2");
    expect(score.tieBreak.smallestResidual).toBe("4");
  });

  it("fails closed on malformed numeric vectors", () => {
    const group = makeGroup({
      participantIds: ["a"],
      uniqueLegs: ["m1:o1"]
    });

    expect(() =>
      scorer.score(group, [
        makeVector({
          entityId: "a",
          vector: { "m1:o1": "bad-number" }
        })
      ])
    ).toThrow("invalid_participant_vector");
  });

  it("fails closed when a participant vector is missing", () => {
    const group = makeGroup({
      participantIds: ["a", "b"],
      uniqueLegs: ["m1:o1"]
    });

    expect(() =>
      scorer.score(group, [
        makeVector({
          entityId: "a",
          vector: { "m1:o1": "1" }
        })
      ])
    ).toThrow("participant_vector_mismatch");
  });

  it("fails closed on duplicate participant vectors", () => {
    const group = makeGroup({
      participantIds: ["a"],
      uniqueLegs: ["m1:o1"]
    });

    expect(() =>
      scorer.score(group, [
        makeVector({
          entityId: "a",
          vector: { "m1:o1": "1" }
        }),
        makeVector({
          entityId: "a",
          vector: { "m1:o1": "2" }
        })
      ])
    ).toThrow("duplicate_participant_vector");
  });

  it("exposes deterministic tie-break fields for ranking", () => {
    const group = makeGroup({
      participantIds: ["a", "b"],
      uniqueLegs: ["m1:o1", "m2:o2"]
    });

    const score = scorer.score(group, [
      makeVector({
        entityId: "a",
        vector: { "m1:o1": "2" },
        grossAbsSize: "2",
        createdAt: "2026-03-10T08:00:00.000Z"
      }),
      makeVector({
        entityId: "b",
        vector: { "m1:o1": "-1", "m2:o2": "1" },
        grossAbsSize: "2",
        createdAt: "2026-03-10T08:30:00.000Z"
      })
    ]);

    expect(score.tieBreak).toEqual({
      smallestResidual: "2",
      oldestParticipantAt: "2026-03-10T08:00:00.000Z",
      participantCount: 2
    });
  });
});
