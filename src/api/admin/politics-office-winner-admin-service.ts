import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import type {
  PoliticsOfficeWinnerLimitedProdLaneSummary,
  PoliticsOfficeWinnerLimitedProdRollbackPlan
} from "../../matching/politics/politics-types.js";
import {
  buildPoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts,
  loadPoliticsOfficeWinnerBusanMayor2026MatcherArtifacts,
  type PoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-office-winner-busan-mayor-2026-limited-prod-readiness.js";
import {
  buildPoliticsOfficeWinnerColombiaPresident2026LimitedProdReadinessArtifacts,
  loadPoliticsOfficeWinnerColombiaPresident2026MatcherArtifacts,
  type PoliticsOfficeWinnerColombiaPresident2026LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-office-winner-colombia-president-2026-limited-prod-readiness.js";
import {
  buildPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts,
  loadPoliticsOfficeWinnerSeoulMayor2026MatcherArtifacts,
  type PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-office-winner-seoul-mayor-2026-limited-prod-readiness.js";
import {
  buildPoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts,
  loadPoliticsOfficeWinnerUsPresident2028MatcherArtifacts,
  type PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-office-winner-us-president-2028-limited-prod-readiness.js";
import {
  POLITICS_OFFICE_WINNER_ROLLOUT_SCOPE_TYPE,
  POLITICS_OFFICE_WINNER_ROLLOUT_STRATEGY_KEY,
  officeWinnerBusanMayor2026PairLaneId,
  officeWinnerColombiaPresident2026PairLaneId,
  officeWinnerSeoulMayor2026PairFallbackLaneId,
  officeWinnerSeoulMayor2026TriLaneId,
  officeWinnerUsPresident2028PairLaneId,
  politicsOfficeWinnerLaneIds,
  type PoliticsOfficeWinnerLaneId
} from "../../operations/semantic-expansion/politics-office-winner-limited-prod-shared.js";

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

export interface PoliticsOfficeWinnerPromotionEvent {
  id: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface PoliticsOfficeWinnerLaneAuthorityState {
  laneId: PoliticsOfficeWinnerLaneId;
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

export class PoliticsOfficeWinnerLaneNotFoundError extends Error {
  public constructor(laneId: string) {
    super(`Politics office-winner lane ${laneId} not found.`);
    this.name = "PoliticsOfficeWinnerLaneNotFoundError";
  }
}

export class PoliticsOfficeWinnerLaneTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PoliticsOfficeWinnerLaneTransitionError";
  }
}

export interface PoliticsOfficeWinnerAdminServiceDeps {
  pool: Pool;
  repoRoot?: string;
}

const mapPromotionEvent = (row: PromotionEventRow): PoliticsOfficeWinnerPromotionEvent => ({
  id: row.id,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

export class PoliticsOfficeWinnerAdminService {
  private readonly repoRoot: string;

  public constructor(private readonly deps: PoliticsOfficeWinnerAdminServiceDeps) {
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
  }

  private buildUsPresidentArtifacts(): PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts {
    return buildPoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts(
      loadPoliticsOfficeWinnerUsPresident2028MatcherArtifacts(this.repoRoot)
    );
  }

  private buildBusanArtifacts(): PoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts {
    return buildPoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts(
      loadPoliticsOfficeWinnerBusanMayor2026MatcherArtifacts(this.repoRoot)
    );
  }

  private buildColombiaArtifacts(): PoliticsOfficeWinnerColombiaPresident2026LimitedProdReadinessArtifacts {
    return buildPoliticsOfficeWinnerColombiaPresident2026LimitedProdReadinessArtifacts(
      loadPoliticsOfficeWinnerColombiaPresident2026MatcherArtifacts(this.repoRoot)
    );
  }

  private buildSeoulArtifacts(): PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts {
    return buildPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts(
      loadPoliticsOfficeWinnerSeoulMayor2026MatcherArtifacts(this.repoRoot)
    );
  }

  private buildLaneSummary(laneId: PoliticsOfficeWinnerLaneId): PoliticsOfficeWinnerLimitedProdLaneSummary {
    if (laneId === officeWinnerUsPresident2028PairLaneId) {
      const artifacts = this.buildUsPresidentArtifacts();
      const blockers = [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.readiness.topicKey,
        laneType: "PAIR",
        venueSet: artifacts.readiness.venuePair,
        candidateSet: artifacts.readiness.exactSafeCandidates,
        readinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    if (laneId === officeWinnerBusanMayor2026PairLaneId) {
      const artifacts = this.buildBusanArtifacts();
      const blockers = [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.readiness.topicKey,
        laneType: "PAIR",
        venueSet: artifacts.readiness.venuePair,
        candidateSet: artifacts.readiness.exactSafeCandidates,
        readinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    if (laneId === officeWinnerColombiaPresident2026PairLaneId) {
      const artifacts = this.buildColombiaArtifacts();
      const blockers = [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.readiness.topicKey,
        laneType: "PAIR",
        venueSet: artifacts.readiness.venuePair,
        candidateSet: artifacts.readiness.exactSafeCandidates,
        readinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    const artifacts = this.buildSeoulArtifacts();
    if (laneId === officeWinnerSeoulMayor2026TriLaneId) {
      const blockers = [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.readiness.topicKey,
        laneType: "TRI",
        venueSet: artifacts.readiness.triVenueSet,
        candidateSet: artifacts.readiness.exactSafeTriCandidates,
        readinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    if (laneId === officeWinnerSeoulMayor2026PairFallbackLaneId) {
      const blockers = [
        ...(artifacts.pairReadiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!artifacts.pairReadiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: artifacts.pairReadiness.topicKey,
        laneType: "PAIR",
        venueSet: artifacts.pairReadiness.venuePair,
        candidateSet: artifacts.pairReadiness.exactSafeCandidates,
        readinessDecision: artifacts.pairAdminSurfaceSummary.currentReadinessDecision,
        operatorCredible: artifacts.pairReadiness.operatorCredible,
        operatorRuleReviewRequired: artifacts.pairReadiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: artifacts.pairAdminSurfaceSummary.sourceArtifactRefs
      };
    }

    throw new PoliticsOfficeWinnerLaneNotFoundError(laneId);
  }

  private buildRollbackPlan(laneId: PoliticsOfficeWinnerLaneId): PoliticsOfficeWinnerLimitedProdRollbackPlan {
    if (laneId === officeWinnerUsPresident2028PairLaneId) {
      const artifacts = this.buildUsPresidentArtifacts();
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: null,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    if (laneId === officeWinnerBusanMayor2026PairLaneId) {
      const artifacts = this.buildBusanArtifacts();
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.readiness.rollbackPolicy.fallbackLaneId,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    if (laneId === officeWinnerColombiaPresident2026PairLaneId) {
      const artifacts = this.buildColombiaArtifacts();
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.readiness.rollbackPolicy.fallbackLaneId,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    const artifacts = this.buildSeoulArtifacts();
    if (laneId === officeWinnerSeoulMayor2026TriLaneId) {
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.readiness.rollbackPolicy.fallbackLaneId,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    if (laneId === officeWinnerSeoulMayor2026PairFallbackLaneId) {
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: artifacts.pairReadiness.rollbackPolicy.fallbackLaneId,
        holdConditions: artifacts.pairReadiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.pairReadiness.rollbackPolicy.operatorSteps
      };
    }

    throw new PoliticsOfficeWinnerLaneNotFoundError(laneId);
  }

  private async listPromotionEvents(): Promise<readonly PoliticsOfficeWinnerPromotionEvent[]> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `SELECT id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE strategy_key = $1
          AND scope_type = $2
        ORDER BY created_at DESC, id DESC`,
      [POLITICS_OFFICE_WINNER_ROLLOUT_STRATEGY_KEY, POLITICS_OFFICE_WINNER_ROLLOUT_SCOPE_TYPE]
    );
    return result.rows.map(mapPromotionEvent);
  }

  private async getCurrentStageMap(): Promise<Record<PoliticsOfficeWinnerLaneId, QualificationStage>> {
    const defaults = Object.fromEntries(
      politicsOfficeWinnerLaneIds.map((laneId) => [laneId, QualificationStage.INTERNAL_ONLY])
    ) as Record<PoliticsOfficeWinnerLaneId, QualificationStage>;
    const events = await this.listPromotionEvents();
    for (const laneId of politicsOfficeWinnerLaneIds) {
      const latest = events.find((event) => event.scopeId === laneId);
      if (latest) {
        defaults[laneId] = latest.toStage;
      }
    }
    return defaults;
  }

  private async recordEvent(input: {
    laneId: PoliticsOfficeWinnerLaneId;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<PoliticsOfficeWinnerPromotionEvent> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        POLITICS_OFFICE_WINNER_ROLLOUT_STRATEGY_KEY,
        POLITICS_OFFICE_WINNER_ROLLOUT_SCOPE_TYPE,
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

  public async listLanes(): Promise<readonly (PoliticsOfficeWinnerLimitedProdLaneSummary & { currentStage: QualificationStage })[]> {
    const stages = await this.getCurrentStageMap();
    return politicsOfficeWinnerLaneIds.map((laneId) => ({
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    }));
  }

  public async getLane(laneId: PoliticsOfficeWinnerLaneId): Promise<PoliticsOfficeWinnerLimitedProdLaneSummary & { currentStage: QualificationStage }> {
    if (!politicsOfficeWinnerLaneIds.includes(laneId)) {
      throw new PoliticsOfficeWinnerLaneNotFoundError(laneId);
    }
    const stages = await this.getCurrentStageMap();
    return {
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    };
  }

  public async getReadiness(laneId: PoliticsOfficeWinnerLaneId) {
    if (laneId === officeWinnerUsPresident2028PairLaneId) {
      return this.buildUsPresidentArtifacts().readiness;
    }
    if (laneId === officeWinnerBusanMayor2026PairLaneId) {
      return this.buildBusanArtifacts().readiness;
    }
    if (laneId === officeWinnerColombiaPresident2026PairLaneId) {
      return this.buildColombiaArtifacts().readiness;
    }
    const artifacts = this.buildSeoulArtifacts();
    if (laneId === officeWinnerSeoulMayor2026TriLaneId) {
      return artifacts.readiness;
    }
    if (laneId === officeWinnerSeoulMayor2026PairFallbackLaneId) {
      return artifacts.pairReadiness;
    }
    throw new PoliticsOfficeWinnerLaneNotFoundError(laneId);
  }

  public async getRollbackPlan(laneId: PoliticsOfficeWinnerLaneId) {
    return this.buildRollbackPlan(laneId);
  }

  public async getLaneAuthorityState(laneId: PoliticsOfficeWinnerLaneId): Promise<PoliticsOfficeWinnerLaneAuthorityState> {
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
        && lane.readinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    };
  }

  public async recordOperatorApprovalIntent(laneId: PoliticsOfficeWinnerLaneId, createdBy: string, reason?: string | null) {
    const lane = await this.getLane(laneId);
    if (lane.readinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION") {
      throw new PoliticsOfficeWinnerLaneTransitionError(
        `Operator approval intent blocked: ${lane.readinessDecision}`
      );
    }
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: lane.currentStage,
      reason: reason ?? "office winner operator approval intent",
      createdBy,
      metadata: {
        actionKind: "OPERATOR_APPROVAL_INTENT",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet,
        operatorRuleReviewRequired: lane.operatorRuleReviewRequired,
        pairPreferred: lane.pairPreferred
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      currentStage: lane.currentStage
    };
  }

  public async holdLane(laneId: PoliticsOfficeWinnerLaneId, createdBy: string, reason: string) {
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
        candidateSet: lane.candidateSet,
        operatorRuleReviewRequired: lane.operatorRuleReviewRequired
      }
    });
    return { laneId, event };
  }

  public async rollbackLane(laneId: PoliticsOfficeWinnerLaneId, createdBy: string, reason: string) {
    const lane = await this.getLane(laneId);
    const rollbackPlan = await this.getRollbackPlan(laneId);
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: QualificationStage.INTERNAL_ONLY,
      reason,
      createdBy,
      metadata: {
        actionKind: "ROLLBACK",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet,
        operatorRuleReviewRequired: lane.operatorRuleReviewRequired,
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
