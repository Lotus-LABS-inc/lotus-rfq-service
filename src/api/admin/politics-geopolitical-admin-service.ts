import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import {
  buildPoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessArtifacts,
  loadPoliticsGeopoliticalTrumpVisitChina20260430MatcherArtifacts,
  type PoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-geopolitical-trump-visit-china-2026-04-30-limited-prod-readiness.js";
import {
  buildPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts,
  loadPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherArtifacts,
  type PoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts
} from "../../operations/semantic-expansion/politics-geopolitical-trump-acquire-greenland-2026-12-31-limited-prod-readiness.js";
import {
  POLITICS_GEOPOLITICAL_ROLLOUT_SCOPE_TYPE,
  POLITICS_GEOPOLITICAL_ROLLOUT_STRATEGY_KEY,
  geopoliticalTrumpVisitChina20260430OpinionPolymarketPairLaneId,
  geopoliticalTrumpVisitChina20260430OpinionPredictPairLaneId,
  geopoliticalTrumpVisitChina20260430PolymarketPredictPairLaneId,
  geopoliticalTrumpVisitChina20260430TriLaneId,
  politicsGeopoliticalLaneIds as politicsGeopoliticalChinaLaneIds,
  type PoliticsGeopoliticalLaneId as PoliticsGeopoliticalChinaLaneId
} from "../../operations/semantic-expansion/politics-geopolitical-trump-visit-china-2026-04-30-limited-prod-shared.js";
import {
  geopoliticalTrumpAcquireGreenland20261231LimitlessOpinionPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231LimitlessPolymarketPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231LimitlessPredictPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231OpinionPolymarketPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231OpinionPredictPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231PolymarketPredictPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231TriLaneId,
  politicsGeopoliticalTrumpAcquireGreenland20261231LaneIds
} from "../../operations/semantic-expansion/politics-geopolitical-trump-acquire-greenland-2026-12-31-limited-prod-shared.js";

const politicsGeopoliticalLaneIds = [
  ...politicsGeopoliticalChinaLaneIds,
  ...politicsGeopoliticalTrumpAcquireGreenland20261231LaneIds
] as const;

export type PoliticsGeopoliticalLaneId =
  | PoliticsGeopoliticalChinaLaneId
  | (typeof politicsGeopoliticalTrumpAcquireGreenland20261231LaneIds)[number];

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

export interface PoliticsGeopoliticalPromotionEvent {
  id: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

type GeopoliticalTopicKey =
  | "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30"
  | "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31";
type GeopoliticalVenueSet =
  | "OPINION|POLYMARKET|PREDICT"
  | "OPINION|POLYMARKET"
  | "OPINION|PREDICT"
  | "POLYMARKET|PREDICT"
  | "LIMITLESS|OPINION|POLYMARKET|PREDICT"
  | "LIMITLESS|POLYMARKET"
  | "LIMITLESS|OPINION"
  | "LIMITLESS|PREDICT";

export interface PoliticsGeopoliticalLimitedProdLaneSummary {
  laneId: PoliticsGeopoliticalLaneId;
  topicKey: GeopoliticalTopicKey;
  laneType: "PAIR" | "TRI";
  venueSet: GeopoliticalVenueSet;
  propositionSet: readonly string[];
  readinessDecision: string;
  operatorCredible: boolean;
  operatorRuleReviewRequired: boolean;
  pairPreferred: boolean;
  blockers: readonly string[];
  sourceArtifactRefs: readonly string[];
}

export interface PoliticsGeopoliticalLimitedProdRollbackPlan {
  laneId: PoliticsGeopoliticalLaneId;
  rollbackTarget: "LANE_HOLD";
  fallbackLaneIds: readonly PoliticsGeopoliticalLaneId[];
  holdConditions: readonly string[];
  operatorSteps: readonly string[];
}

export interface PoliticsGeopoliticalLaneAuthorityState {
  laneId: PoliticsGeopoliticalLaneId;
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

export class PoliticsGeopoliticalLaneNotFoundError extends Error {
  public constructor(laneId: string) {
    super(`Politics geopolitical lane ${laneId} not found.`);
    this.name = "PoliticsGeopoliticalLaneNotFoundError";
  }
}

export class PoliticsGeopoliticalLaneTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PoliticsGeopoliticalLaneTransitionError";
  }
}

export interface PoliticsGeopoliticalAdminServiceDeps {
  pool: Pool;
  repoRoot?: string;
}

const mapPromotionEvent = (row: PromotionEventRow): PoliticsGeopoliticalPromotionEvent => ({
  id: row.id,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

export class PoliticsGeopoliticalAdminService {
  private readonly repoRoot: string;

  public constructor(private readonly deps: PoliticsGeopoliticalAdminServiceDeps) {
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
  }

  private buildArtifacts(): PoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessArtifacts {
    return buildPoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessArtifacts(
      loadPoliticsGeopoliticalTrumpVisitChina20260430MatcherArtifacts(this.repoRoot)
    );
  }

  private buildGreenlandArtifacts(): PoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts {
    return buildPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts(
      loadPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherArtifacts(this.repoRoot)
    );
  }

  private resolvePairVenuePair(laneId: PoliticsGeopoliticalLaneId) {
    const pairLaneMap = {
      [geopoliticalTrumpVisitChina20260430OpinionPolymarketPairLaneId]: "OPINION|POLYMARKET",
      [geopoliticalTrumpVisitChina20260430OpinionPredictPairLaneId]: "OPINION|PREDICT",
      [geopoliticalTrumpVisitChina20260430PolymarketPredictPairLaneId]: "POLYMARKET|PREDICT"
    } as const;

    return pairLaneMap[laneId as keyof typeof pairLaneMap] ?? null;
  }

  private resolveGreenlandPairVenuePair(laneId: PoliticsGeopoliticalLaneId) {
    const pairLaneMap = {
      [geopoliticalTrumpAcquireGreenland20261231LimitlessPolymarketPairLaneId]: "LIMITLESS|POLYMARKET",
      [geopoliticalTrumpAcquireGreenland20261231LimitlessOpinionPairLaneId]: "LIMITLESS|OPINION",
      [geopoliticalTrumpAcquireGreenland20261231LimitlessPredictPairLaneId]: "LIMITLESS|PREDICT",
      [geopoliticalTrumpAcquireGreenland20261231OpinionPolymarketPairLaneId]: "OPINION|POLYMARKET",
      [geopoliticalTrumpAcquireGreenland20261231OpinionPredictPairLaneId]: "OPINION|PREDICT",
      [geopoliticalTrumpAcquireGreenland20261231PolymarketPredictPairLaneId]: "POLYMARKET|PREDICT"
    } as const;

    return pairLaneMap[laneId as keyof typeof pairLaneMap] ?? null;
  }

  private buildLaneSummary(laneId: PoliticsGeopoliticalLaneId): PoliticsGeopoliticalLimitedProdLaneSummary {
    const artifacts = this.buildArtifacts();

    if (laneId === geopoliticalTrumpVisitChina20260430TriLaneId) {
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

    const venuePair = this.resolvePairVenuePair(laneId);
    if (venuePair) {
      const pairReadiness = artifacts.pairReadinessByVenuePair[venuePair];
      const pairAdminSurface = artifacts.pairAdminSurfaceSummaries[venuePair];
      const blockers = [
        ...(pairReadiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!pairReadiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: pairReadiness.topicKey,
        laneType: "PAIR",
        venueSet: pairReadiness.venuePair,
        propositionSet: pairReadiness.exactSafePropositions,
        readinessDecision: pairAdminSurface.currentReadinessDecision,
        operatorCredible: pairReadiness.operatorCredible,
        operatorRuleReviewRequired: pairReadiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: pairAdminSurface.sourceArtifactRefs
      };
    }

    const greenlandArtifacts = this.buildGreenlandArtifacts();
    if (laneId === geopoliticalTrumpAcquireGreenland20261231TriLaneId) {
      const blockers = [
        ...(greenlandArtifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!greenlandArtifacts.readiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: greenlandArtifacts.readiness.topicKey,
        laneType: "TRI",
        venueSet: greenlandArtifacts.readiness.triVenueSet,
        propositionSet: greenlandArtifacts.readiness.exactSafeTriPropositions,
        readinessDecision: greenlandArtifacts.adminSurfaceSummary.currentReadinessDecision,
        operatorCredible: greenlandArtifacts.readiness.operatorCredible,
        operatorRuleReviewRequired: greenlandArtifacts.readiness.operatorRuleReviewRequired,
        pairPreferred: false,
        blockers,
        sourceArtifactRefs: greenlandArtifacts.adminSurfaceSummary.sourceArtifactRefs
      };
    }

    const greenlandVenuePair = this.resolveGreenlandPairVenuePair(laneId);
    if (greenlandVenuePair) {
      const pairReadiness = greenlandArtifacts.pairReadinessByVenuePair[greenlandVenuePair];
      const pairAdminSurface = greenlandArtifacts.pairAdminSurfaceSummaries[greenlandVenuePair];
      const blockers = [
        ...(pairReadiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(!pairReadiness.readinessReviewJustified ? ["lane_not_ready_for_limited_prod_review"] : [])
      ];
      return {
        laneId,
        topicKey: pairReadiness.topicKey,
        laneType: "PAIR",
        venueSet: pairReadiness.venuePair,
        propositionSet: pairReadiness.exactSafePropositions,
        readinessDecision: pairAdminSurface.currentReadinessDecision,
        operatorCredible: pairReadiness.operatorCredible,
        operatorRuleReviewRequired: pairReadiness.operatorRuleReviewRequired,
        pairPreferred: true,
        blockers,
        sourceArtifactRefs: pairAdminSurface.sourceArtifactRefs
      };
    }

    throw new PoliticsGeopoliticalLaneNotFoundError(laneId);
  }

  private buildRollbackPlan(laneId: PoliticsGeopoliticalLaneId): PoliticsGeopoliticalLimitedProdRollbackPlan {
    const artifacts = this.buildArtifacts();

    if (laneId === geopoliticalTrumpVisitChina20260430TriLaneId) {
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneIds: artifacts.readiness.rollbackPolicy.fallbackLaneIds,
        holdConditions: artifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: artifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    const venuePair = this.resolvePairVenuePair(laneId);
    if (venuePair) {
      const pairReadiness = artifacts.pairReadinessByVenuePair[venuePair];
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneIds: [],
        holdConditions: pairReadiness.holdPolicy.holdConditions,
        operatorSteps: pairReadiness.rollbackPolicy.operatorSteps
      };
    }

    const greenlandArtifacts = this.buildGreenlandArtifacts();
    if (laneId === geopoliticalTrumpAcquireGreenland20261231TriLaneId) {
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneIds: greenlandArtifacts.readiness.rollbackPolicy.fallbackLaneIds,
        holdConditions: greenlandArtifacts.readiness.holdPolicy.holdConditions,
        operatorSteps: greenlandArtifacts.readiness.rollbackPolicy.operatorSteps
      };
    }

    const greenlandVenuePair = this.resolveGreenlandPairVenuePair(laneId);
    if (greenlandVenuePair) {
      const pairReadiness = greenlandArtifacts.pairReadinessByVenuePair[greenlandVenuePair];
      return {
        laneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneIds: [],
        holdConditions: pairReadiness.holdPolicy.holdConditions,
        operatorSteps: pairReadiness.rollbackPolicy.operatorSteps
      };
    }

    throw new PoliticsGeopoliticalLaneNotFoundError(laneId);
  }

  private async listPromotionEvents(): Promise<readonly PoliticsGeopoliticalPromotionEvent[]> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `SELECT id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE strategy_key = $1
          AND scope_type = $2
        ORDER BY created_at DESC, id DESC`,
      [POLITICS_GEOPOLITICAL_ROLLOUT_STRATEGY_KEY, POLITICS_GEOPOLITICAL_ROLLOUT_SCOPE_TYPE]
    );
    return result.rows.map(mapPromotionEvent);
  }

  private async getCurrentStageMap(): Promise<Record<PoliticsGeopoliticalLaneId, QualificationStage>> {
    const defaults = Object.fromEntries(
      politicsGeopoliticalLaneIds.map((laneId) => [laneId, QualificationStage.INTERNAL_ONLY])
    ) as Record<PoliticsGeopoliticalLaneId, QualificationStage>;
    const events = await this.listPromotionEvents();
    for (const laneId of politicsGeopoliticalLaneIds) {
      const latest = events.find((event) => event.scopeId === laneId);
      if (latest) {
        defaults[laneId] = latest.toStage;
      }
    }
    return defaults;
  }

  private async recordEvent(input: {
    laneId: PoliticsGeopoliticalLaneId;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<PoliticsGeopoliticalPromotionEvent> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        POLITICS_GEOPOLITICAL_ROLLOUT_STRATEGY_KEY,
        POLITICS_GEOPOLITICAL_ROLLOUT_SCOPE_TYPE,
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

  public async listLanes(): Promise<readonly (PoliticsGeopoliticalLimitedProdLaneSummary & { currentStage: QualificationStage })[]> {
    const stages = await this.getCurrentStageMap();
    return politicsGeopoliticalLaneIds.map((laneId) => ({
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    }));
  }

  public async getLane(laneId: PoliticsGeopoliticalLaneId): Promise<PoliticsGeopoliticalLimitedProdLaneSummary & { currentStage: QualificationStage }> {
    if (!politicsGeopoliticalLaneIds.includes(laneId)) {
      throw new PoliticsGeopoliticalLaneNotFoundError(laneId);
    }
    const stages = await this.getCurrentStageMap();
    return {
      ...this.buildLaneSummary(laneId),
      currentStage: stages[laneId]
    };
  }

  public async getReadiness(laneId: PoliticsGeopoliticalLaneId) {
    const artifacts = this.buildArtifacts();

    if (laneId === geopoliticalTrumpVisitChina20260430TriLaneId) {
      return artifacts.readiness;
    }

    const venuePair = this.resolvePairVenuePair(laneId);
    if (venuePair) {
      return artifacts.pairReadinessByVenuePair[venuePair];
    }

    const greenlandArtifacts = this.buildGreenlandArtifacts();
    if (laneId === geopoliticalTrumpAcquireGreenland20261231TriLaneId) {
      return greenlandArtifacts.readiness;
    }

    const greenlandVenuePair = this.resolveGreenlandPairVenuePair(laneId);
    if (greenlandVenuePair) {
      return greenlandArtifacts.pairReadinessByVenuePair[greenlandVenuePair];
    }

    throw new PoliticsGeopoliticalLaneNotFoundError(laneId);
  }

  public async getRollbackPlan(laneId: PoliticsGeopoliticalLaneId) {
    return this.buildRollbackPlan(laneId);
  }

  public async getLaneAuthorityState(laneId: PoliticsGeopoliticalLaneId): Promise<PoliticsGeopoliticalLaneAuthorityState> {
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

  public async recordOperatorApprovalIntent(laneId: PoliticsGeopoliticalLaneId, createdBy: string, reason?: string | null) {
    const lane = await this.getLane(laneId);
    if (lane.readinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION") {
      throw new PoliticsGeopoliticalLaneTransitionError(
        `Operator approval intent blocked: ${lane.readinessDecision}`
      );
    }
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: lane.currentStage,
      reason: reason ?? "politics geopolitical operator approval intent",
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

  public async holdLane(laneId: PoliticsGeopoliticalLaneId, createdBy: string, reason: string) {
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

  public async rollbackLane(laneId: PoliticsGeopoliticalLaneId, createdBy: string, reason: string) {
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
        fallbackLaneIds: rollbackPlan.fallbackLaneIds
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      newStage: QualificationStage.INTERNAL_ONLY,
      fallbackLaneIds: rollbackPlan.fallbackLaneIds
    };
  }
}
