import type { Pool } from "pg";
import type { Logger } from "pino";

import type { BucketState, ControlPlaneOverride, PlannerShardState } from "../../core/replay/control-plane.types.js";
import type { ExecutionMode } from "../../guardrails/degradation-manager.js";
import {
  Phase3AGuardrailShadowResolver,
  type IPhase3AGuardrailShadowResolver,
  type Phase3AGuardrailShadowConfig,
  type Phase3AGuardrailShadowEngine,
  type Phase3AGuardrailShadowResolution,
  type Phase3AGuardrailShadowOverride,
  parseGuardrailEnforcementOverridePayload,
  resolvePhase3AGuardrailShadow,
} from "../../guardrails/phase3a-guardrail-shadow.js";
import { bucketDrainedTotal, plannerShardPausedTotal } from "../../observability/metrics.js";

interface PlannerShardStateRow {
  shard_id: string;
  mode: string;
  active_plans: number;
  active_buckets: number;
  stale_reservations: number;
  avg_planner_latency_ms: string | null;
  updated_at: Date;
}

interface BucketStateRow {
  bucket_id: string;
  bucket_type: string;
  mode: string;
  entity_count: number;
  graph_density: string | null;
  degradation_reason: string | null;
  updated_at: Date;
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

interface ReplayEnvelopeMetadataRow {
  id: string;
  decision_type: string;
  entity_id: string;
  correlation_id: string;
  config_version: string;
  engine_version: string;
  created_at: Date;
}

export interface ControlPlaneBucketFilters {
  bucketType?: string;
  mode?: string;
}

export interface ReplayEnvelopeMetadata {
  id: string;
  decisionType: string;
  entityId: string;
  correlationId: string;
  configVersion: string;
  engineVersion: string;
  createdAt: Date;
}

export interface Phase3AGuardrailShadowInspectionInput {
  engine: Phase3AGuardrailShadowEngine;
  shardId: string;
  stableId: string;
  bucketId?: string | null;
  marketId?: string | null;
}

export interface Phase3AGuardrailShadowInspectionResult {
  config: Phase3AGuardrailShadowConfig;
  effective: Phase3AGuardrailShadowResolution & {
    context: {
      engine: Phase3AGuardrailShadowEngine;
      shardId: string;
      stableId: string;
      bucketId: string | null;
      marketId: string | null;
    };
  };
  matchedOverride: Phase3AGuardrailShadowOverride | null;
  activeShadowOverrides: readonly Phase3AGuardrailShadowOverride[];
}

export type PlannerShardDegradeMode = ExecutionMode;

export type ControlPlaneOverrideScopeType = "MARKET" | "BUCKET" | "SHARD" | "ENGINE";

export interface CreateControlPlaneOverrideRequest {
  scopeType: ControlPlaneOverrideScopeType;
  scopeId: string;
  overrideType: string;
  payload: Record<string, unknown>;
  createdBy: string;
  expiresAt?: Date | null;
}

export class ControlPlaneShardNotFoundError extends Error {
  public constructor(shardId: string) {
    super(`Planner shard ${shardId} not found.`);
    this.name = "ControlPlaneShardNotFoundError";
  }
}

export class ControlPlaneBucketNotFoundError extends Error {
  public constructor(bucketId: string) {
    super(`Bucket ${bucketId} not found.`);
    this.name = "ControlPlaneBucketNotFoundError";
  }
}

export class ReplayEnvelopeNotFoundError extends Error {
  public constructor(envelopeId: string) {
    super(`Replay envelope ${envelopeId} not found.`);
    this.name = "ReplayEnvelopeNotFoundError";
  }
}

export class ControlPlaneOverrideValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ControlPlaneOverrideValidationError";
  }
}

export interface ControlPlaneAdminServiceDeps {
  pool: Pool;
  logger: Pick<Logger, "info" | "warn" | "error">;
  phase3AGuardrailShadowResolver?: IPhase3AGuardrailShadowResolver;
}

export class ControlPlaneAdminService {
  private readonly phase3AGuardrailShadowResolver: IPhase3AGuardrailShadowResolver;

  public constructor(private readonly deps: ControlPlaneAdminServiceDeps) {
    this.phase3AGuardrailShadowResolver =
      deps.phase3AGuardrailShadowResolver ??
      new Phase3AGuardrailShadowResolver({
        pool: deps.pool,
      });
  }

  public async listShards(): Promise<PlannerShardState[]> {
    const result = await this.deps.pool.query<PlannerShardStateRow>(
      `SELECT shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms, updated_at
       FROM planner_shard_state
       ORDER BY shard_id ASC`
    );

    return result.rows.map(mapPlannerShardStateRow);
  }

  public async getShard(shardId: string): Promise<PlannerShardState> {
    const result = await this.deps.pool.query<PlannerShardStateRow>(
      `SELECT shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms, updated_at
       FROM planner_shard_state
       WHERE shard_id = $1
       LIMIT 1`,
      [shardId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ControlPlaneShardNotFoundError(shardId);
    }

    return mapPlannerShardStateRow(row);
  }

  public async listBuckets(filters: ControlPlaneBucketFilters): Promise<BucketState[]> {
    const clauses: string[] = [];
    const values: string[] = [];

    if (filters.bucketType) {
      values.push(filters.bucketType);
      clauses.push(`bucket_type = $${values.length}`);
    }

    if (filters.mode) {
      values.push(filters.mode);
      clauses.push(`mode = $${values.length}`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await this.deps.pool.query<BucketStateRow>(
      `SELECT bucket_id, bucket_type, mode, entity_count, graph_density, degradation_reason, updated_at
       FROM bucket_state
       ${whereClause}
       ORDER BY bucket_id ASC`,
      values
    );

    return result.rows.map(mapBucketStateRow);
  }

  public async getBucket(bucketId: string): Promise<BucketState> {
    const result = await this.deps.pool.query<BucketStateRow>(
      `SELECT bucket_id, bucket_type, mode, entity_count, graph_density, degradation_reason, updated_at
       FROM bucket_state
       WHERE bucket_id = $1
       LIMIT 1`,
      [bucketId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ControlPlaneBucketNotFoundError(bucketId);
    }

    return mapBucketStateRow(row);
  }

  public async listActiveOverrides(): Promise<ControlPlaneOverride[]> {
    const result = await this.deps.pool.query<ControlPlaneOverrideRow>(
      `SELECT id, scope_type, scope_id, override_type, payload, created_by, created_at, expires_at
       FROM control_plane_overrides
       WHERE expires_at IS NULL OR expires_at > NOW()
       ORDER BY created_at DESC, id DESC`
    );

    return result.rows.map(mapControlPlaneOverrideRow);
  }

  public async getReplayEnvelopeMetadata(envelopeId: string): Promise<ReplayEnvelopeMetadata> {
    const result = await this.deps.pool.query<ReplayEnvelopeMetadataRow>(
      `SELECT id, decision_type, entity_id, correlation_id, config_version, engine_version, created_at
       FROM replay_envelopes
       WHERE id = $1
       LIMIT 1`,
      [envelopeId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ReplayEnvelopeNotFoundError(envelopeId);
    }

    return {
      id: row.id,
      decisionType: row.decision_type,
      entityId: row.entity_id,
      correlationId: row.correlation_id,
      configVersion: row.config_version,
      engineVersion: row.engine_version,
      createdAt: row.created_at,
    };
  }

  public getPhase3AGuardrailShadowConfig(): Phase3AGuardrailShadowConfig {
    return this.phase3AGuardrailShadowResolver.getConfig();
  }

  public async getPhase3AGuardrailShadowInspection(
    input: Phase3AGuardrailShadowInspectionInput
  ): Promise<Phase3AGuardrailShadowInspectionResult> {
    const activeShadowOverrides = await this.phase3AGuardrailShadowResolver.listActiveShadowOverrides({
      engine: input.engine,
      shardId: input.shardId,
      ...(input.bucketId !== undefined ? { bucketId: input.bucketId } : {}),
      ...(input.marketId !== undefined ? { marketId: input.marketId } : {}),
    });

    const effective = resolvePhase3AGuardrailShadow({
      config: this.phase3AGuardrailShadowResolver.getConfig(),
      activeOverrides: activeShadowOverrides,
      resolutionInput: {
        engine: input.engine,
        shardId: input.shardId,
        stableId: input.stableId,
        ...(input.bucketId !== undefined ? { bucketId: input.bucketId } : {}),
        ...(input.marketId !== undefined ? { marketId: input.marketId } : {}),
      },
    });

    return {
      config: this.phase3AGuardrailShadowResolver.getConfig(),
      effective: {
        ...effective,
        context: {
          engine: input.engine,
          shardId: input.shardId,
          stableId: input.stableId,
          bucketId: input.bucketId ?? null,
          marketId: input.marketId ?? null,
        },
      },
      matchedOverride:
        effective.matchedOverrideId
          ? activeShadowOverrides.find((override) => override.override.id === effective.matchedOverrideId) ?? null
          : null,
      activeShadowOverrides,
    };
  }

  public async pauseBucket(bucketId: string, requestedBy: string): Promise<BucketState> {
    const bucket = await this.updateBucketMode(bucketId, "PAUSED", "operator_pause", {
      action: "bucket_pause",
      requestedBy,
      bucketId,
    });
    return bucket;
  }

  public async drainBucket(bucketId: string, requestedBy: string): Promise<BucketState> {
    const bucket = await this.updateBucketMode(bucketId, "DRAINING", "operator_drain", {
      action: "bucket_drain",
      requestedBy,
      bucketId,
    });
    bucketDrainedTotal.inc();
    return bucket;
  }

  public async pauseShard(shardId: string, requestedBy: string): Promise<PlannerShardState> {
    const shard = await this.updateShardMode(shardId, "PAUSED", {
      action: "shard_pause",
      requestedBy,
      shardId,
    });
    plannerShardPausedTotal.inc();
    return shard;
  }

  public async degradeShard(input: {
    shardId: string;
    targetMode: PlannerShardDegradeMode;
    requestedBy: string;
  }): Promise<PlannerShardState> {
    return this.updateShardMode(input.shardId, input.targetMode, {
      action: "shard_degrade",
      requestedBy: input.requestedBy,
      shardId: input.shardId,
      targetMode: input.targetMode,
    });
  }

  public async createOverride(input: CreateControlPlaneOverrideRequest): Promise<ControlPlaneOverride> {
    this.validateOverrideInput(input);

    try {
      const result = await this.deps.pool.query<ControlPlaneOverrideRow>(
        `INSERT INTO control_plane_overrides (
           scope_type,
           scope_id,
           override_type,
           payload,
           created_by,
           expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, scope_type, scope_id, override_type, payload, created_by, created_at, expires_at`,
        [
          input.scopeType,
          input.scopeId,
          input.overrideType,
          input.payload,
          input.createdBy,
          input.expiresAt ?? null,
        ]
      );

      const override = mapControlPlaneOverrideRow(result.rows[0]!);
      this.deps.logger.info(
        {
          action: "control_plane_override_create",
          requestedBy: input.createdBy,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          overrideType: input.overrideType,
          expiresAt: input.expiresAt?.toISOString() ?? null,
        },
        "Created control plane override."
      );
      return override;
    } catch (error) {
      this.deps.logger.error(
        {
          err: error,
          action: "control_plane_override_create",
          requestedBy: input.createdBy,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          overrideType: input.overrideType,
          expiresAt: input.expiresAt?.toISOString() ?? null,
        },
        "Failed to create control plane override."
      );
      throw error;
    }
  }

  private async updateBucketMode(
    bucketId: string,
    mode: string,
    degradationReason: string,
    logFields: Record<string, unknown>
  ): Promise<BucketState> {
    try {
      const result = await this.deps.pool.query<BucketStateRow>(
        `UPDATE bucket_state
            SET mode = $2,
                degradation_reason = $3,
                updated_at = NOW()
          WHERE bucket_id = $1
        RETURNING bucket_id, bucket_type, mode, entity_count, graph_density, degradation_reason, updated_at`,
        [bucketId, mode, degradationReason]
      );

      const row = result.rows[0];
      if (!row) {
        throw new ControlPlaneBucketNotFoundError(bucketId);
      }

      const bucket = mapBucketStateRow(row);
      this.deps.logger.info(logFields, "Updated control plane bucket state.");
      return bucket;
    } catch (error) {
      this.deps.logger.error({ err: error, ...logFields }, "Failed to update control plane bucket state.");
      throw error;
    }
  }

  private async updateShardMode(
    shardId: string,
    mode: string,
    logFields: Record<string, unknown>
  ): Promise<PlannerShardState> {
    try {
      const result = await this.deps.pool.query<PlannerShardStateRow>(
        `UPDATE planner_shard_state
            SET mode = $2,
                updated_at = NOW()
          WHERE shard_id = $1
        RETURNING shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms, updated_at`,
        [shardId, mode]
      );

      const row = result.rows[0];
      if (!row) {
        throw new ControlPlaneShardNotFoundError(shardId);
      }

      const shard = mapPlannerShardStateRow(row);
      this.deps.logger.info(logFields, "Updated control plane shard state.");
      return shard;
    } catch (error) {
      this.deps.logger.error({ err: error, ...logFields }, "Failed to update control plane shard state.");
      throw error;
    }
  }

  private validateOverrideInput(input: CreateControlPlaneOverrideRequest): void {
    if (input.scopeId.trim().length === 0) {
      throw new ControlPlaneOverrideValidationError("scopeId must not be empty.");
    }
    if (input.overrideType.trim().length === 0) {
      throw new ControlPlaneOverrideValidationError("overrideType must not be empty.");
    }
    if (!isPlainObject(input.payload)) {
      throw new ControlPlaneOverrideValidationError("payload must be a structured JSON object.");
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new ControlPlaneOverrideValidationError("expiresAt must be in the future.");
    }
    if (input.overrideType === "GUARDRAIL_ENFORCEMENT") {
      try {
        parseGuardrailEnforcementOverridePayload(input.payload);
      } catch (error) {
        if (error instanceof Error) {
          throw new ControlPlaneOverrideValidationError(error.message);
        }
        throw error;
      }
    }
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mapPlannerShardStateRow = (row: PlannerShardStateRow): PlannerShardState => ({
  shardId: row.shard_id,
  mode: row.mode,
  activePlans: row.active_plans,
  activeBuckets: row.active_buckets,
  staleReservations: row.stale_reservations,
  avgPlannerLatencyMs: row.avg_planner_latency_ms,
  updatedAt: row.updated_at,
});

const mapBucketStateRow = (row: BucketStateRow): BucketState => ({
  bucketId: row.bucket_id,
  bucketType: row.bucket_type,
  mode: row.mode,
  entityCount: row.entity_count,
  graphDensity: row.graph_density,
  degradationReason: row.degradation_reason,
  updatedAt: row.updated_at,
});

const mapControlPlaneOverrideRow = (row: ControlPlaneOverrideRow): ControlPlaneOverride => ({
  id: row.id,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  overrideType: row.override_type,
  payload: row.payload,
  createdBy: row.created_by,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});
