import { describe, expect, it, vi } from "vitest";

import {
  ControlPlaneAdminService,
  ControlPlaneOverrideValidationError,
} from "../../src/api/admin/control-plane-admin-service.js";
import type { IPhase3AGuardrailShadowResolver } from "../../src/guardrails/phase3a-guardrail-shadow.js";
import type { GuardrailEnforcementMode } from "../../src/guardrails/planning-guardrail-helper.js";

describe("ControlPlaneAdminService", () => {
  it("returns Phase 3A guardrail shadow inspection details", async () => {
    const resolver: IPhase3AGuardrailShadowResolver = {
      getConfig: () => ({
        enabled: true,
        percent: 0.1,
        startAt: "2026-03-12T00:00:00.000Z",
      }),
      listActiveShadowOverrides: vi.fn(async () => [
        {
          override: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            scopeType: "ENGINE",
            scopeId: "SOR",
            overrideType: "GUARDRAIL_ENFORCEMENT",
            payload: { enforcementMode: "SHADOW", reason: "ops-shadow" },
            createdBy: "ops@example.com",
            createdAt: new Date("2026-03-12T01:00:00.000Z"),
            expiresAt: null,
          },
          payload: {
            enforcementMode: "SHADOW" as GuardrailEnforcementMode,
            reason: "ops-shadow",
          },
        },
      ]),
      resolve: vi.fn(async () => ({
        enforcementMode: "SHADOW" as GuardrailEnforcementMode,
        source: "override" as const,
        sampled: true,
        windowActive: true,
        matchedOverrideId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reason: "ops-shadow",
      })),
    };

    const service = new ControlPlaneAdminService({
      pool: { query: vi.fn() } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      phase3AGuardrailShadowResolver: resolver,
    });

    const inspection = await service.getPhase3AGuardrailShadowInspection({
      engine: "SOR",
      shardId: "sor-main",
      stableId: "rfq-123",
      marketId: "market-1",
    });

    expect(inspection.config.enabled).toBe(true);
    expect(inspection.effective.enforcementMode).toBe("SHADOW");
    expect(inspection.matchedOverride?.override.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(inspection.activeShadowOverrides).toHaveLength(1);
  });

  it("rejects malformed GUARDRAIL_ENFORCEMENT payloads on createOverride", async () => {
    const service = new ControlPlaneAdminService({
      pool: { query: vi.fn() } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(
      service.createOverride({
        scopeType: "ENGINE",
        scopeId: "SOR",
        overrideType: "GUARDRAIL_ENFORCEMENT",
        payload: { enforcementMode: "BROKEN" },
        createdBy: "ops@example.com",
      }),
    ).rejects.toBeInstanceOf(ControlPlaneOverrideValidationError);
  });
});
