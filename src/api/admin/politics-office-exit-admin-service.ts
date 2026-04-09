import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import {
  buildPoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts,
  loadPoliticsOfficeExitNetanyahu2026MatcherArtifacts,
  type PoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-office-exit-netanyahu-2026-limited-prod-readiness.js";
import {
  buildPoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts,
  loadPoliticsOfficeExitTrump2026MatcherArtifacts,
  type PoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-office-exit-trump-2026-limited-prod-readiness.js";
import {
  POLITICS_OFFICE_EXIT_ROLLOUT_SCOPE_TYPE,
  POLITICS_OFFICE_EXIT_ROLLOUT_STRATEGY_KEY,
  officeExitNetanyahu2026PairFallbackLaneId,
  officeExitNetanyahu2026TriLaneId,
  politicsOfficeExitLaneIds,
  type PoliticsOfficeExitLaneId
} from "../../operations/semantic-expansion/politics-office-exit-netanyahu-2026-limited-prod-shared.js";
import {
  officeExitTrump2026PairLaneId,
  officeExitTrump2026TriLaneId
} from "../../operations/semantic-expansion/politics-office-exit-trump-2026-limited-prod-shared.js";

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

export interface PoliticsOfficeExitPromotionEvent {
  id: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface PoliticsOfficeExitLimitedProdLaneSummary {
  laneId: PoliticsOfficeExitLaneId;
  topicKey:
    | "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31"
    | "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31";
  laneType: "PAIR" | "TRI";
  venueSet:
    | "LIMITLESS|POLYMARKET|PREDICT"
    | "LIMITLESS|POLYMARKET"
    | "LIMITLESS|OPINION|POLYMARKET";
  propositionSet: readonly string[];
  readinessDecision: string;
  operatorCredible: boolean;
  operatorRuleReviewRequired: boolean;
  pairPreferred: boolean;
  blockers: readonly string[];
  sourceArtifactRefs: readonly string[];
}

export interface PoliticsOfficeExitLimitedProdRollbackPlan {
  laneId: PoliticsOfficeExitLaneId;
  rollbackTarget: "LANE_HOLD";
  fallbackLaneId: PoliticsOfficeExitLaneId | null;
  holdConditions: readonly string[];
  operatorSteps: readonly string[];
}

export interface PoliticsOfficeExitLaneAuthorityState {
  laneId: PoliticsOfficeExitLaneId;
  topicKey: string;
  laneType: "PAIR" | "TRI";
  venueSet: string;
  propositionSet: readonly string[];
  readinessDecision: string;
  currentStage: QualificationStage;
  latestEventId: string | null;
  latestEventAt: string | null;
  latestActionKind: string | null;
  operatorApprovedToOffer: boolean;
}

export class PoliticsOfficeExitLaneNotFoundError extends Error {
  public constructor(laneId: string) {
    super(`Politics office-exit lane ${laneId} not found.`);
    this.name = "PoliticsOfficeExitLaneNotFoundError";
  }
}

export class PoliticsOfficeExitLaneTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PoliticsOfficeExitLaneTransitionError";
  }
}

export interface PoliticsOfficeExitAdminServiceDeps {
  pool: Pool;
  repoRoot?: string;
}

const mapPromotionEvent = (row: PromotionEventRow): PoliticsOfficeExitPromotionEvent => ({
  id: row.id,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

export class PoliticsOfficeExitAdminService {
  private readonly repoRoot: string;

  public constructor(private readonly deps: PoliticsOfficeExitAdminServiceDeps) {
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
  }

  private buildNetanyahuArtifacts(): PoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts {
    return buildPoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts(loadPoliticsOfficeExitNetanyahu2026MatcherArtifacts(this.repoRoot));
  }

  private buildTrumpArtifacts(): PoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts {
    return buildPoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts(loadPoliticsOfficeExitTrump2026MatcherArtifacts(this.repoRoot));
  }

  private buildLaneSummary(laneId: PoliticsOfficeExitLaneId): PoliticsOfficeExitLimitedProdLaneSummary {
    if (laneId === officeExitNetanyahu2026TriLaneId) {
      const artifacts = this.buildNetanyahuArtifacts();
      const blockers = [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.readiness.topicKey,
        laneType: "TRI",
        venueSet: artifacts.readiness.triVenueSet,
        propositionSet: artifacts.readiness.exactSafeTriPropositions,
        readinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: false,
        blockers,
        sourceArtifactRefs: artifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    if (laneId === officeExitNetanyahu2026PairFallbackLaneId) {
      const artifacts = this.buildNetanyahuArtifacts();
      const blockers = [
        ...(artifacts.pairReadiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.pairReadiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.pairReadiness.topicKey,
        laneType: "PAIR",
        venueSet: artifacts.pairReadiness.venuePair,
        propositionSet: artifacts.pairReadiness.exactSafePropositions,
        readinessDecision: artifacts.pairAdminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.pairReadiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.pairReadiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.pairAdminSurfaceSummary.sourceArtifactRefs
      };
    }

    if (laneId === officeExitTrump2026TriLaneId) {
      const artifacts = this.buildTrumpArtifacts();
      const blockers = [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.readiness.topicKey,
        laneType: "TRI",
        venueSet: artifacts.readiness.triVenueSet,
        propositionSet: artifacts.readiness.exactSafeTriPropositions,
        readinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: false,
        blockers,
        sourceArtifactRefs: artifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    if (laneId === officeExitTrump2026PairLaneId) {
      const artifacts = this.buildTrumpArtifacts();
      const blockers = [
        ...(artifacts.pairReadiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.pairReadiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.pairReadiness.topicKey,
        laneType: "PAIR",
        venueSet: artifacts.pairReadiness.venuePair,
        propositionSet: artifacts.pairReadiness.exactSafePropositions,
        readinessDecision: artifacts.pairAdminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.pairReadiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.pairReadiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.pairAdminSurfaceSummary.sourceArtifactRefs
      };
    }

    throw new PoliticsOfficeExitLaneNotFoundError(laneId);
  }

  private buildRollbackPlan(laneId: PoliticsOfficeExitLaneId): PoliticsOfficeExitLimitedProdRollbackPlan {
    if (laneId === officeExitNetanyahu2026TriLaneId) {
      const artifacts = this.buildNetanyahuArtifacts();
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.readiness.rollbackPolicy.fallbackLaneId as PoliticsOfficeExitLaneId,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    if (laneId === officeExitNetanyahu2026PairFallbackLaneId) {
      const artifacts = this.buildNetanyahuArtifacts();
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.pairReadiness.rollbackPolicy.fallbackLaneId as PoliticsOfficeExitLaneId | null,
        holdConditions: artifacts.pairReadiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.pairReadiness.rollbackPolicy.operatorSteps
      };
    }

    if (laneId === officeExitTrump2026TriLaneId) {
      const artifacts = this.buildTrumpArtifacts();
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.readiness.rollbackPolicy.fallbackLaneId as PoliticsOfficeExitLaneId,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    if (laneId === officeExitTrump2026PairLaneId) {
      const artifacts = this.buildTrumpArtifacts();
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.pairReadiness.rollbackPolicy.fallbackLaneId as PoliticsOfficeExitLaneId | null,
        holdConditions: artifacts.pairReadiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.pairReadiness.rollbackPolicy.operatorSteps
      };
    }

    throw new PoliticsOfficeExitLaneNotFoundError(laneId);
  }

  private async listPromotionEvents(): Promise<readonly PoliticsOfficeExitPromotionEvent[]> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `SELECT id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE strategy_key = $1
          AND scope_type = $2
        ORDER BY created_at DESC, id DESC`,
      [POLITICS_OFFICE_EXIT_ROLLOUT_STRATEGY_KEY, POLITICS_OFFICE_EXIT_ROLLOUT_SCOPE_TYPE]
    );
    return result.rows.map(mapPromotionEvent);
  }

  private async getCurrentStageMap(): Promise<Record<PoliticsOfficeExitLaneId, QualificationStage>> {
    const defaults = Object.fromEntries(
      politicsOfficeExitLaneIds.map((laneId) => [laneId, QualificationStage.INTERNAL_ONLY])
    ) as Record<PoliticsOfficeExitLaneId, QualificationStage>;
    const events = await this.listPromotionEvents();
    for (const laneId of politicsOfficeExitLaneIds) {
      const latest = events.find((event) => event.scopeId === laneId);
      if (latest) {
        defaults[laneId] = latest.toStage;
      }
    }
    return defaults;
  }

  private async recordEvent(input: {
    laneId: PoliticsOfficeExitLaneId;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<PoliticsOfficeExitPromotionEvent> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        POLITICS_OFFICE_EXIT_ROLLOUT_STRATEGY_KEY,
        POLITICS_OFFICE_EXIT_ROLLOUT_SCOPE_TYPE,
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

  public async listLanes(): Promise<readonly (PoliticsOfficeExitLimitedProdLaneSummary & { currentStage: QualificationStage })[]> {
    const stages = await this.getCurrentStageMap();
    return politicsOfficeExitLaneIds.map((laneId) => ({
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    }));
  }

  public async getLane(laneId: PoliticsOfficeExitLaneId): Promise<PoliticsOfficeExitLimitedProdLaneSummary & { currentStage: QualificationStage }> {
    if (!politicsOfficeExitLaneIds.includes(laneId)) {
      throw new PoliticsOfficeExitLaneNotFoundError(laneId);
    }
    const stages = await this.getCurrentStageMap();
    return {
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    };
  }

  public async getReadiness(laneId: PoliticsOfficeExitLaneId) {
    if (laneId === officeExitNetanyahu2026TriLaneId) {
      const artifacts = this.buildNetanyahuArtifacts();
      return artifacts.readiness;
    }
    if (laneId === officeExitNetanyahu2026PairFallbackLaneId) {
      const artifacts = this.buildNetanyahuArtifacts();
      return artifacts.pairReadiness;
    }
    if (laneId === officeExitTrump2026TriLaneId) {
      const artifacts = this.buildTrumpArtifacts();
      return artifacts.readiness;
    }
    if (laneId === officeExitTrump2026PairLaneId) {
      const artifacts = this.buildTrumpArtifacts();
      return artifacts.pairReadiness;
    }
    throw new PoliticsOfficeExitLaneNotFoundError(laneId);
  }

  public async getRollbackPlan(laneId: PoliticsOfficeExitLaneId) {
    return this.buildRollbackPlan(laneId);
  }

  public async getLaneAuthorityState(laneId: PoliticsOfficeExitLaneId): Promise<PoliticsOfficeExitLaneAuthorityState> {
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
      propositionSet: lane.propositionSet,
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

  public async recordOperatorApprovalIntent(laneId: PoliticsOfficeExitLaneId, createdBy: string, reason?: string | null) {
    const lane = await this.getLane(laneId);
    if (lane.readinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION") {
      throw new PoliticsOfficeExitLaneTransitionError(
        `Operator approval intent blocked: ${lane.readinessDecision}`
      );
    }
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: lane.currentStage,
      reason: reason ?? "politics office-exit operator approval intent",
      createdBy,
      metadata: {
        actionKind: "OPERATOR_APPROVAL_INTENT",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        propositionSet: lane.propositionSet,
        pairPreferred: lane.pairPreferred,
        operatorRuleReviewRequired: lane.operatorRuleReviewRequired
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      currentStage: lane.currentStage
    };
  }

  public async holdLane(laneId: PoliticsOfficeExitLaneId, createdBy: string, reason: string) {
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
        propositionSet: lane.propositionSet,
        operatorRuleReviewRequired: lane.operatorRuleReviewRequired
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      newStage: QualificationStage.INTERNAL_ONLY
    };
  }

  public async rollbackLane(laneId: PoliticsOfficeExitLaneId, createdBy: string, reason: string) {
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
        propositionSet: lane.propositionSet,
        operatorRuleReviewRequired: lane.operatorRuleReviewRequired,
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
