import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import {
  buildPoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts,
  loadPoliticsPartyControlBalanceOfPower2026MatcherArtifacts,
  type PoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-party-control-balance-of-power-2026-limited-prod-readiness.js";
import {
  POLITICS_PARTY_CONTROL_ROLLOUT_SCOPE_TYPE,
  POLITICS_PARTY_CONTROL_ROLLOUT_STRATEGY_KEY,
  partyControlBalanceOfPower2026PairFallbackLaneId,
  partyControlBalanceOfPower2026TriLaneId,
  politicsPartyControlLaneIds,
  type PoliticsPartyControlLaneId
} from "../../operations/semantic-expansion/politics-party-control-limited-prod-shared.js";

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

export interface PoliticsPartyControlPromotionEvent {
  id: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface PoliticsPartyControlLimitedProdLaneSummary {
  laneId: PoliticsPartyControlLaneId;
  topicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER";
  laneType: "PAIR" | "TRI";
  venueSet: "OPINION|POLYMARKET|PREDICT" | "POLYMARKET|PREDICT";
  outcomeSet: readonly string[];
  readinessDecision: string;
  operatorCredible: boolean;
  operatorRuleReviewRequired: boolean;
  pairPreferred: boolean;
  blockers: readonly string[];
  sourceArtifactRefs: readonly string[];
}

export interface PoliticsPartyControlLimitedProdRollbackPlan {
  laneId: PoliticsPartyControlLaneId;
  rollbackTarget: "LANE_HOLD";
  fallbackLaneId: PoliticsPartyControlLaneId | null;
  holdConditions: readonly string[];
  operatorSteps: readonly string[];
}

export interface PoliticsPartyControlLaneAuthorityState {
  laneId: PoliticsPartyControlLaneId;
  topicKey: string;
  laneType: "PAIR" | "TRI";
  venueSet: string;
  outcomeSet: readonly string[];
  readinessDecision: string;
  currentStage: QualificationStage;
  latestEventId: string | null;
  latestEventAt: string | null;
  latestActionKind: string | null;
  operatorApprovedToOffer: boolean;
}

export class PoliticsPartyControlLaneNotFoundError extends Error {
  public constructor(laneId: string) {
    super(`Politics party-control lane ${laneId} not found.`);
    this.name = "PoliticsPartyControlLaneNotFoundError";
  }
}

export class PoliticsPartyControlLaneTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PoliticsPartyControlLaneTransitionError";
  }
}

export interface PoliticsPartyControlAdminServiceDeps {
  pool: Pool;
  repoRoot?: string;
}

const mapPromotionEvent = (row: PromotionEventRow): PoliticsPartyControlPromotionEvent => ({
  id: row.id,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

export class PoliticsPartyControlAdminService {
  private readonly repoRoot: string;

  public constructor(private readonly deps: PoliticsPartyControlAdminServiceDeps) {
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
  }

  private buildArtifacts(): PoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts {
    return buildPoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts(
      loadPoliticsPartyControlBalanceOfPower2026MatcherArtifacts(this.repoRoot)
    );
  }

  private buildLaneSummary(laneId: PoliticsPartyControlLaneId): PoliticsPartyControlLimitedProdLaneSummary {
    const artifacts = this.buildArtifacts();

    if (laneId === partyControlBalanceOfPower2026TriLaneId) {
      const blockers = [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.readiness.topicKey,
        laneType: "TRI",
        venueSet: artifacts.readiness.triVenueSet,
        outcomeSet: artifacts.readiness.exactSafeTriOutcomes,
        readinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    if (laneId === partyControlBalanceOfPower2026PairFallbackLaneId) {
      const blockers = [
        ...(artifacts.pairReadiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.pairReadiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.pairReadiness.topicKey,
        laneType: "PAIR",
        venueSet: artifacts.pairReadiness.venuePair,
        outcomeSet: artifacts.pairReadiness.exactSafeOutcomes,
        readinessDecision: artifacts.pairAdminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.pairReadiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.pairReadiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.pairAdminSurfaceSummary.sourceArtifactRefs
      };
    }

    throw new PoliticsPartyControlLaneNotFoundError(laneId);
  }

  private buildRollbackPlan(laneId: PoliticsPartyControlLaneId): PoliticsPartyControlLimitedProdRollbackPlan {
    const artifacts = this.buildArtifacts();
    if (laneId === partyControlBalanceOfPower2026TriLaneId) {
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.readiness.rollbackPolicy.fallbackLaneId as PoliticsPartyControlLaneId,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    if (laneId === partyControlBalanceOfPower2026PairFallbackLaneId) {
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.pairReadiness.rollbackPolicy.fallbackLaneId as PoliticsPartyControlLaneId | null,
        holdConditions: artifacts.pairReadiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.pairReadiness.rollbackPolicy.operatorSteps
      };
    }

    throw new PoliticsPartyControlLaneNotFoundError(laneId);
  }

  private async listPromotionEvents(): Promise<readonly PoliticsPartyControlPromotionEvent[]> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `SELECT id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE strategy_key = $1
          AND scope_type = $2
        ORDER BY created_at DESC, id DESC`,
      [POLITICS_PARTY_CONTROL_ROLLOUT_STRATEGY_KEY, POLITICS_PARTY_CONTROL_ROLLOUT_SCOPE_TYPE]
    );
    return result.rows.map(mapPromotionEvent);
  }

  private async getCurrentStageMap(): Promise<Record<PoliticsPartyControlLaneId, QualificationStage>> {
    const defaults = Object.fromEntries(
      politicsPartyControlLaneIds.map((laneId) => [laneId, QualificationStage.INTERNAL_ONLY])
    ) as Record<PoliticsPartyControlLaneId, QualificationStage>;
    const events = await this.listPromotionEvents();
    for (const laneId of politicsPartyControlLaneIds) {
      const latest = events.find((event) => event.scopeId === laneId);
      if (latest) {
        defaults[laneId] = latest.toStage;
      }
    }
    return defaults;
  }

  private async recordEvent(input: {
    laneId: PoliticsPartyControlLaneId;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<PoliticsPartyControlPromotionEvent> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        POLITICS_PARTY_CONTROL_ROLLOUT_STRATEGY_KEY,
        POLITICS_PARTY_CONTROL_ROLLOUT_SCOPE_TYPE,
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

  public async listLanes(): Promise<readonly (PoliticsPartyControlLimitedProdLaneSummary & { currentStage: QualificationStage })[]> {
    const stages = await this.getCurrentStageMap();
    return politicsPartyControlLaneIds.map((laneId) => ({
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    }));
  }

  public async getLane(laneId: PoliticsPartyControlLaneId): Promise<PoliticsPartyControlLimitedProdLaneSummary & { currentStage: QualificationStage }> {
    if (!politicsPartyControlLaneIds.includes(laneId)) {
      throw new PoliticsPartyControlLaneNotFoundError(laneId);
    }
    const stages = await this.getCurrentStageMap();
    return {
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    };
  }

  public async getReadiness(laneId: PoliticsPartyControlLaneId) {
    const artifacts = this.buildArtifacts();
    if (laneId === partyControlBalanceOfPower2026TriLaneId) {
      return artifacts.readiness;
    }
    if (laneId === partyControlBalanceOfPower2026PairFallbackLaneId) {
      return artifacts.pairReadiness;
    }
    throw new PoliticsPartyControlLaneNotFoundError(laneId);
  }

  public async getRollbackPlan(laneId: PoliticsPartyControlLaneId) {
    return this.buildRollbackPlan(laneId);
  }

  public async getLaneAuthorityState(laneId: PoliticsPartyControlLaneId): Promise<PoliticsPartyControlLaneAuthorityState> {
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
      outcomeSet: lane.outcomeSet,
      readinessDecision: lane.readinessDecision,
      currentStage: lane.currentStage,
      latestEventId: latest?.id ?? null,
      latestEventAt: latest?.createdAt.toISOString() ?? null,
      latestActionKind,
      operatorApprovedToOffer:
        latestActionKind === "OPERATOR_APPROVAL_INTENT"
        && lane.readinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    };
  }

  public async recordOperatorApprovalIntent(laneId: PoliticsPartyControlLaneId, createdBy: string, reason?: string | null) {
    const lane = await this.getLane(laneId);
    if (lane.readinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION") {
      throw new PoliticsPartyControlLaneTransitionError(
        `Operator approval intent blocked: ${lane.readinessDecision}`
      );
    }
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: lane.currentStage,
      reason: reason ?? "politics party-control operator approval intent",
      createdBy,
      metadata: {
        actionKind: "OPERATOR_APPROVAL_INTENT",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        outcomeSet: lane.outcomeSet,
        pairPreferred: lane.pairPreferred
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      currentStage: lane.currentStage
    };
  }

  public async holdLane(laneId: PoliticsPartyControlLaneId, createdBy: string, reason: string) {
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
        outcomeSet: lane.outcomeSet
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      newStage: QualificationStage.INTERNAL_ONLY
    };
  }

  public async rollbackLane(laneId: PoliticsPartyControlLaneId, createdBy: string, reason: string) {
    const rollbackPlan = await this.getRollbackPlan(laneId);
    const lane = await this.getLane(laneId);
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: QualificationStage.INTERNAL_ONLY,
      reason,
      createdBy,
      metadata: {
        actionKind: "LANE_ROLLBACK",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        outcomeSet: lane.outcomeSet,
        fallbackLaneId: rollbackPlan.fallbackLaneId
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      newStage: QualificationStage.INTERNAL_ONLY,
      fallbackLaneId: rollbackPlan.fallbackLaneId
    };
  }
}
