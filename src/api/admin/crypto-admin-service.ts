import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import {
  cryptoAthByDateAssetConfigs,
  type CryptoAthByDateAssetConfig
} from "../../matching/crypto/crypto-ath-by-date-assets.js";
import {
  cryptoThresholdByDateAssetConfigs,
  type CryptoThresholdByDateAssetConfig
} from "../../matching/crypto/crypto-threshold-by-date-assets.js";
import {
  cryptoFirstToThresholdByDateAssetConfigs,
  type CryptoFirstToThresholdByDateAssetConfig
} from "../../matching/crypto/crypto-first-to-threshold-by-date-assets.js";
import {
  cryptoFdvAfterLaunchProjectConfigs,
  type CryptoFdvAfterLaunchProjectConfig
} from "../../matching/crypto/crypto-fdv-after-launch-assets.js";
import {
  cryptoTokenLaunchByDateProjectConfigs,
  type CryptoTokenLaunchByDateProjectConfig
} from "../../matching/crypto/crypto-token-launch-by-date-assets.js";
import { readArtifact } from "../../operations/semantic-expansion/shared.js";

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

interface CryptoReadinessArtifact {
  observedAt: string;
  laneId: string;
  familyKey: string;
  venuePair: string;
  exactSafeDateBuckets?: readonly string[];
  exactSafeThresholdBuckets?: readonly string[];
  exactSafeOutcomeLabels?: readonly string[];
  exactSafeFdvThresholdBuckets?: readonly string[];
  exactSafeLaunchDateBuckets?: readonly string[];
  exactSafeTopics: readonly string[];
  ruleStatus: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
  operatorRuleReviewRequired: boolean;
  matcherReady: boolean;
  operatorCredible: boolean;
  readinessReviewJustified: boolean;
  rolloutRecommended: false;
  recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
  finalReadinessLabel: string;
}

interface CryptoAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: string;
  familyKey: string;
  venuePair: string;
  exactSafeDateBuckets?: readonly string[];
  exactSafeThresholdBuckets?: readonly string[];
  exactSafeOutcomeLabels?: readonly string[];
  exactSafeFdvThresholdBuckets?: readonly string[];
  exactSafeLaunchDateBuckets?: readonly string[];
  currentReadinessDecision: string;
  sourceArtifactRefs: readonly string[];
}

export interface CryptoPromotionEvent {
  id: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface CryptoLimitedProdLaneSummary {
  laneId: string;
  familyKey: string;
  laneType: "PAIR";
  venueSet: string;
  candidateSet: readonly string[];
  readinessDecision: string;
  operatorCredible: boolean;
  operatorRuleReviewRequired: boolean;
  blockers: readonly string[];
  sourceArtifactRefs: readonly string[];
}

export interface CryptoLimitedProdRollbackPlan {
  laneId: string;
  rollbackTarget: "LANE_HOLD";
  fallbackLaneId: string | null;
  holdConditions: readonly string[];
  operatorSteps: readonly string[];
}

interface CryptoLaneArtifacts {
  config:
    | CryptoAthByDateAssetConfig
    | CryptoThresholdByDateAssetConfig
    | CryptoFirstToThresholdByDateAssetConfig
    | CryptoFdvAfterLaunchProjectConfig
    | CryptoTokenLaunchByDateProjectConfig;
  readiness: CryptoReadinessArtifact;
  adminSummary: CryptoAdminSurfaceSummaryArtifact;
}

export class CryptoLaneNotFoundError extends Error {
  public constructor(laneId: string) {
    super(`Crypto lane ${laneId} not found.`);
    this.name = "CryptoLaneNotFoundError";
  }
}

export class CryptoLaneTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CryptoLaneTransitionError";
  }
}

export interface CryptoAdminServiceDeps {
  pool: Pool;
  repoRoot?: string;
}

const mapPromotionEvent = (row: PromotionEventRow): CryptoPromotionEvent => ({
  id: row.id,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

const corePathsFor = (
  config:
    | CryptoAthByDateAssetConfig
    | CryptoThresholdByDateAssetConfig
    | CryptoFirstToThresholdByDateAssetConfig
    | CryptoFdvAfterLaunchProjectConfig
    | CryptoTokenLaunchByDateProjectConfig
) => {
  const stem = `crypto-${config.artifactKey}`;
  return {
    readiness: `artifacts/crypto/core/${stem}-limited-prod-readiness.json`,
    adminSurfaceSummary: `artifacts/crypto/core/${stem}-admin-surface-summary.json`
  };
};

export class CryptoAdminService {
  private readonly repoRoot: string;

  public constructor(private readonly deps: CryptoAdminServiceDeps) {
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
  }

  private loadLaneArtifacts(
    config:
      | CryptoAthByDateAssetConfig
      | CryptoThresholdByDateAssetConfig
      | CryptoFirstToThresholdByDateAssetConfig
      | CryptoFdvAfterLaunchProjectConfig
      | CryptoTokenLaunchByDateProjectConfig
  ): CryptoLaneArtifacts {
    const paths = corePathsFor(config);
    return {
      config,
      readiness: readArtifact<CryptoReadinessArtifact>(this.repoRoot, paths.readiness),
      adminSummary: readArtifact<CryptoAdminSurfaceSummaryArtifact>(this.repoRoot, paths.adminSurfaceSummary)
    };
  }

  private loadAllLaneArtifacts(): readonly CryptoLaneArtifacts[] {
    return [
      ...cryptoAthByDateAssetConfigs.map((config) => this.loadLaneArtifacts(config)),
      ...cryptoThresholdByDateAssetConfigs.map((config) => this.loadLaneArtifacts(config)),
      ...cryptoFirstToThresholdByDateAssetConfigs.map((config) => this.loadLaneArtifacts(config)),
      ...cryptoFdvAfterLaunchProjectConfigs.map((config) => this.loadLaneArtifacts(config)),
      ...cryptoTokenLaunchByDateProjectConfigs.map((config) => this.loadLaneArtifacts(config))
    ];
  }

  private getLaneArtifacts(laneId: string): CryptoLaneArtifacts {
    const lane = this.loadAllLaneArtifacts().find((entry) => entry.readiness.laneId === laneId);
    if (!lane) {
      throw new CryptoLaneNotFoundError(laneId);
    }
    return lane;
  }

  private buildLaneSummary(artifacts: CryptoLaneArtifacts): CryptoLimitedProdLaneSummary {
    const candidateSet =
      artifacts.readiness.exactSafeDateBuckets
      ?? artifacts.readiness.exactSafeThresholdBuckets
      ?? artifacts.readiness.exactSafeOutcomeLabels
      ?? artifacts.readiness.exactSafeFdvThresholdBuckets
      ?? artifacts.readiness.exactSafeLaunchDateBuckets
      ?? artifacts.adminSummary.exactSafeDateBuckets
      ?? artifacts.adminSummary.exactSafeThresholdBuckets
      ?? artifacts.adminSummary.exactSafeOutcomeLabels
      ?? artifacts.adminSummary.exactSafeFdvThresholdBuckets
      ?? artifacts.adminSummary.exactSafeLaunchDateBuckets
      ?? [];
    return {
      laneId: artifacts.readiness.laneId,
      familyKey: artifacts.readiness.familyKey,
      laneType: "PAIR",
      venueSet: artifacts.readiness.venuePair,
      candidateSet,
      readinessDecision: artifacts.adminSummary.currentReadinessDecision,
      operatorCredible: artifacts.readiness.operatorCredible,
      operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
      blockers: [
        ...(artifacts.readiness.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(artifacts.adminSummary.currentReadinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
          ? ["lane_not_ready_for_limited_prod_review"]
          : [])
      ],
      sourceArtifactRefs: artifacts.adminSummary.sourceArtifactRefs
    };
  }

  private async listPromotionEvents(
    config:
      | CryptoAthByDateAssetConfig
      | CryptoThresholdByDateAssetConfig
      | CryptoFirstToThresholdByDateAssetConfig
      | CryptoFdvAfterLaunchProjectConfig
      | CryptoTokenLaunchByDateProjectConfig
  ): Promise<readonly CryptoPromotionEvent[]> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `SELECT id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE strategy_key = $1 AND scope_type = $2
        ORDER BY created_at DESC, id DESC`,
      [config.rolloutStrategyKey, config.rolloutScopeType]
    );
    return result.rows.map(mapPromotionEvent);
  }

  private async getCurrentStage(
    config:
      | CryptoAthByDateAssetConfig
      | CryptoThresholdByDateAssetConfig
      | CryptoFirstToThresholdByDateAssetConfig
      | CryptoFdvAfterLaunchProjectConfig
      | CryptoTokenLaunchByDateProjectConfig,
    laneId: string
  ): Promise<QualificationStage> {
    const events = await this.listPromotionEvents(config);
    const latest = events.find((event) => event.scopeId === laneId);
    return latest?.toStage ?? QualificationStage.INTERNAL_ONLY;
  }

  private async recordEvent(input: {
    config:
      | CryptoAthByDateAssetConfig
      | CryptoThresholdByDateAssetConfig
      | CryptoFirstToThresholdByDateAssetConfig
      | CryptoFdvAfterLaunchProjectConfig
      | CryptoTokenLaunchByDateProjectConfig;
    laneId: string;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<CryptoPromotionEvent> {
    const result = await this.deps.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        input.config.rolloutStrategyKey,
        input.config.rolloutScopeType,
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

  public async listLanes(): Promise<readonly (CryptoLimitedProdLaneSummary & { currentStage: QualificationStage })[]> {
    const summaries = this.loadAllLaneArtifacts().map((artifacts) => this.buildLaneSummary(artifacts));
    return Promise.all(summaries.map(async (lane) => ({
      ...lane,
      currentStage: await this.getCurrentStage(this.getLaneArtifacts(lane.laneId).config, lane.laneId)
    })));
  }

  public async getLane(laneId: string): Promise<CryptoLimitedProdLaneSummary & { currentStage: QualificationStage }> {
    const artifacts = this.getLaneArtifacts(laneId);
    const lane = this.buildLaneSummary(artifacts);
    return {
      ...lane,
      currentStage: await this.getCurrentStage(artifacts.config, lane.laneId)
    };
  }

  public async getReadiness(laneId: string) {
    const artifacts = this.getLaneArtifacts(laneId);
    return {
      observedAt: new Date().toISOString(),
      laneId: artifacts.readiness.laneId,
      familyKey: artifacts.readiness.familyKey,
      laneType: "PAIR" as const,
      venueSet: artifacts.readiness.venuePair,
      candidateSet:
        artifacts.readiness.exactSafeDateBuckets
        ?? artifacts.readiness.exactSafeThresholdBuckets
        ?? artifacts.readiness.exactSafeOutcomeLabels
        ?? artifacts.readiness.exactSafeFdvThresholdBuckets
        ?? artifacts.readiness.exactSafeLaunchDateBuckets
        ?? [],
      exactSafeDateBuckets: artifacts.readiness.exactSafeDateBuckets,
      exactSafeThresholdBuckets: artifacts.readiness.exactSafeThresholdBuckets,
      exactSafeOutcomeLabels: artifacts.readiness.exactSafeOutcomeLabels,
      exactSafeFdvThresholdBuckets: artifacts.readiness.exactSafeFdvThresholdBuckets,
      exactSafeLaunchDateBuckets: artifacts.readiness.exactSafeLaunchDateBuckets,
      exactSafeTopics: artifacts.readiness.exactSafeTopics,
      ruleStatus: artifacts.readiness.ruleStatus,
      operatorRuleReviewRequired: artifacts.readiness.operatorRuleReviewRequired,
      matcherReady: artifacts.readiness.matcherReady,
      operatorCredible: artifacts.readiness.operatorCredible,
      readinessReviewJustified: artifacts.adminSummary.currentReadinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY" as const,
      finalReadinessLabel: artifacts.readiness.finalReadinessLabel
    };
  }

  public async getRollbackPlan(laneId: string): Promise<CryptoLimitedProdRollbackPlan> {
    const artifacts = this.getLaneArtifacts(laneId);
    const scopeName = "asset" in artifacts.config ? artifacts.config.asset : artifacts.config.project;
    return {
      laneId,
      rollbackTarget: "LANE_HOLD",
      fallbackLaneId: null,
      holdConditions: [
        "date_scope_drift",
        "venue_scope_drift",
        "rule_status_drift",
        "operator_confidence_lost"
      ],
      operatorSteps: [
        `Record a lane-scoped rollback or hold event for ${laneId}.`,
        `Keep this ${scopeName} crypto lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.`,
        "Do not widen candidate scope during rollback."
      ]
    };
  }

  public async recordOperatorApprovalIntent(laneId: string, createdBy: string, reason?: string | null) {
    const artifacts = this.getLaneArtifacts(laneId);
    const lane = await this.getLane(laneId);
    if (lane.readinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION") {
      throw new CryptoLaneTransitionError(`Operator approval intent blocked: ${lane.readinessDecision}`);
    }
    const event = await this.recordEvent({
      config: artifacts.config,
      laneId,
      fromStage: lane.currentStage,
      toStage: lane.currentStage,
      reason: reason ?? "crypto operator approval intent",
      createdBy,
      metadata: {
        actionKind: "OPERATOR_APPROVAL_INTENT",
        familyKey: lane.familyKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      currentStage: lane.currentStage
    };
  }

  public async holdLane(laneId: string, createdBy: string, reason: string) {
    const artifacts = this.getLaneArtifacts(laneId);
    const lane = await this.getLane(laneId);
    const event = await this.recordEvent({
      config: artifacts.config,
      laneId,
      fromStage: lane.currentStage,
      toStage: QualificationStage.INTERNAL_ONLY,
      reason,
      createdBy,
      metadata: {
        actionKind: "LANE_HOLD",
        familyKey: lane.familyKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      newStage: QualificationStage.INTERNAL_ONLY
    };
  }

  public async rollbackLane(laneId: string, createdBy: string, reason: string) {
    const artifacts = this.getLaneArtifacts(laneId);
    const lane = await this.getLane(laneId);
    const event = await this.recordEvent({
      config: artifacts.config,
      laneId,
      fromStage: lane.currentStage,
      toStage: QualificationStage.INTERNAL_ONLY,
      reason,
      createdBy,
      metadata: {
        actionKind: "LANE_ROLLBACK",
        familyKey: lane.familyKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet,
        fallbackLaneId: null
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      newStage: QualificationStage.INTERNAL_ONLY,
      fallbackLaneId: null
    };
  }
}
