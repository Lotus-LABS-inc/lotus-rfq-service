import type { Pool } from "pg";
import type { Logger } from "pino";

import type {
  ControlPlaneOverride,
  ExecutionMode,
} from "../core/replay/control-plane.types.js";
import type {
  GuardrailEvaluationResult,
  GuardrailViolation,
} from "./guardrail-evaluator.js";
import { degradedModeActivationsTotal } from "../observability/metrics.js";

export type { ExecutionMode } from "../core/replay/control-plane.types.js";

export interface DegradationContext {
  readonly shardId: string;
  readonly bucketId?: string | null;
  readonly engine: "SOR" | "INTERNAL_CROSS" | "NETTING_PHASE2A" | "CLEARING_PHASE2B";
  readonly marketId?: string | null;
  readonly guardrailEvaluation?: GuardrailEvaluationResult | null;
}

export interface EffectiveExecutionModeResult {
  readonly mode: ExecutionMode;
  readonly reason: string;
  readonly source: "override" | "guardrail" | "default";
  readonly matchedOverrideId?: string;
  readonly violations?: readonly GuardrailViolation[];
}

export interface ControlPlaneScopeContext {
  readonly shardId: string;
  readonly bucketId?: string | null;
  readonly engine: "SOR" | "INTERNAL_CROSS" | "NETTING_PHASE2A" | "CLEARING_PHASE2B";
  readonly marketId?: string | null;
}

interface PlannerShardModeRow {
  mode: string;
}

interface ControlPlaneOverrideRow {
  id: string;
  scope_type: string;
  scope_id: string;
  override_type: string;
  payload: Record<string, unknown>;
  created_by: string;
  created_at: Date;
  expires_at: Date | null;
}

export interface DegradationManagerDeps {
  readonly pool: Pool;
  readonly logger: Pick<Logger, "info" | "warn" | "error">;
}

export interface GetEffectiveExecutionModeOptions {
  readonly requestedBy?: string;
  readonly persist?: boolean;
}

export interface IDegradationManager {
  getEffectiveExecutionMode(
    context: DegradationContext,
    options?: GetEffectiveExecutionModeOptions,
  ): Promise<EffectiveExecutionModeResult>;
}

export class DegradationManagerError extends Error {
  public readonly code:
    | "invalid_context"
    | "malformed_override_payload"
    | "planner_shard_not_found"
    | "persistence_failed";

  public constructor(
    message: string,
    code:
      | "invalid_context"
      | "malformed_override_payload"
      | "planner_shard_not_found"
      | "persistence_failed",
  ) {
    super(message);
    this.name = "DegradationManagerError";
    this.code = code;
  }
}

export const OVERRIDE_SCOPE_PRECEDENCE: ReadonlyArray<"ENGINE" | "BUCKET" | "SHARD" | "MARKET"> = [
  "ENGINE",
  "BUCKET",
  "SHARD",
  "MARKET",
] as const;

const MODE_PRECEDENCE: readonly ExecutionMode[] = [
  "SAFE_FALLBACK",
  "DISABLE_PHASE2A_AND_2B",
  "DISABLE_INTERNAL_CROSS",
  "DISABLE_PHASE2B",
  "SOR_ONLY",
  "FULL_MODE",
] as const;

export class DegradationManager implements IDegradationManager {
  public constructor(private readonly deps: DegradationManagerDeps) {}

  public async getEffectiveExecutionMode(
    context: DegradationContext,
    options: GetEffectiveExecutionModeOptions = {},
  ): Promise<EffectiveExecutionModeResult> {
    this.validateContext(context);

    const activeOverrides = await this.loadActiveOverrides(context);
    const matchedOverride = this.selectMatchingOverride(activeOverrides, context);
    const result = matchedOverride
      ? this.buildOverrideResult(matchedOverride)
      : this.buildGuardrailOrDefaultResult(context.guardrailEvaluation ?? null);

    if (options.persist !== false) {
      await this.persistModeTransitionIfNeeded(
        context,
        result,
        matchedOverride ?? null,
        options.requestedBy ?? "degradation-manager",
      );
    }

    return result;
  }

  private validateContext(context: DegradationContext): void {
    if (context.shardId.trim().length === 0) {
      throw new DegradationManagerError("shardId must not be empty.", "invalid_context");
    }
    if (context.engine !== "SOR" &&
        context.engine !== "INTERNAL_CROSS" &&
        context.engine !== "NETTING_PHASE2A" &&
        context.engine !== "CLEARING_PHASE2B") {
      throw new DegradationManagerError("Unsupported engine.", "invalid_context");
    }
  }

  private async loadActiveOverrides(context: DegradationContext): Promise<readonly ControlPlaneOverride[]> {
    return loadActiveControlPlaneOverrides(this.deps.pool, context);
  }

  private selectMatchingOverride(
    overrides: readonly ControlPlaneOverride[],
    context: DegradationContext,
  ): ControlPlaneOverride | null {
    return selectMatchingControlPlaneOverride(overrides, context);
  }

  private buildOverrideResult(override: ControlPlaneOverride): EffectiveExecutionModeResult {
    const payload = this.parseOverridePayload(override.payload);
    return {
      mode: payload.mode,
      reason: payload.reason ?? `override:${override.overrideType}`,
      source: "override",
      matchedOverrideId: override.id,
    };
  }

  private buildGuardrailOrDefaultResult(
    guardrailEvaluation: GuardrailEvaluationResult | null,
  ): EffectiveExecutionModeResult {
    if (guardrailEvaluation?.violated && guardrailEvaluation.suggestedDegradation) {
      return {
        mode: guardrailEvaluation.suggestedDegradation,
        reason: guardrailEvaluation.violations.map((violation) => violation.type).join(","),
        source: "guardrail",
        violations: guardrailEvaluation.violations,
      };
    }

    return {
      mode: "FULL_MODE",
      reason: "no_override_or_guardrail_violation",
      source: "default",
      violations: guardrailEvaluation?.violations ?? [],
    };
  }

  private parseOverridePayload(payload: Record<string, unknown>): {
    mode: ExecutionMode;
    reason?: string;
  } {
    const mode = payload.mode;
    const reason = payload.reason;

    if (!isExecutionMode(mode)) {
      throw new DegradationManagerError("Override payload.mode is invalid.", "malformed_override_payload");
    }
    if (reason !== undefined && typeof reason !== "string") {
      throw new DegradationManagerError("Override payload.reason must be a string when present.", "malformed_override_payload");
    }

    return {
      mode,
      ...(typeof reason === "string" ? { reason } : {}),
    };
  }

  private async persistModeTransitionIfNeeded(
    context: DegradationContext,
    result: EffectiveExecutionModeResult,
    matchedOverride: ControlPlaneOverride | null,
    requestedBy: string,
  ): Promise<void> {
    const currentMode = await this.loadCurrentShardMode(context.shardId);
    if (currentMode === result.mode) {
      return;
    }

    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      const updateResult = await client.query<PlannerShardModeRow>(
        `UPDATE planner_shard_state
            SET mode = $2,
                updated_at = NOW()
          WHERE shard_id = $1
        RETURNING mode`,
        [context.shardId, result.mode],
      );

      if (updateResult.rowCount !== 1) {
        throw new DegradationManagerError(
          `Planner shard ${context.shardId} not found.`,
          "planner_shard_not_found",
        );
      }

      await client.query(
        `INSERT INTO control_plane_audit_events (
           event_type,
           scope_type,
           scope_id,
           engine,
           previous_mode,
           new_mode,
           reason,
           payload,
           created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          "execution_mode_changed",
          matchedOverride ? matchedOverride.scopeType : "SHARD",
          matchedOverride ? matchedOverride.scopeId : context.shardId,
          context.engine,
          currentMode,
          result.mode,
          result.reason,
          JSON.stringify({
            shardId: context.shardId,
            ...(context.bucketId ? { bucketId: context.bucketId } : {}),
            ...(context.marketId ? { marketId: context.marketId } : {}),
            engine: context.engine,
            ...(matchedOverride
              ? {
                  matchedOverride: {
                    id: matchedOverride.id,
                    scopeType: matchedOverride.scopeType,
                    scopeId: matchedOverride.scopeId,
                    overrideType: matchedOverride.overrideType,
                  },
                }
              : {}),
            ...(context.guardrailEvaluation
              ? {
                  guardrailEvaluation: {
                    violated: context.guardrailEvaluation.violated,
                    violations: context.guardrailEvaluation.violations,
                    suggestedDegradation:
                      context.guardrailEvaluation.suggestedDegradation ?? null,
                  },
                }
              : {}),
          }),
          requestedBy,
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof DegradationManagerError) {
        throw error;
      }
      throw new DegradationManagerError("Failed to persist degradation mode transition.", "persistence_failed");
    } finally {
      client.release();
    }

    if (result.mode !== "FULL_MODE") {
      degradedModeActivationsTotal.labels(result.mode, result.source, context.engine).inc();
    }

    this.deps.logger.info(
      {
        action: "degradation_mode_transition",
        shardId: context.shardId,
        bucketId: context.bucketId ?? null,
        marketId: context.marketId ?? null,
        engine: context.engine,
        previousMode: currentMode,
        newMode: result.mode,
        source: result.source,
        matchedOverrideId: result.matchedOverrideId ?? null,
        requestedBy,
      },
      "Applied effective execution mode transition.",
    );
  }

  private async loadCurrentShardMode(shardId: string): Promise<string> {
    const result = await this.deps.pool.query<PlannerShardModeRow>(
      `SELECT mode
         FROM planner_shard_state
        WHERE shard_id = $1
        LIMIT 1`,
      [shardId],
    );

    if (result.rowCount !== 1) {
      throw new DegradationManagerError(`Planner shard ${shardId} not found.`, "planner_shard_not_found");
    }

    return result.rows[0]!.mode;
  }
}

export const selectMostConservativeExecutionMode = (
  modes: readonly ExecutionMode[],
): ExecutionMode => {
  for (const mode of MODE_PRECEDENCE) {
    if (modes.includes(mode)) {
      return mode;
    }
  }

  throw new DegradationManagerError("Unable to select execution mode.", "invalid_context");
};

const isExecutionMode = (value: unknown): value is ExecutionMode =>
  value === "FULL_MODE" ||
  value === "DISABLE_PHASE2B" ||
  value === "DISABLE_PHASE2A_AND_2B" ||
  value === "DISABLE_INTERNAL_CROSS" ||
  value === "SOR_ONLY" ||
  value === "SAFE_FALLBACK";

export const loadActiveControlPlaneOverrides = async (
  pool: Pick<Pool, "query">,
  context: ControlPlaneScopeContext,
): Promise<readonly ControlPlaneOverride[]> => {
  const scopeClauses: string[] = ["(scope_type = 'ENGINE' AND scope_id = $1)", "(scope_type = 'SHARD' AND scope_id = $2)"];
  const values: Array<string | null> = [context.engine, context.shardId];

  if (context.bucketId) {
    values.push(context.bucketId);
    scopeClauses.push(`(scope_type = 'BUCKET' AND scope_id = $${values.length})`);
  }

  if (context.marketId) {
    values.push(context.marketId);
    scopeClauses.push(`(scope_type = 'MARKET' AND scope_id = $${values.length})`);
  }

  const result = await pool.query<ControlPlaneOverrideRow>(
    `SELECT id, scope_type, scope_id, override_type, payload, created_by, created_at, expires_at
       FROM control_plane_overrides
      WHERE (expires_at IS NULL OR expires_at > NOW())
        AND (${scopeClauses.join(" OR ")})
      ORDER BY created_at DESC, id DESC`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    overrideType: row.override_type,
    payload: row.payload,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
};

export const selectMatchingControlPlaneOverride = (
  overrides: readonly ControlPlaneOverride[],
  context: ControlPlaneScopeContext,
): ControlPlaneOverride | null => {
  for (const scopeType of OVERRIDE_SCOPE_PRECEDENCE) {
    const scoped = overrides
      .filter((override) => override.scopeType === scopeType)
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      );
    if (scoped.length === 0) {
      continue;
    }

    const matched = scoped.find((override) => {
      switch (scopeType) {
        case "ENGINE":
          return override.scopeId === context.engine;
        case "BUCKET":
          return context.bucketId !== null && context.bucketId !== undefined && override.scopeId === context.bucketId;
        case "SHARD":
          return override.scopeId === context.shardId;
        case "MARKET":
          return context.marketId !== null && context.marketId !== undefined && override.scopeId === context.marketId;
        default:
          return false;
      }
    });

    if (matched) {
      return matched;
    }
  }

  return null;
};
