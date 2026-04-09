import path from "node:path";

import type { Pool, QueryResultRow } from "pg";
import type { Logger } from "pino";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import {
  buildAllPairRouteQualifications,
  loadPairRouteArtifactInputs,
  type PairRouteQualification
} from "../../qualification/pair-route-qualification.js";
import { buildPairPromotionEvidencePolicy } from "../../rollout/pair-promotion-evidence-policy.js";
import { PairPromotionDecisionLog } from "../../rollout/pair-promotion-decision-log.js";
import { PairPromotionDecisionRepository } from "../../rollout/pair-promotion-decision-repository.js";
import { assertPairRouteDemotionAllowed } from "../../rollout/pair-route-demotion-policy.js";
import { assertPairRoutePromotionAllowed } from "../../rollout/pair-route-promotion-policy.js";
import type { PairRouteClassId } from "../../rollout/pair-route-classes.js";
import { PairShadowAggregator } from "../../shadow/pair-shadow-aggregator.js";
import { PairShadowObservationRepository } from "../../shadow/pair-shadow-observation-repository.js";
import type { PairPromotionDecisionRecord } from "../../shadow/pair-shadow-observation-types.js";
import { PairShadowRuntimeHooks } from "../../shadow/pair-shadow-runtime-hooks.js";
import { PairShadowRuntimeWriter, type PairShadowTopUpInput } from "../../shadow/pair-shadow-runtime-writer.js";
import {
  buildCryptoProdArtifacts,
  type CryptoApprovedScopeSlice,
  type CryptoOperatorApprovalIntent,
  type CryptoProdReadinessRouteSummary,
  type CryptoRollbackPlan
} from "../../operations/semantic-expansion/crypto-prod-readiness.js";
import { readArtifact } from "../../operations/semantic-expansion/shared.js";
import {
  buildCryptoFinalCanaryPackage,
  type CryptoCanaryApprovalState,
  type CryptoCanaryScopeLockArtifact,
  type CryptoFinalCanaryPackageArtifact
} from "../../reports/crypto-final-canary-package.js";

interface PromotionEventRow extends QueryResultRow {
  id: string;
  strategy_key: string;
  scope_type: string;
  scope_id: string;
  from_stage: string;
  to_stage: string;
  reason: string;
  created_by: string;
  created_at: Date;
  metadata: Record<string, unknown>;
}

export interface PairRoutePromotionEvent {
  id: string;
  strategyKey: string;
  scopeType: string;
  scopeId: string;
  fromStage: QualificationStage;
  toStage: QualificationStage;
  reason: string;
  createdBy: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface PairRouteAdminServiceDeps {
  pool: Pool;
  shadowPool?: Pool;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  repoRoot?: string;
}

export class PairRouteNotFoundError extends Error {
  public constructor(routeClassId: string) {
    super(`Pair route class ${routeClassId} not found.`);
    this.name = "PairRouteNotFoundError";
  }
}

export class PairRouteStageTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PairRouteStageTransitionError";
  }
}

const mapPromotionEventRow = (row: PromotionEventRow): PairRoutePromotionEvent => ({
  id: row.id,
  strategyKey: row.strategy_key,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  fromStage: row.from_stage as QualificationStage,
  toStage: row.to_stage as QualificationStage,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  metadata: row.metadata
});

export class PairRouteAdminService {
  private readonly pool: Pool;
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;
  private readonly repoRoot: string;
  private readonly shadowPool: Pool;
  private readonly shadowObservationRepository: PairShadowObservationRepository;
  private readonly promotionDecisionRepository: PairPromotionDecisionRepository;
  private readonly promotionDecisionLog: PairPromotionDecisionLog;
  private readonly runtimeHooks: PairShadowRuntimeHooks;

  public constructor(deps: PairRouteAdminServiceDeps) {
    this.pool = deps.pool;
    this.logger = deps.logger;
    this.repoRoot = deps.repoRoot ?? path.resolve(process.cwd());
    this.shadowPool = deps.shadowPool ?? deps.pool;
    this.shadowObservationRepository = new PairShadowObservationRepository(this.shadowPool);
    this.promotionDecisionRepository = new PairPromotionDecisionRepository(this.shadowObservationRepository);
    this.promotionDecisionLog = new PairPromotionDecisionLog(this.promotionDecisionRepository);
    this.runtimeHooks = new PairShadowRuntimeHooks({
      writer: new PairShadowRuntimeWriter({
        repository: this.shadowObservationRepository,
        repoRoot: this.repoRoot,
        ...(this.logger ? { logger: this.logger } : {})
      }),
      ...(this.logger ? { logger: this.logger } : {})
    });
  }

  private async listPromotionEvents(): Promise<readonly PairRoutePromotionEvent[]> {
    const result = await this.pool.query<PromotionEventRow>(
      `SELECT id, strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata
         FROM strategy_promotion_events
        WHERE strategy_key = 'pair-route-rollout-v1'
          AND scope_type = 'PAIR_ROUTE_CLASS'
        ORDER BY created_at DESC, id DESC`
    );
    return result.rows.map(mapPromotionEventRow);
  }

  private async getCurrentStages(): Promise<Record<PairRouteClassId, QualificationStage>> {
    const defaults: Record<PairRouteClassId, QualificationStage> = {
      PAIR_PM_LIMITLESS: QualificationStage.INTERNAL_ONLY,
      PAIR_PM_OPINION: QualificationStage.INTERNAL_ONLY
    };
    const events = await this.listPromotionEvents();
    for (const routeClassId of Object.keys(defaults) as PairRouteClassId[]) {
      const latestEvent = events.find((entry) => entry.scopeId === routeClassId);
      if (latestEvent) {
        defaults[routeClassId] = latestEvent.toStage;
      }
    }
    return defaults;
  }

  private async buildQualifications(): Promise<readonly PairRouteQualification[]> {
    const inputs = loadPairRouteArtifactInputs(this.repoRoot);
    const currentStages = await this.getCurrentStages();
    return buildAllPairRouteQualifications(currentStages, inputs);
  }

  public async listPairRoutes(): Promise<readonly PairRouteQualification[]> {
    return this.buildQualifications();
  }

  public async getPairRoute(routeClassId: PairRouteClassId): Promise<PairRouteQualification> {
    const qualifications = await this.buildQualifications();
    const qualification = qualifications.find((entry) => entry.routeClassId === routeClassId);
    if (!qualification) {
      throw new PairRouteNotFoundError(routeClassId);
    }
    return qualification;
  }

  public async getPairRouteCoverage(routeClassId: PairRouteClassId): Promise<{
    qualification: PairRouteQualification;
    rolloutSummary: Record<string, unknown>;
  }> {
    const qualification = await this.getPairRoute(routeClassId);
    const rolloutSummary = readArtifact<Record<string, unknown>>(this.repoRoot, "docs/pair-route-rollout-summary.json");
    return { qualification, rolloutSummary };
  }

  private async buildEvidencePolicy(routeClassId: PairRouteClassId) {
    const qualification = await this.getPairRoute(routeClassId);
    const aggregator = new PairShadowAggregator(this.shadowObservationRepository, this.repoRoot);
    const evidence = await aggregator.buildEvidence(qualification);
    return buildPairPromotionEvidencePolicy(qualification, evidence);
  }

  public async getShadowEvidence(routeClassId: PairRouteClassId) {
    return (await this.buildEvidencePolicy(routeClassId)).evidence;
  }

  public async getCanaryReadiness(routeClassId: PairRouteClassId) {
    return (await this.buildEvidencePolicy(routeClassId)).canaryReadiness;
  }

  public async getPromotionBlockers(routeClassId: PairRouteClassId): Promise<readonly string[]> {
    return (await this.buildEvidencePolicy(routeClassId)).canaryReadiness.blockerReasons;
  }

  public async getCryptoProdReadiness(routeClassId: PairRouteClassId): Promise<CryptoProdReadinessRouteSummary> {
    const artifacts = await buildCryptoProdArtifacts(this);
    const route = artifacts.readinessSummary.routes.find((entry) => entry.routeClass === routeClassId);
    if (!route) {
      throw new PairRouteNotFoundError(routeClassId);
    }
    return route;
  }

  public async getCryptoLaunchPlan(routeClassId: PairRouteClassId): Promise<{
    routeClass: PairRouteClassId;
    scopePromoted: string | null;
    approvedScope: CryptoApprovedScopeSlice;
    healthWatchMetrics: readonly string[];
    operatorApproval: "ADMIN_PLUS_2FA_REQUIRED";
  }> {
    const artifacts = await buildCryptoProdArtifacts(this);
    const route = artifacts.readinessSummary.routes.find((entry) => entry.routeClass === routeClassId);
    if (!route) {
      throw new PairRouteNotFoundError(routeClassId);
    }
    return {
      routeClass: route.routeClass,
      scopePromoted: route.approvedScope.scopeLabel,
      approvedScope: route.approvedScope,
      healthWatchMetrics: [
        "expectedNetExecutionImprovement",
        "staleDataRate",
        "mixedBasisRate",
        "venueHealthFailureRate"
      ],
      operatorApproval: "ADMIN_PLUS_2FA_REQUIRED"
    };
  }

  public async getCryptoRollbackPlan(routeClassId: PairRouteClassId): Promise<CryptoRollbackPlan> {
    const artifacts = await buildCryptoProdArtifacts(this);
    const route = artifacts.rollbackPlan.routes.find((entry) => entry.routeClass === routeClassId);
    if (!route) {
      throw new PairRouteNotFoundError(routeClassId);
    }
    return route;
  }

  public async recordOperatorApprovalIntent(
    routeClassId: PairRouteClassId,
    requestedBy: string,
    reason?: string | null
  ): Promise<CryptoOperatorApprovalIntent> {
    if (routeClassId !== "PAIR_PM_OPINION") {
      throw new PairRouteStageTransitionError(
        "Operator approval intent is only allowed for the first live crypto canary: PAIR_PM_OPINION btc_exact_slice_only."
      );
    }
    const qualification = await this.getPairRoute(routeClassId);
    const cryptoReadiness = await this.getCryptoProdReadiness(routeClassId);
    if (cryptoReadiness.readinessDecision !== "READY_FOR_CANARY_PENDING_OPERATOR_ACTION") {
      throw new PairRouteStageTransitionError(
        `Operator approval intent blocked: ${cryptoReadiness.readinessDecision}`
      );
    }
    if (
      cryptoReadiness.approvedScope.scopeLabel !== "btc_exact_slice_only"
      || cryptoReadiness.approvedScope.allowedFamilies.length !== 1
      || cryptoReadiness.approvedScope.allowedFamilies[0] !== "CRYPTO:SAME_DAY_DIRECTIONAL"
      || cryptoReadiness.approvedScope.triAllowed
    ) {
      throw new PairRouteStageTransitionError(
        "Operator approval intent blocked: current approved scope does not match the first live crypto canary lock."
      );
    }
    const policy = await this.buildEvidencePolicy(routeClassId);
    await this.promotionDecisionLog.record({
      routeClass: routeClassId,
      scopePromoted: cryptoReadiness.approvedScope.scopeLabel ?? "unscoped",
      evidence: policy.evidence,
      canaryReadiness: policy.canaryReadiness,
      operatorIdentity: requestedBy,
      previousRolloutState: qualification.currentStage,
      newRolloutState: qualification.currentStage,
      rollbackReference: `approval-intent:${routeClassId}`,
      metadata: {
        actionKind: "OPERATOR_APPROVAL_INTENT",
        activationMode: "CANARY",
        scopeLabel: "btc_exact_slice_only",
        allowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"],
        packageKind: "FIRST_LIVE_CRYPTO_CANARY",
        approvedScope: cryptoReadiness.approvedScope,
        ...(reason ? { reason } : {})
      }
    });
    return {
      routeClass: routeClassId,
      scopeLabel: cryptoReadiness.approvedScope.scopeLabel,
      operatorIdentity: requestedBy,
      reason: reason ?? null,
      recordedAt: new Date().toISOString()
    };
  }

  public async listPromotionDecisions(routeClassId?: PairRouteClassId): Promise<readonly PairPromotionDecisionRecord[]> {
    return this.promotionDecisionRepository.list(routeClassId);
  }

  public async getCanaryScopeLock(routeClassId: PairRouteClassId): Promise<CryptoCanaryScopeLockArtifact> {
    const artifacts = await buildCryptoFinalCanaryPackage(this, this.repoRoot);
    if (routeClassId !== "PAIR_PM_OPINION") {
      return {
        ...artifacts.scopeLock,
        observedAt: new Date().toISOString(),
        scopeDecision: "BLOCKED_BY_SCOPE",
        blockers: ["first_live_window_locked_to_pair_pm_opinion"]
      };
    }
    return artifacts.scopeLock;
  }

  public async getCanaryApprovalState(routeClassId: PairRouteClassId): Promise<{
    routeClass: PairRouteClassId;
    approvalState: CryptoCanaryApprovalState;
    currentStage: string;
    latestApprovalIntentDecisionId: string | null;
  }> {
    const artifacts = await buildCryptoFinalCanaryPackage(this, this.repoRoot);
    if (routeClassId !== "PAIR_PM_OPINION") {
      return {
        routeClass: routeClassId,
        approvalState: "NOT_APPROVED",
        currentStage: (await this.getPairRoute(routeClassId)).currentStage,
        latestApprovalIntentDecisionId: null
      };
    }
    return {
      routeClass: routeClassId,
      approvalState: artifacts.operatorApproval.approvalState,
      currentStage: artifacts.activationPlan.currentStage,
      latestApprovalIntentDecisionId: artifacts.decisionLineage.latestApprovalIntentDecisionId
    };
  }

  public async getFinalCanaryPackage(routeClassId: PairRouteClassId): Promise<CryptoFinalCanaryPackageArtifact> {
    const artifacts = await buildCryptoFinalCanaryPackage(this, this.repoRoot);
    if (routeClassId !== "PAIR_PM_OPINION") {
      return {
        ...artifacts.finalPackageSummary,
        observedAt: new Date().toISOString(),
        routeClass: "PAIR_PM_OPINION",
        finalDecision: "CANARY_PACKAGE_BLOCKED_BY_SCOPE",
        nextOperatorAction: "Keep PAIR_PM_LIMITLESS out of the first live crypto canary package."
      };
    }
    return artifacts.finalPackageSummary;
  }

  public async listShadowObservations(routeClassId?: PairRouteClassId) {
    return this.shadowObservationRepository.listObservations(routeClassId);
  }

  public async recordRuntimeTopUpObservation(input: PairShadowTopUpInput) {
    return this.runtimeHooks.recordTopUp(input);
  }

  private async recordStageChange(input: {
    routeClassId: PairRouteClassId;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    requestedBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<PairRoutePromotionEvent> {
    const result = await this.pool.query<PromotionEventRow>(
      `INSERT INTO strategy_promotion_events
          (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
       VALUES ('pair-route-rollout-v1', 'PAIR_ROUTE_CLASS', $1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
      [
        input.routeClassId,
        input.fromStage,
        input.toStage,
        input.reason,
        input.requestedBy,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new PairRouteStageTransitionError("Failed to record pair-route stage change.");
    }
    return mapPromotionEventRow(row);
  }

  public async promoteShadow(routeClassId: PairRouteClassId, requestedBy: string, reason?: string | null): Promise<{
    qualification: PairRouteQualification;
    event: PairRoutePromotionEvent;
  }> {
    const qualification = await this.getPairRoute(routeClassId);
    assertPairRoutePromotionAllowed(qualification, QualificationStage.SHADOW);
    if (qualification.currentStage !== QualificationStage.INTERNAL_ONLY) {
      throw new PairRouteStageTransitionError("Shadow promotion only allowed from INTERNAL_ONLY.");
    }
    const event = await this.recordStageChange({
      routeClassId,
      fromStage: qualification.currentStage,
      toStage: QualificationStage.SHADOW,
      reason: reason ?? "pair route shadow promotion",
      requestedBy,
      metadata: {
        readinessState: qualification.readinessState,
        recommendation: qualification.recommendation
      }
    });
    return {
      qualification: await this.getPairRoute(routeClassId),
      event
    };
  }

  public async promoteCanary(routeClassId: PairRouteClassId, requestedBy: string, reason?: string | null): Promise<{
    qualification: PairRouteQualification;
    event: PairRoutePromotionEvent;
    decision: PairPromotionDecisionRecord;
  }> {
    const policy = await this.buildEvidencePolicy(routeClassId);
    const qualification = policy.qualification;
    assertPairRoutePromotionAllowed(qualification, QualificationStage.CANARY);
    if (qualification.currentStage !== QualificationStage.SHADOW) {
      throw new PairRouteStageTransitionError("Canary promotion only allowed from SHADOW.");
    }
    if (policy.canaryReadiness.recommendation !== "CANARY_APPROVED_PENDING_OPERATOR_ACTION") {
      throw new PairRouteStageTransitionError(
        `Canary promotion blocked by evidence policy: ${policy.canaryReadiness.blockerReasons.join(", ") || "insufficient_shadow_evidence"}`
      );
    }
    const event = await this.recordStageChange({
      routeClassId,
      fromStage: qualification.currentStage,
      toStage: QualificationStage.CANARY,
      reason: reason ?? "pair route canary promotion",
      requestedBy,
      metadata: {
        readinessState: qualification.readinessState,
        recommendation: qualification.recommendation
      }
    });
    const decision = await this.promotionDecisionLog.record({
      routeClass: routeClassId,
      scopePromoted: qualification.routeClassId === "PAIR_PM_LIMITLESS" ? "safe_exact_subset_only" : "btc_exact_slice_only",
      evidence: policy.evidence,
      canaryReadiness: policy.canaryReadiness,
      operatorIdentity: requestedBy,
      previousRolloutState: qualification.currentStage,
      newRolloutState: QualificationStage.CANARY,
      rollbackReference: `revert:${routeClassId}:shadow_only`,
      metadata: {
        reason: reason ?? "pair route canary promotion",
        evidenceSnapshotStoredAt: policy.evidence.window.freshnessObservedAt,
        scopeLabel: qualification.routeClassId === "PAIR_PM_LIMITLESS" ? "safe_exact_subset_only" : "btc_exact_slice_only"
      }
    });
    return {
      qualification: await this.getPairRoute(routeClassId),
      event,
      decision
    };
  }

  public async demote(
    routeClassId: PairRouteClassId,
    targetStage: QualificationStage,
    requestedBy: string,
    reason: string
  ): Promise<{
    qualification: PairRouteQualification;
    event: PairRoutePromotionEvent;
  }> {
    const qualification = await this.getPairRoute(routeClassId);
    assertPairRouteDemotionAllowed(qualification, targetStage);
    const event = await this.recordStageChange({
      routeClassId,
      fromStage: qualification.currentStage,
      toStage: targetStage,
      reason,
      requestedBy,
      metadata: {
        readinessState: qualification.readinessState,
        recommendation: qualification.recommendation
      }
    });
    return {
      qualification: await this.getPairRoute(routeClassId),
      event
    };
  }

  public async revertShadowOnly(routeClassId: PairRouteClassId, requestedBy: string, reason: string) {
    return this.demote(routeClassId, QualificationStage.SHADOW, requestedBy, reason);
  }
}
