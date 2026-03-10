import { describe, expect, it } from "vitest";

import {
  compareInternalNettingShadowDecision,
  isInternalNettingRolloutWindowActive,
  isInternalNettingSampled
} from "../../src/core/combo-engine/runtime-controls.js";
import { loadEnv } from "../../src/utils/env.js";

describe("internal-netting runtime controls", () => {
  it("samples deterministically for the same stable identifier", () => {
    const first = isInternalNettingSampled("combo-1", 0.2);
    const second = isInternalNettingSampled("combo-1", 0.2);
    expect(first).toBe(second);
  });

  it("respects rollout window boundaries", () => {
    expect(
      isInternalNettingRolloutWindowActive({
        enabled: true,
        percent: 0.25,
        startAt: "2026-03-10T10:00:00.000Z",
        endAt: "2026-03-10T12:00:00.000Z",
        now: () => new Date("2026-03-10T11:00:00.000Z")
      })
    ).toBe(true);

    expect(
      isInternalNettingRolloutWindowActive({
        enabled: true,
        percent: 0.25,
        startAt: "2026-03-10T12:00:00.000Z",
        endAt: "2026-03-10T13:00:00.000Z",
        now: () => new Date("2026-03-10T11:00:00.000Z")
      })
    ).toBe(false);
  });

  it("classifies matching and divergent shadow comparisons", () => {
    expect(
      compareInternalNettingShadowDecision(
        { outcome: "partial_net", residualLegCount: 1, nettedSize: 5 },
        { outcome: "partial_net", residualLegCount: 1, nettedSize: 5 }
      )
    ).toEqual({
      match: true,
      dimension: "netted_outcome"
    });

    expect(
      compareInternalNettingShadowDecision(
        { outcome: "no_net", residualLegCount: 2, nettedSize: 0 },
        { outcome: "partial_net", residualLegCount: 1, nettedSize: 4 }
      )
    ).toEqual({
      match: false,
      dimension: "netted_outcome",
      reason: "different_netting_outcome"
    });
  });

  it("validates internal-netting shadow and canary env flags", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        REDIS_URL: "redis://localhost:6379",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lotus_rfq",
        JWT_SECRET: "12345678901234567890123456789012",
        INTERNAL_NETTING_SHADOW_ENABLED: "true",
        INTERNAL_NETTING_SHADOW_PERCENT: "0"
      })
    ).toThrow(/INTERNAL_NETTING_SHADOW_PERCENT/);

    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        REDIS_URL: "redis://localhost:6379",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lotus_rfq",
        JWT_SECRET: "12345678901234567890123456789012",
        INTERNAL_NETTING_CANARY_ENABLED: "true",
        INTERNAL_NETTING_CANARY_PERCENT: "0.1",
        INTERNAL_NETTING_CANARY_START_AT: "2026-03-11T00:00:00.000Z",
        INTERNAL_NETTING_CANARY_END_AT: "2026-03-10T00:00:00.000Z"
      })
    ).toThrow(/INTERNAL_NETTING_CANARY_END_AT/);
  });
});
