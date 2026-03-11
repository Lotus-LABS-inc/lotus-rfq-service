import { describe, expect, it } from "vitest";
import type {
  ClearingRound,
  ClearingRoundEvent,
  ClearingRoundLegMatch,
  ClearingRoundParticipant,
  ClearingParticipantRole,
  ClearingRoundState
} from "../../src/core/combo-engine/types.js";

describe("phase2b clearing round domain types", () => {
  it("keeps numeric persisted fields string-backed", () => {
    const round: ClearingRound = {
      id: "6d0ffdca-911d-42aa-a038-ae83db6c7f42",
      compatibilityBucket: "bucket:canonical:yes-no",
      state: "MATCHED",
      participantCount: 4,
      uniqueLegCount: 6,
      compressionScore: "3.25000000",
      participantSetHash: "participant-set-hash",
      matchSignatureHash: "match-signature-hash",
      createdAt: new Date("2026-03-10T12:00:00.000Z")
    };

    const legMatch: ClearingRoundLegMatch = {
      id: "f6fb6926-4b6e-4fea-ac0d-8211961cc6c8",
      clearingRoundId: round.id,
      marketId: "canonical-market-1",
      outcomeId: "canonical-outcome-yes",
      participantId: "2da7debe-c054-4c42-ad4d-8bc0a103d8d1",
      signedMatchedSize: "-2.50000000",
      price: "0.42000000",
      createdAt: new Date("2026-03-10T12:00:00.000Z")
    };

    expect(typeof round.compressionScore).toBe("string");
    expect(typeof legMatch.signedMatchedSize).toBe("string");
    expect(typeof legMatch.price).toBe("string");
  });

  it("keeps json payloads and remaining snapshots structured", () => {
    const participant: ClearingRoundParticipant = {
      id: "6b8ec3c4-b869-4b1c-8f05-5d175d8313c2",
      clearingRoundId: "6d0ffdca-911d-42aa-a038-ae83db6c7f42",
      comboOrOrderId: "67c26ff4-93cd-4931-b8d9-2afd5f5bb0dc",
      participantUserId: "75857fc3-3b4b-4512-b7b9-80fb140a17da",
      role: "INCOMING",
      originalRemaining: { marketA: "5.0", marketB: "3.0" },
      matchedRemaining: { marketA: "2.5", marketB: "0.0" },
      createdAt: new Date("2026-03-10T12:00:00.000Z")
    };

    const event: ClearingRoundEvent = {
      id: "d088d47f-34a8-4330-ac6f-9fa4dca6ef20",
      clearingRoundId: participant.clearingRoundId,
      eventType: "CLEARING_MATCHED",
      payload: {
        correlationId: "phase2b-clearing-1",
        roundId: participant.clearingRoundId
      },
      createdAt: new Date("2026-03-10T12:00:00.000Z")
    };

    expect(participant.originalRemaining).toHaveProperty("marketA", "5.0");
    expect(participant.matchedRemaining).toHaveProperty("marketB", "0.0");
    expect(event.payload).toHaveProperty("correlationId", "phase2b-clearing-1");
  });

  it("exposes constrained enum values for round state and participant role", () => {
    const state: ClearingRoundState = "UNWOUND";
    const role: ClearingParticipantRole = "RESIDUAL";

    expect(state).toBe("UNWOUND");
    expect(role).toBe("RESIDUAL");
  });
});
