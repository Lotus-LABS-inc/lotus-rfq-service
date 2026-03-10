import { describe, expect, it } from "vitest";
import {
  isInternalCrossShadowSampled,
  isInternalCrossShadowWindowActive
} from "../../src/core/internal-engine/runtime-controls.js";

describe("internal-cross runtime controls", () => {
  it("samples deterministically for the same stable identifier", () => {
    const first = isInternalCrossShadowSampled("session-1", 0.25);
    const second = isInternalCrossShadowSampled("session-1", 0.25);
    expect(first).toBe(second);
  });

  it("respects shadow window boundaries", () => {
    expect(
      isInternalCrossShadowWindowActive({
        enabled: true,
        percent: 0.2,
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-10T12:00:00.000Z",
        now: () => new Date("2026-03-10T11:00:00.000Z")
      })
    ).toBe(true);

    expect(
      isInternalCrossShadowWindowActive({
        enabled: true,
        percent: 0.2,
        startAt: "2026-03-10T12:00:00.000Z",
        endAt: "2026-03-10T13:00:00.000Z",
        now: () => new Date("2026-03-10T11:00:00.000Z")
      })
    ).toBe(false);
  });
});
