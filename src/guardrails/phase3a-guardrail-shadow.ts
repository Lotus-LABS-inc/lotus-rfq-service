import { createHash } from "node:crypto";

import type { Pool } from "pg";

import type { ControlPlaneOverride } from "../core/replay/control-plane.types.js";
import { phase3aGuardrailShadowResolutionTotal } from "../observability/metrics.js";
import type { GuardrailEnforcementMode } from "./planning-guardrail-helper.js";
import {
  loadActiveControlPlaneOverrides,
  selectMatchingControlPlaneOverride,
  type ControlPlaneScopeContext,
} from "./degradation-manager.js";

export type Phase3AGuardrailShadowEngine = Extract<
  ControlPlaneScopeContext["engine"],
  "SOR" | "NETTING_PHASE2A" | "CLEARING_PHASE2B"
>;

export interface Phase3AGuardrailShadowConfig {
  readonly enabled: boolean;
  readonly percent: number;
  readonly startAt?: string;
  readonly endAt?: string;
}

export interface Phase3AGuardrailShadowResolutionInput {
  readonly engine: Phase3AGuardrailShadowEngine;
  readonly shardId: string;
  readonly stableId: string;
  readonly bucketId?: string | null;
  readonly marketId?: string | null;
  readonly now?: Date;
}

export interface Phase3AGuardrailShadowResolution {
  readonly enforcementMode: GuardrailEnforcementMode;
  readonly source: "override" | "env" | "default";
  readonly sampled: boolean;
  readonly windowActive: boolean;
  readonly matchedOverrideId?: string;
  readonly reason: string;
}

export interface GuardrailEnforcementOverridePayload {
  readonly enforcementMode: GuardrailEnforcementMode;
  readonly reason?: string;
}

export interface Phase3AGuardrailShadowOverride {
  readonly override: ControlPlaneOverride;
  readonly payload: GuardrailEnforcementOverridePayload;
}

export interface IPhase3AGuardrailShadowResolver {
  getConfig(): Phase3AGuardrailShadowConfig;
  listActiveShadowOverrides(
    input: Omit<Phase3AGuardrailShadowResolutionInput, "stableId" | "now">
  ): Promise<readonly Phase3AGuardrailShadowOverride[]>;
  resolve(input: Phase3AGuardrailShadowResolutionInput): Promise<Phase3AGuardrailShadowResolution>;
}

export class Phase3AGuardrailShadowResolverError extends Error {
  public readonly code: "malformed_override_payload";

  public constructor(message: string) {
    super(message);
    this.name = "Phase3AGuardrailShadowResolverError";
    this.code = "malformed_override_payload";
  }
}

const DISABLED_CONFIG: Phase3AGuardrailShadowConfig = Object.freeze({
  enabled: false,
  percent: 0,
});

const toUint32 = (hex: string): number => Number.parseInt(hex, 16) >>> 0;

export const isPhase3AGuardrailShadowWindowActive = (
  config: Phase3AGuardrailShadowConfig,
  now: Date = new Date()
): boolean => {
  if (!config.enabled || config.percent <= 0) {
    return false;
  }

  const nowMs = now.getTime();
  if (config.startAt) {
    const start = Date.parse(config.startAt);
    if (Number.isFinite(start) && nowMs < start) {
      return false;
    }
  }

  if (config.endAt) {
    const end = Date.parse(config.endAt);
    if (Number.isFinite(end) && nowMs > end) {
      return false;
    }
  }

  return true;
};

export const isPhase3AGuardrailShadowSampled = (stableId: string, percent: number): boolean => {
  if (percent <= 0) {
    return false;
  }
  if (percent >= 1) {
    return true;
  }

  const digest = createHash("sha256").update(stableId).digest("hex");
  const bucket = toUint32(digest.slice(0, 8)) / 0xffffffff;
  return bucket < percent;
};

export const parseGuardrailEnforcementOverridePayload = (
  payload: Record<string, unknown>
): GuardrailEnforcementOverridePayload => {
  const enforcementMode = payload.enforcementMode;
  const reason = payload.reason;

  if (enforcementMode !== "ENFORCED" && enforcementMode !== "SHADOW") {
    throw new Phase3AGuardrailShadowResolverError(
      "GUARDRAIL_ENFORCEMENT override payload.enforcementMode is invalid."
    );
  }

  if (reason !== undefined && typeof reason !== "string") {
    throw new Phase3AGuardrailShadowResolverError(
      "GUARDRAIL_ENFORCEMENT override payload.reason must be a string when present."
    );
  }

  return {
    enforcementMode,
    ...(typeof reason === "string" ? { reason } : {}),
  };
};

export const resolvePhase3AGuardrailShadow = (input: {
  readonly config: Phase3AGuardrailShadowConfig;
  readonly activeOverrides: readonly Phase3AGuardrailShadowOverride[];
  readonly resolutionInput: Phase3AGuardrailShadowResolutionInput;
}): Phase3AGuardrailShadowResolution => {
  const matchedOverride = selectMatchingControlPlaneOverride(
    input.activeOverrides.map((entry) => entry.override),
    input.resolutionInput
  );

  if (matchedOverride) {
    const overrideEntry = input.activeOverrides.find((entry) => entry.override.id === matchedOverride.id);
    if (!overrideEntry) {
      throw new Phase3AGuardrailShadowResolverError(
        `Matched override ${matchedOverride.id} is missing parsed payload state.`
      );
    }

    return {
      enforcementMode: overrideEntry.payload.enforcementMode,
      source: "override",
      sampled: overrideEntry.payload.enforcementMode === "SHADOW",
      windowActive: true,
      matchedOverrideId: matchedOverride.id,
      reason: overrideEntry.payload.reason ?? `override:${matchedOverride.scopeType}:${matchedOverride.scopeId}`,
    };
  }

  const now = input.resolutionInput.now ?? new Date();
  const windowActive = isPhase3AGuardrailShadowWindowActive(input.config, now);
  const sampled = windowActive
    ? isPhase3AGuardrailShadowSampled(input.resolutionInput.stableId, input.config.percent)
    : false;

  if (windowActive && sampled) {
    return {
      enforcementMode: "SHADOW",
      source: "env",
      sampled,
      windowActive,
      reason: "env_rollout_sampled",
    };
  }

  return {
    enforcementMode: "ENFORCED",
    source: "default",
    sampled,
    windowActive,
    reason: windowActive ? "env_rollout_unsampled" : "env_rollout_inactive",
  };
};

export class Phase3AGuardrailShadowResolver implements IPhase3AGuardrailShadowResolver {
  private readonly config: Phase3AGuardrailShadowConfig;

  public constructor(
    private readonly deps: {
      readonly pool: Pick<Pool, "query">;
      readonly config?: Phase3AGuardrailShadowConfig;
    }
  ) {
    this.config = Object.freeze({
      ...DISABLED_CONFIG,
      ...(deps.config ?? {}),
    });
  }

  public getConfig(): Phase3AGuardrailShadowConfig {
    return this.config;
  }

  public async listActiveShadowOverrides(
    input: Omit<Phase3AGuardrailShadowResolutionInput, "stableId" | "now">
  ): Promise<readonly Phase3AGuardrailShadowOverride[]> {
    const overrides = await loadActiveControlPlaneOverrides(this.deps.pool, input);
    return overrides
      .filter((override) => override.overrideType === "GUARDRAIL_ENFORCEMENT")
      .map((override) => ({
        override,
        payload: parseGuardrailEnforcementOverridePayload(override.payload),
      }));
  }

  public async resolve(
    input: Phase3AGuardrailShadowResolutionInput
  ): Promise<Phase3AGuardrailShadowResolution> {
    const activeOverrides = await this.listActiveShadowOverrides(input);
    const resolution = resolvePhase3AGuardrailShadow({
      config: this.config,
      activeOverrides,
      resolutionInput: input,
    });

    phase3aGuardrailShadowResolutionTotal
      .labels(input.engine, resolution.source, resolution.enforcementMode)
      .inc();

    return resolution;
  }
}
