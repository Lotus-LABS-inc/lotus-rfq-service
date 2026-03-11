import { describe, expect, it, vi } from "vitest";

import {
  INTERNAL_CLEARING_KILL_SWITCH_KEY,
  compareInternalClearingShadowDecision,
  isInternalClearingKillSwitchActive,
  isInternalClearingRolloutWindowActive,
  isInternalClearingSampled
} from "../../src/core/combo-engine/internal-clearing-runtime-controls.js";

describe("internal-clearing runtime controls", () => {
  it("activates rollout windows only when enabled, sampled percent is positive, and current time is inside the window", () => {
    expect(
      isInternalClearingRolloutWindowActive({
        enabled: true,
        percent: 0.25,
        startAt: "2026-03-11T10:00:00.000Z",
        endAt: "2026-03-11T12:00:00.000Z",
        now: () => new Date("2026-03-11T11:00:00.000Z")
      })
    ).toBe(true);

    expect(
      isInternalClearingRolloutWindowActive({
        enabled: false,
        percent: 0.25,
        now: () => new Date("2026-03-11T11:00:00.000Z")
      })
    ).toBe(false);

    expect(
      isInternalClearingRolloutWindowActive({
        enabled: true,
        percent: 0,
        now: () => new Date("2026-03-11T11:00:00.000Z")
      })
    ).toBe(false);

    expect(
      isInternalClearingRolloutWindowActive({
        enabled: true,
        percent: 0.25,
        startAt: "2026-03-11T12:00:00.000Z",
        endAt: "2026-03-11T13:00:00.000Z",
        now: () => new Date("2026-03-11T11:00:00.000Z")
      })
    ).toBe(false);
  });

  it("samples deterministically by stable id", () => {
    const stableId = "combo-phase2b-shadow";
    const decisions = Array.from({ length: 5 }, () => isInternalClearingSampled(stableId, 0.5));
    expect(new Set(decisions)).toEqual(new Set([decisions[0]]));
  });

  it("compares shadow decisions deterministically", () => {
    expect(
      compareInternalClearingShadowDecision(
        { outcome: "partial_clear", residualLegCount: 2, participantCount: 3 },
        { outcome: "partial_clear", residualLegCount: 2, participantCount: 4 }
      )
    ).toEqual({ match: true, dimension: "clearing_outcome" });

    expect(
      compareInternalClearingShadowDecision(
        { outcome: "no_clear", residualLegCount: 2, participantCount: 1 },
        { outcome: "full_clear", residualLegCount: 0, participantCount: 3 }
      )
    ).toEqual({
      match: false,
      dimension: "clearing_outcome",
      reason: "different_clearing_outcome"
    });

    expect(
      compareInternalClearingShadowDecision(
        { outcome: "partial_clear", residualLegCount: 2, participantCount: 3 },
        { outcome: "partial_clear", residualLegCount: 1, participantCount: 3 }
      )
    ).toEqual({
      match: false,
      dimension: "residual_leg_count",
      reason: "different_residual_size"
    });
  });

  it("treats supported kill-switch values as active", async () => {
    const get = vi.fn(async (key: string) => {
      expect(key).toBe(INTERNAL_CLEARING_KILL_SWITCH_KEY);
      return "enabled";
    });

    await expect(isInternalClearingKillSwitchActive({ get })).resolves.toBe(true);
    await expect(isInternalClearingKillSwitchActive({ get: vi.fn(async () => "false") })).resolves.toBe(false);
    await expect(isInternalClearingKillSwitchActive({ get: vi.fn(async () => null) })).resolves.toBe(false);
  });
});
