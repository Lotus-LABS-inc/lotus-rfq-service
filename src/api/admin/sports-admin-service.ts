import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import { readArtifact } from "../../operations/semantic-expansion/shared.js";
import {
  SPORTS_CHAMPIONS_LEAGUE_WINNER_ROLLOUT_SCOPE_TYPE,
  SPORTS_CHAMPIONS_LEAGUE_WINNER_ROLLOUT_STRATEGY_KEY,
  sportsChampionsLeagueWinner20252026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-champions-league-winner-2025-2026-limited-prod-shared.js";
import {
  SPORTS_EPL_WINNER_ROLLOUT_SCOPE_TYPE,
  SPORTS_EPL_WINNER_ROLLOUT_STRATEGY_KEY,
  sportsEplWinner20252026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-epl-winner-2025-2026-limited-prod-shared.js";
import {
  SPORTS_LA_LIGA_WINNER_ROLLOUT_SCOPE_TYPE,
  SPORTS_LA_LIGA_WINNER_ROLLOUT_STRATEGY_KEY,
  sportsLaLigaWinner20252026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-la-liga-winner-2025-2026-limited-prod-shared.js";
import {
  SPORTS_NBA_CHAMPION_2025_2026_ROLLOUT_SCOPE_TYPE,
  SPORTS_NBA_CHAMPION_2025_2026_ROLLOUT_STRATEGY_KEY,
  sportsNbaChampion20252026PairPolymarketPredictLaneId
} from "../../operations/semantic-expansion/sports-nba-champion-2025-2026-limited-prod-shared.js";
import {
  SPORTS_F1_DRIVERS_CHAMPION_2026_ROLLOUT_SCOPE_TYPE,
  SPORTS_F1_DRIVERS_CHAMPION_2026_ROLLOUT_STRATEGY_KEY,
  sportsF1DriversChampion2026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-f1-drivers-champion-2026-limited-prod-shared.js";
import {
  SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ROLLOUT_SCOPE_TYPE,
  SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ROLLOUT_STRATEGY_KEY,
  sportsF1ConstructorsChampion2026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-f1-constructors-champion-2026-limited-prod-shared.js";
import {
  SPORTS_LCK_WINNER_2026_ROLLOUT_SCOPE_TYPE,
  SPORTS_LCK_WINNER_2026_ROLLOUT_STRATEGY_KEY,
  sportsLckWinner2026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-lck-winner-2026-limited-prod-shared.js";
import {
  SPORTS_LPL_WINNER_2026_ROLLOUT_SCOPE_TYPE,
  SPORTS_LPL_WINNER_2026_ROLLOUT_STRATEGY_KEY,
  sportsLplWinner2026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-lpl-winner-2026-limited-prod-shared.js";
import {
  SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_ROLLOUT_SCOPE_TYPE,
  SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_ROLLOUT_STRATEGY_KEY,
  sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-nhl-stanley-cup-champion-2025-2026-limited-prod-shared.js";
import {
  SPORTS_WORLD_CUP_WINNER_2026_ROLLOUT_SCOPE_TYPE,
  SPORTS_WORLD_CUP_WINNER_2026_ROLLOUT_STRATEGY_KEY,
  sportsWorldCupWinner2026PairLimitlessPolymarketLaneId
} from "../../operations/semantic-expansion/sports-world-cup-winner-2026-limited-prod-shared.js";
import type { SportsLaneCardinality } from "../../matching/sports/sports-lane-cardinality.js";
import type { SportsLaneCatalogEntry } from "../../operations/semantic-expansion/sports-lane-cardinality-catalog.js";

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

export interface SportsPromotionEvent {
  id: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface SportsLimitedProdLaneSummary {
  laneId: string;
  topicKey: string;
  laneType: SportsLaneCardinality;
  venueSet: string;
  clubSet: readonly string[];
  readinessDecision: string;
  operatorCredible: boolean;
  operatorRuleReviewRequired: boolean;
  pairPreferred: boolean;
  blockers: readonly string[];
  sourceArtifactRefs: readonly string[];
}

export interface SportsLimitedProdRollbackPlan {
  laneId: string;
  rollbackTarget: "LANE_HOLD";
  fallbackLaneId: string | null;
  holdConditions: readonly string[];
  operatorSteps: readonly string[];
}

export interface SportsLaneAuthorityState {
  laneId: string;
  topicKey: string;
  laneType: SportsLaneCardinality;
  venueSet: string;
  clubSet: readonly string[];
  readinessDecision: string;
  currentStage: QualificationStage;
  latestEventId: string | null;
  latestEventAt: string | null;
  latestActionKind: string | null;
  operatorApprovedToOffer: boolean;
}

interface SportsTopicLaneCatalogArtifact {
  observedAt: string;
  canonicalTopicKey: string;
  lanes: SportsLaneCatalogEntry[];
}

interface SportsTopicConfig {
  laneIdPrefix: string;
  laneCatalogPath: string;
  strategyKey: string;
  scopeType: string;
  primaryPairLaneId: string;
}

const topicConfigs: readonly SportsTopicConfig[] = [
  {
    laneIdPrefix: "SPORTS_EPL_WINNER_2025_2026",
    laneCatalogPath: "artifacts/sports/epl-winner-2025-2026-matcher/sports-epl-winner-2025-2026-lane-catalog.json",
    strategyKey: SPORTS_EPL_WINNER_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_EPL_WINNER_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsEplWinner20252026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_LA_LIGA_WINNER_2025_2026",
    laneCatalogPath: "artifacts/sports/la-liga-winner-2025-2026-matcher/sports-la-liga-winner-2025-2026-lane-catalog.json",
    strategyKey: SPORTS_LA_LIGA_WINNER_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_LA_LIGA_WINNER_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsLaLigaWinner20252026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026",
    laneCatalogPath: "artifacts/sports/champions-league-winner-2025-2026-matcher/sports-champions-league-winner-2025-2026-lane-catalog.json",
    strategyKey: SPORTS_CHAMPIONS_LEAGUE_WINNER_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_CHAMPIONS_LEAGUE_WINNER_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsChampionsLeagueWinner20252026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_WORLD_CUP_WINNER_2026",
    laneCatalogPath: "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-lane-catalog.json",
    strategyKey: SPORTS_WORLD_CUP_WINNER_2026_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_WORLD_CUP_WINNER_2026_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsWorldCupWinner2026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_NBA_CHAMPION_2025_2026",
    laneCatalogPath: "artifacts/sports/nba-champion-2025-2026-matcher/sports-nba-champion-2025-2026-lane-catalog.json",
    strategyKey: SPORTS_NBA_CHAMPION_2025_2026_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_NBA_CHAMPION_2025_2026_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsNbaChampion20252026PairPolymarketPredictLaneId
  },
  {
    laneIdPrefix: "SPORTS_F1_DRIVERS_CHAMPION_2026",
    laneCatalogPath: "artifacts/sports/f1-drivers-champion-2026-matcher/sports-f1-drivers-champion-2026-lane-catalog.json",
    strategyKey: SPORTS_F1_DRIVERS_CHAMPION_2026_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_F1_DRIVERS_CHAMPION_2026_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsF1DriversChampion2026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026",
    laneCatalogPath: "artifacts/sports/f1-constructors-champion-2026-matcher/sports-f1-constructors-champion-2026-lane-catalog.json",
    strategyKey: SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsF1ConstructorsChampion2026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_LCK_WINNER_2026",
    laneCatalogPath: "artifacts/sports/lck-winner-2026-matcher/sports-lck-winner-2026-lane-catalog.json",
    strategyKey: SPORTS_LCK_WINNER_2026_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_LCK_WINNER_2026_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsLckWinner2026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_LPL_WINNER_2026",
    laneCatalogPath: "artifacts/sports/lpl-winner-2026-matcher/sports-lpl-winner-2026-lane-catalog.json",
    strategyKey: SPORTS_LPL_WINNER_2026_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_LPL_WINNER_2026_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsLplWinner2026PairLimitlessPolymarketLaneId
  },
  {
    laneIdPrefix: "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026",
    laneCatalogPath: "artifacts/sports/nhl-stanley-cup-champion-2025-2026-matcher/sports-nhl-stanley-cup-champion-2025-2026-lane-catalog.json",
    strategyKey: SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_ROLLOUT_STRATEGY_KEY,
    scopeType: SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_ROLLOUT_SCOPE_TYPE,
    primaryPairLaneId: sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId
  }
] as const;

export class SportsLaneNotFoundError extends Error {
  public constructor(laneId: string) {
    super(`Sports lane ${laneId} not found.`);
    this.name = "SportsLaneNotFoundError";
  }
}

export class SportsLaneTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SportsLaneTransitionError";
  }
}

export interface SportsAdminServiceDeps {
  pool: Pool;
  repoRoot?: string;
}

const mapPromotionEvent = (row: PromotionEventRow): SportsPromotionEvent => ({
  id: row.id,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

const sortLaneEntries = (lanes: readonly SportsLaneCatalogEntry[]): readonly SportsLaneCatalogEntry[] =>
  [...lanes].sort((left, right) =>
    left.topicKey.localeCompare(right.topicKey)
    || left.laneCardinality.localeCompare(right.laneCardinality)
    || left.venueSet.localeCompare(right.venueSet)
  );

export class SportsAdminService {
  private readonly repoRoot: string;

  public constructor(private readonly deps: SportsAdminServiceDeps) {
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
  }

  private getTopicConfigForLane(laneId: string): SportsTopicConfig {
    const topicConfig = topicConfigs.find((config) => laneId.startsWith(config.laneIdPrefix));
    if (!topicConfig) {
      throw new SportsLaneNotFoundError(laneId);
    }
    return topicConfig;
  }

  private loadAllLaneCatalogEntries(): readonly SportsLaneCatalogEntry[] {
    return sortLaneEntries(
      topicConfigs.flatMap((config) =>
        readArtifact<SportsTopicLaneCatalogArtifact>(this.repoRoot, config.laneCatalogPath).lanes
      )
    );
  }

  private buildLaneSummaryFromEntry(lane: SportsLaneCatalogEntry): SportsLimitedProdLaneSummary {
    return {
      laneId: lane.laneId,
      topicKey: lane.topicKey,
      laneType: lane.laneCardinality,
      venueSet: lane.venueSet,
      clubSet: lane.exactSafeClubs,
      readinessDecision: lane.currentReadinessDecision,
      operatorCredible: lane.operatorCredible,
      operatorRuleReviewRequired: lane.operatorRuleReviewRequired,
      pairPreferred: lane.laneCardinality === "PAIR",
      blockers: [
        ...(lane.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []),
        ...(lane.currentReadinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
          ? ["lane_not_ready_for_limited_prod_review"]
          : [])
      ],
      sourceArtifactRefs: lane.sourceArtifactRefs
    };
  }

  private buildRollbackPlanFromEntry(lane: SportsLaneCatalogEntry): SportsLimitedProdRollbackPlan {
    const topicConfig = this.getTopicConfigForLane(lane.laneId);
    const fallbackLaneId =
      lane.laneCardinality === "STRICT_ALL" || lane.laneCardinality === "TRI"
        ? topicConfig.primaryPairLaneId
        : null;
    return {
      laneId: lane.laneId,
      rollbackTarget: "LANE_HOLD",
      fallbackLaneId,
      holdConditions: [
        "club_scope_drift",
        "venue_scope_drift",
        "rule_status_drift",
        "operator_confidence_lost"
      ],
      operatorSteps: fallbackLaneId
        ? [
          `Record a lane-scoped rollback or hold event for ${lane.laneId}.`,
          `Revert this lane to the primary pair route ${fallbackLaneId} in internal-review-only posture.`,
          "Do not widen venue scope or club scope during rollback."
        ]
        : [
          `Record a lane-scoped rollback or hold event for ${lane.laneId}.`,
          "Keep this lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated."
        ]
    };
  }

  private async listPromotionEvents(): Promise<readonly SportsPromotionEvent[]> {
    const params = topicConfigs.flatMap((config) => [config.strategyKey, config.scopeType]);
    const clauses = topicConfigs
      .map((_, index) => `(strategy_key = $${(index * 2) + 1} AND scope_type = $${(index * 2) + 2})`)
      .join(" OR ");
    const result = await this.deps.pool.query<PromotionEventRow>(
      `SELECT id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE ${clauses}
        ORDER BY created_at DESC, id DESC`,
      params
    );
    return result.rows.map(mapPromotionEvent);
  }

  private async getCurrentStageMap(): Promise<Record<string, QualificationStage>> {
    const laneIds = this.loadAllLaneCatalogEntries().map((lane) => lane.laneId);
    const defaults = Object.fromEntries(
      laneIds.map((laneId) => [laneId, QualificationStage.INTERNAL_ONLY])
    ) as Record<string, QualificationStage>;
    const events = await this.listPromotionEvents();
    for (const laneId of laneIds) {
      const latest = events.find((event) => event.scopeId === laneId);
      if (latest) {
        defaults[laneId] = latest.toStage;
      }
    }
    return defaults;
  }

  private async recordEvent(input: {
    laneId: string;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<SportsPromotionEvent> {
    const topicConfig = this.getTopicConfigForLane(input.laneId);
    const result = await this.deps.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        topicConfig.strategyKey,
        topicConfig.scopeType,
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

  public async listLanes(): Promise<readonly (SportsLimitedProdLaneSummary & { currentStage: QualificationStage })[]> {
    const stages = await this.getCurrentStageMap();
    return this.loadAllLaneCatalogEntries().map((lane) => ({
      ...this.buildLaneSummaryFromEntry(lane),
      currentStage: stages[lane.laneId] ?? QualificationStage.INTERNAL_ONLY
    }));
  }

  public async getLane(laneId: string): Promise<SportsLimitedProdLaneSummary & { currentStage: QualificationStage }> {
    const lane = this.loadAllLaneCatalogEntries().find((entry) => entry.laneId === laneId);
    if (!lane) {
      throw new SportsLaneNotFoundError(laneId);
    }
    const stages = await this.getCurrentStageMap();
    return {
      ...this.buildLaneSummaryFromEntry(lane),
      currentStage: stages[lane.laneId] ?? QualificationStage.INTERNAL_ONLY
    };
  }

  public async getReadiness(laneId: string) {
    const lane = this.loadAllLaneCatalogEntries().find((entry) => entry.laneId === laneId);
    if (!lane) {
      throw new SportsLaneNotFoundError(laneId);
    }
    return {
      observedAt: new Date().toISOString(),
      laneId: lane.laneId,
      topicKey: lane.topicKey,
      laneCardinality: lane.laneCardinality,
      venueSet: lane.venueSet,
      exactSafeClubs: lane.exactSafeClubs,
      ruleStatus: lane.ruleStatus,
      operatorRuleReviewRequired: lane.operatorRuleReviewRequired,
      matcherReady: lane.matcherReady,
      operatorCredible: lane.operatorCredible,
      readinessReviewJustified: lane.currentReadinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      finalReadinessLabel: lane.finalReadinessLabel
    };
  }

  public async getRollbackPlan(laneId: string) {
    const lane = this.loadAllLaneCatalogEntries().find((entry) => entry.laneId === laneId);
    if (!lane) {
      throw new SportsLaneNotFoundError(laneId);
    }
    return this.buildRollbackPlanFromEntry(lane);
  }

  public async getLaneAuthorityState(laneId: string): Promise<SportsLaneAuthorityState> {
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
      clubSet: lane.clubSet,
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

  public async recordOperatorApprovalIntent(laneId: string, createdBy: string, reason?: string | null) {
    const lane = await this.getLane(laneId);
    if (lane.readinessDecision !== "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION") {
      throw new SportsLaneTransitionError(`Operator approval intent blocked: ${lane.readinessDecision}`);
    }
    const event = await this.recordEvent({
      laneId,
      fromStage: lane.currentStage,
      toStage: lane.currentStage,
      reason: reason ?? "sports operator approval intent",
      createdBy,
      metadata: {
        actionKind: "OPERATOR_APPROVAL_INTENT",
        topicKey: lane.topicKey,
        laneType: lane.laneType,
        venueSet: lane.venueSet,
        clubSet: lane.clubSet
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      currentStage: lane.currentStage
    };
  }

  public async holdLane(laneId: string, createdBy: string, reason: string) {
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
        clubSet: lane.clubSet
      }
    });
    return {
      laneId,
      recordedAt: event.createdAt.toISOString(),
      newStage: QualificationStage.INTERNAL_ONLY
    };
  }

  public async rollbackLane(laneId: string, createdBy: string, reason: string) {
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
        clubSet: lane.clubSet,
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
