import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import type { PoliticsNomineeLimitedProdLaneSummary } from "../../matching/politics/politics-types.js";
import {
  buildPoliticsNomineeLimitedProdArtifacts,
  type PoliticsNomineeLimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-nominee-limited-prod-readiness.js";
import {
  POLITICS_NOMINEE_ROLLOUT_SCOPE_TYPE,
  POLITICS_NOMINEE_ROLLOUT_STRATEGY_KEY,
  politicsNomineeLaneIds,
  type PoliticsNomineeLaneId
} from "../../operations/semantic-expansion/politics-nominee-limited-prod-shared.js";

interface PromotionEventRow extends QueryResultRow {
  id: string;
  scope_id: string;
  from_stage: string;
  to_stage: string;
  reason: string;
  created_by: string;
  created_at: Date;
  metadata: Record<string, unknown>;
}

export interface PoliticsNomineePromotionEvent {
  id: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface PoliticsNomineeLaneAuthorityState {
  laneId: PoliticsNomineeLaneId;
  topicKey: string;
  laneType: "PAIR" | "TRI";
  venueSet: string;
  candidateSet: readonly string[];
  readinessDecision: string;
  currentStage: QualificationStage;
  latestEventId: string | null;
  latestEventAt: string | null;
  latestActionKind: string | null;
  operatorApprovedToOffer: boolean;
}

export class PoliticsNomineeLaneNotFoundError extends Error {
  public constructor(laneId: string) {
    super(`Politics nominee lane ${laneId} not found.`);
    this.name = "PoliticsNomineeLaneNotFoundError";
  }
}

export class PoliticsNomineeLaneTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PoliticsNomineeLaneTransitionError";
  }
}

export interface PoliticsNomineeAdminServiceDeps {
  pool: Pool;
  repoRoot?: string;
}

const mapPromotionEvent = (row: PromotionEventRow): PoliticsNomineePromotionEvent => ({
  id: row.id,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

export class PoliticsNomineeAdminService {
  private readonly repoRoot: string;

  public constructor(private readonly deps: PoliticsNomineeAdminServiceDeps) {
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
  }

  private buildArtifacts(): PoliticsNomineeLimitedProdReadinessArtifacts {
    return buildPoliticsNomineeLimitedProdArtifacts(this.repoRoot);
  }

  private async listPromotionEvents(): Promise<readonly PoliticsNomineePromotionEvent[]> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `SELECT id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE strategy_key = $1
          AND scope_type = $2
        ORDER BY created_at DESC, id DESC`,
      [POLITICS_NOMINEE_ROLLOUT_STRATEGY_KEY, POLITICS_NOMINEE_ROLLOUT_SCOPE_TYPE]
    );
    return result.rows.map(mapPromotionEvent);
  }

  private async getCurrentStageMap(): Promise<Record<PoliticsNomineeLaneId, QualificationStage>> {
    const defaults = Object.fromEntries(
      politicsNomineeLaneIds.map((laneId) => [laneId, QualificationStage.INTERNAL_ONLY])
    ) as Record<PoliticsNomineeLaneId, QualificationStage>;
    const events = await this.listPromotionEvents();
    for (const laneId of politicsNomineeLaneIds) {
      const latest = events.find((event) => event.scopeId === laneId);
      if (latest) {
        defaults[laneId] = latest.toStage;
      }
    }
    return defaults;
  }

  private async recordEvent(input: {
    laneId: PoliticsNomineeLaneId;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<PoliticsNomineePromotionEvent> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        POLITICS_NOMINEE_ROLLOUT_STRATEGY_KEY,
        POLITICS_NOMINEE_ROLLOUT_SCOPE_TYPE,
        input.laneId,
        input.fromStage,
        input.toStage,
        input.reason,
        input.createdBy,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return mapPromotionEvent(result.rows[0]!);
  }

  public async listLanes(): Promise<readonly (PoliticsNomineeLimitedProdLaneSummary & { currentStage: QualificationStage })[]> {
    const artifacts = this.buildArtifacts();
    const stages = await this.getCurrentStageMap();
    return artifacts.readinessSummary.lanes.map((lane) => ({
      ...lane,
      currentStage: stages[lane.laneId as PoliticsNomineeLaneId]
    }));
  }

  public async getLane(laneId: PoliticsNomineeLaneId): Promise<PoliticsNomineeLimitedProdLaneSummary & { currentStage: QualificationStage }> {
    const lanes = await this.listLanes();
    const lane = lanes.find((entry) => entry.laneId === laneId);
    if (!lane) {
      throw new PoliticsNomineeLaneNotFoundError(laneId);
    }
    return lane;
  }

  public async getReadiness(laneId: PoliticsNomineeLaneId) {
    return this.getLane(laneId);
  }

  public async getCanaryGates(laneId: PoliticsNomineeLaneId) {
    const artifacts = this.buildArtifacts();
    const gates = artifacts.canaryGates.lanes.find((entry) => entry.laneId === laneId);
    if (!gates) {
      throw new PoliticsNomineeLaneNotFoundError(laneId);
    }
    return gates;
  }

  public async getRollbackPlan(laneId: PoliticsNomineeLaneId) {
    const artifacts = this.buildArtifacts();
    const rollback = artifacts.rollbackPlan.lanes.find((entry) => entry.laneId === laneId);
    if (!rollback) {
      throw new PoliticsNomineeLaneNotFoundError(laneId);
    }
    return rollback;
  }

  public async getLaneAuthorityState(laneId: PoliticsNomineeLaneId): Promise<PoliticsNomineeLaneAuthorityState> {
    const lane = await this.getLane(laneId);
    const events = await this.listPromotionEvents();
    const latest = events.find((event) => event.scopeId === laneId) ?? null;
    const latestActionKind =
      latest && typeof latest.metadata.actionKind === "string"
        ? latest.metadata.actionKind
        : null;

    return {
      laneId,
      topicKey: lane.topicKey,
      laneType: lane.laneType,
      venueSet: lane.venueSet,
      candidateSet: lane.candidateSet,
      readinessDecision: lane.readinessDecision,
      currentStage: lane.currentStage,
      latestEventId: latest?.id ?? null,
      latestEventAt: latest?.createdAt.toISOString() ?? null,
      latestActionKind,
      operatorApprovedToOffer:
        latestActionKind === "OPERATOR_APPROVAL_INTENT"
        && (lane.readinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
          || lane.readinessDecision === "READY_FOR_CANARY_ONLY")
    };
  }

  public async recordOperatorApprovalIntent(laneId: PoliticsNomineeLaneId, createdBy: string, reason?: string | null) {
    const lane = await this.getLane(laneId);
    if (
      lane.readinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      && lane.readinessDecision !== "READY_FOR_CANARY_ONLY"
    ) {
      throw new PoliticsNomineeLaneTransitionError(
        `Operator approval intent blocked: ${lane.readinessDecision}`
      );
    }
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: lane.currentStage,
      reason: reason ?? "politics nominee operator approval intent",
      createdBy,
      metadata: {
        actionKind: "OPERATOR_APPROVAL_INTENT",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet,
        pairPreferred: lane.pairPreferred
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      currentStage: lane.currentStage
    };
  }

  public async holdLane(laneId: PoliticsNomineeLaneId, createdBy: string, reason: string) {
    const lane = await this.getLane(laneId);
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: QualificationStage.INTERNAL_ONLY,
      reason,
      createdBy,
      metadata: {
        actionKind: "LANE_HOLD",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet
      }
    });
    return { laneId, event };
  }

  public async rollbackLane(laneId: PoliticsNomineeLaneId, createdBy: string, reason: string) {
    const lane = await this.getLane(laneId);
    const rollbackPlan = await this.getRollbackPlan(laneId);
    const toStage =
      rollbackPlan.rollbackTarget === "PAIR_FALLBACK"
        ? QualificationStage.INTERNAL_ONLY
        : QualificationStage.INTERNAL_ONLY;
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage,
      reason,
      createdBy,
      metadata: {
        actionKind: "ROLLBACK",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet,
        fallbackLaneId: rollbackPlan.fallbackLaneId
      }
    });
    return {
      laneId,
      event,
      fallbackLaneId: rollbackPlan.fallbackLaneId
    };
  }
}
