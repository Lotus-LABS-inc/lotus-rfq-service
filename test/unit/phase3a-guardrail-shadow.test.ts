import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ControlPlaneOverride } from "../../src/core/replay/control-plane.types.js";
import {
  Phase3AGuardrailShadowResolver,
  Phase3AGuardrailShadowResolverError,
  isPhase3AGuardrailShadowSampled,
  isPhase3AGuardrailShadowWindowActive,
  resolvePhase3AGuardrailShadow,
} from "../../src/guardrails/phase3a-guardrail-shadow.js";
import { metricsRegistry } from "../../src/observability/metrics.js";
import { loadEnv } from "../../src/utils/env.js";

const makeOverride = (
  scopeType: string,
  scopeId: string,
  enforcementMode: "ENFORCED" | "SHADOW",
  createdAt: string,
  id: string,
): ControlPlaneOverride => ({
  id,
  scopeType,
  scopeId,
  overrideType: "GUARDRAIL_ENFORCEMENT",
  payload: { enforcementMode },
  createdBy: "ops@example.com",
  createdAt: new Date(createdAt),
  expiresAt: null,
});

describe("Phase3A guardrail shadow resolver", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("samples deterministically for the same stable identifier", () => {
    const first = isPhase3AGuardrailShadowSampled("rfq-123", 0.25);
    const second = isPhase3AGuardrailShadowSampled("rfq-123", 0.25);

    expect(first).toBe(second);
  });

  it("respects rollout window boundaries", () => {
    expect(
      isPhase3AGuardrailShadowWindowActive(
        {
          enabled: true,
          percent: 0.25,
          startAt: "2026-03-12T10:00:00.000Z",
          endAt: "2026-03-12T12:00:00.000Z",
        },
        new Date("2026-03-12T11:00:00.000Z"),
      ),
    ).toBe(true);

    expect(
      isPhase3AGuardrailShadowWindowActive(
        {
          enabled: true,
          percent: 0.25,
          startAt: "2026-03-12T12:00:00.000Z",
          endAt: "2026-03-12T13:00:00.000Z",
        },
        new Date("2026-03-12T11:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("applies override precedence as ENGINE > BUCKET > SHARD > MARKET", () => {
    const result = resolvePhase3AGuardrailShadow({
      config: {
        enabled: true,
        percent: 1,
      },
      activeOverrides: [
        { override: makeOverride("MARKET", "market-a", "SHADOW", "2026-03-12T00:00:00.000Z", "1"), payload: { enforcementMode: "SHADOW" } },
        { override: makeOverride("SHARD", "shard-a", "ENFORCED", "2026-03-12T00:00:01.000Z", "2"), payload: { enforcementMode: "ENFORCED" } },
        { override: makeOverride("BUCKET", "bucket-a", "SHADOW", "2026-03-12T00:00:02.000Z", "3"), payload: { enforcementMode: "SHADOW" } },
        { override: makeOverride("ENGINE", "SOR", "ENFORCED", "2026-03-12T00:00:03.000Z", "4"), payload: { enforcementMode: "ENFORCED" } },
      ],
      resolutionInput: {
        engine: "SOR",
        shardId: "shard-a",
        bucketId: "bucket-a",
        marketId: "market-a",
        stableId: "rfq-123",
      },
    });

    expect(result).toMatchObject({
      enforcementMode: "ENFORCED",
      source: "override",
      matchedOverrideId: "4",
    });
  });

  it("uses the newest override within a matching scope", () => {
    const result = resolvePhase3AGuardrailShadow({
      config: {
        enabled: true,
        percent: 1,
      },
      activeOverrides: [
        { override: makeOverride("ENGINE", "SOR", "ENFORCED", "2026-03-12T00:00:00.000Z", "older"), payload: { enforcementMode: "ENFORCED" } },
        { override: makeOverride("ENGINE", "SOR", "SHADOW", "2026-03-12T00:00:01.000Z", "newer"), payload: { enforcementMode: "SHADOW" } },
      ],
      resolutionInput: {
        engine: "SOR",
        shardId: "shard-a",
        stableId: "rfq-123",
      },
    });

    expect(result).toMatchObject({
      enforcementMode: "SHADOW",
      source: "override",
      matchedOverrideId: "newer",
    });
  });

  it("fails closed on malformed GUARDRAIL_ENFORCEMENT payloads", async () => {
    const resolver = new Phase3AGuardrailShadowResolver({
      pool: {
        query: vi.fn(async () => ({
          rows: [
            {
              id: "bad-override",
              scope_type: "ENGINE",
              scope_id: "SOR",
              override_type: "GUARDRAIL_ENFORCEMENT",
              payload: { enforcementMode: "BROKEN" },
              created_by: "ops@example.com",
              created_at: new Date("2026-03-12T00:00:00.000Z"),
              expires_at: null,
            },
          ],
          rowCount: 1,
        })),
      } as never,
    });

    await expect(
      resolver.resolve({
        engine: "SOR",
        shardId: "shard-a",
        stableId: "rfq-123",
      }),
    ).rejects.toBeInstanceOf(Phase3AGuardrailShadowResolverError);
  });

  it("validates Phase 3A shadow env flags", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        REDIS_URL: "redis://localhost:6379",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lotus_rfq",
        JWT_SECRET: "12345678901234567890123456789012",
        PHASE3A_GUARDRAIL_SHADOW_ENABLED: "true",
        PHASE3A_GUARDRAIL_SHADOW_PERCENT: "0",
      }),
    ).toThrow(/PHASE3A_GUARDRAIL_SHADOW_PERCENT/);

    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        REDIS_URL: "redis://localhost:6379",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lotus_rfq",
        JWT_SECRET: "12345678901234567890123456789012",
        PHASE3A_GUARDRAIL_SHADOW_ENABLED: "true",
        PHASE3A_GUARDRAIL_SHADOW_PERCENT: "0.25",
        PHASE3A_GUARDRAIL_SHADOW_START_AT: "2026-03-13T00:00:00.000Z",
        PHASE3A_GUARDRAIL_SHADOW_END_AT: "2026-03-12T00:00:00.000Z",
      }),
    ).toThrow(/PHASE3A_GUARDRAIL_SHADOW_END_AT/);
  });
});
