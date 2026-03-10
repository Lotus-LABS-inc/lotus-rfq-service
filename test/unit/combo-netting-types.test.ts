import { describe, expect, it } from "vitest";
import type {
  ComboNettingEvent,
  ComboNettingGroup,
  ComboNettingMatchLeg
} from "../../src/core/combo-engine/types.js";

describe("combo netting domain types", () => {
  it("keeps matchedSize and price string-backed for persisted numeric safety", () => {
    const group: ComboNettingGroup = {
      id: "d4a57fb6-f0af-4cf2-ab0d-7ceb7c76c287",
      incomingComboId: "4ce2555d-f2a8-4af3-993a-1816cf847f6d",
      matchedComboId: "8070dc1b-f7a4-4018-abfd-e8f9c52021c3",
      state: "MATCHED",
      matchedSize: "12.50000000",
      createdAt: new Date("2026-03-10T12:00:00.000Z")
    };

    const matchLeg: ComboNettingMatchLeg = {
      id: "ec0ae370-1b08-4180-a82b-cfd1d9c7ac98",
      nettingGroupId: group.id,
      incomingLegId: "f4af70a7-7a25-4938-90f2-b4c3c2cf5bd7",
      matchedLegId: "596c73a7-28cf-41f4-b756-b5f80d10ebfe",
      marketId: "canonical-market-1",
      outcomeId: "canonical-outcome-yes",
      matchedSize: "12.50000000",
      price: "0.42000000",
      createdAt: new Date("2026-03-10T12:00:00.000Z")
    };

    expect(typeof group.matchedSize).toBe("string");
    expect(typeof matchLeg.matchedSize).toBe("string");
    expect(typeof matchLeg.price).toBe("string");
  });

  it("keeps payload typed as structured json rather than any", () => {
    const event: ComboNettingEvent = {
      id: "6c2a78b9-2bfa-4dd2-b4e0-770b33ffb751",
      nettingGroupId: "d4a57fb6-f0af-4cf2-ab0d-7ceb7c76c287",
      eventType: "NETTING_MATCHED",
      payload: {
        correlationId: "phase2a-netting-1",
        incomingComboId: "4ce2555d-f2a8-4af3-993a-1816cf847f6d",
        matchedComboId: "8070dc1b-f7a4-4018-abfd-e8f9c52021c3"
      },
      createdAt: new Date("2026-03-10T12:00:00.000Z")
    };

    expect(event.payload).toHaveProperty("correlationId", "phase2a-netting-1");
    expect(typeof event.payload).toBe("object");
  });
});
