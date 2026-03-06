import { describe, expect, it } from "vitest";
import {
  compareShadowDecisions,
  isCanarySampled,
  isCanaryWindowActive
} from "../../src/core/sor/canary-shadow.js";

describe("SOR canary selection", () => {
  it("is deterministic for the same session id and percent", () => {
    const sessionId = "9d4c2c8b-0f98-46d0-8aa6-98f6b3eb6c8a";
    const first = isCanarySampled(sessionId, 0.15);
    const second = isCanarySampled(sessionId, 0.15);

    expect(first).toBe(second);
  });

  it("respects canary window boundaries", () => {
    const now = () => new Date("2026-03-04T12:00:00.000Z");

    expect(
      isCanaryWindowActive({
        enabled: true,
        startAt: "2026-03-04T00:00:00.000Z",
        endAt: "2026-03-18T00:00:00.000Z",
        now
      })
    ).toBe(true);

    expect(
      isCanaryWindowActive({
        enabled: true,
        startAt: "2026-03-05T00:00:00.000Z",
        endAt: "2026-03-18T00:00:00.000Z",
        now
      })
    ).toBe(false);

    expect(
      isCanaryWindowActive({
        enabled: true,
        startAt: "2026-03-01T00:00:00.000Z",
        endAt: "2026-03-03T00:00:00.000Z",
        now
      })
    ).toBe(false);
  });

  it("compares decisions and classifies divergence reasons", () => {
    const matchByQuote = compareShadowDecisions(
      { quoteId: "q1", providerId: "lp-1", price: 1.01 },
      { quoteId: "q1", providerId: "lp-2", price: 1.02 }
    );
    expect(matchByQuote.match).toBe(true);
    expect(matchByQuote.dimension).toBe("quote_id");

    const noCandidate = compareShadowDecisions(
      { quoteId: "q1", providerId: "lp-1", price: 1.01 },
      null
    );
    expect(noCandidate.match).toBe(false);
    expect(noCandidate.reason).toBe("no_candidate");
  });
});

