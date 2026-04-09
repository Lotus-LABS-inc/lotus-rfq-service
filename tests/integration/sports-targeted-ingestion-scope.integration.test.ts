import { describe, expect, it } from "vitest";

import { buildSportsTargetedIngestionScope, sportsHeldPocketReferences, sportsTargetedPriorityOrder } from "../../src/matching/sports/sports-targeted-ingestion-scope.js";

describe("sports-targeted-ingestion-scope", () => {
  it("emits the new active pockets and live window defaults", () => {
    const scope = buildSportsTargetedIngestionScope(new Date("2026-04-02T12:00:00.000Z"));

    expect(scope.activePockets.map((entry) => entry.pocket)).toEqual(sportsTargetedPriorityOrder);
    expect(scope.heldPocketReferences).toEqual(sportsHeldPocketReferences);
    expect(scope.liveWindow.lookbackHours).toBe(6);
    expect(scope.liveWindow.lookaheadHours).toBe(72);
    expect(scope.liveWindow.startsAt).toBe("2026-04-02T06:00:00.000Z");
    expect(scope.liveWindow.endsAt).toBe("2026-04-05T12:00:00.000Z");
    expect(scope.marketFamilyAllowlist).toEqual(["MATCHUP_WINNER"]);
  });
});
