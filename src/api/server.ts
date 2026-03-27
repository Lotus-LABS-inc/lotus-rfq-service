import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Pool } from "pg";
import type { AppDb } from "../db/postgres.js";
import type { RedisClient } from "../db/redis.js";
import { createCanonicalMarketClient } from "../core/rfq-engine/canonical-market-client.js";
import { CreateRFQService } from "../core/rfq-engine/create-rfq-service.js";
import { InMemoryRFQEventEmitter } from "../core/rfq-engine/rfq-domain-events.js";
import { RFQSessionManager } from "../core/rfq-engine/rfq-session-manager.js";
import { RFQEventRepository } from "../db/repositories/rfq-event-repository.js";
import { LPKeyRepository } from "../db/repositories/lp-key-repository.js";
import { RFQQuoteRepository } from "../db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../db/repositories/rfq-session-repository.js";
import { RFQExecutionRepository } from "../db/repositories/rfq-execution-repository.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerRFQRoute } from "./routes/rfq.js";
import { registerResolutionRiskRoutes } from "./routes/resolution-risk.js";
import { createLPAuthMiddleware } from "../lp/lp-auth-middleware.js";
import { registerLPQuotesRoute } from "../lp/routes/lp-quotes-route.js";
import { ReceiveLPQuoteService } from "../lp/receive-lp-quote-service.js";
import { registerWebSocketPlugin } from "../ws/plugin.js";
import type { RFQDomainEvent } from "../core/rfq-engine/rfq-domain-events.js";
import { LPStatsRepository } from "../repositories/lp-stats.repository.js";
import fastifyJwt from "@fastify/jwt";
import {
  createUserAuthMiddleware,
  createAdminAuthMiddleware,
  createAdminSimulationPreviewMiddleware
} from "./user-auth-middleware.js";
import { ExposureRepository } from "../repositories/exposure.repository.js";
import { ExposureRedisCache } from "../repositories/exposure-redis-cache.js";
import { RiskEngine } from "../core/risk-engine.js";
import { registerAdminRiskRoutes } from "./admin/risk.routes.js";
import { ComboRepository } from "../repositories/combo.repository.js";
import { registerAdminComboRoutes } from "./admin/combo.routes.js";
import { registerAdminSORRoutes } from "./admin/sor.routes.js";
import { SORAdminService } from "./admin/sor-admin-service.js";
import { registerAdminInternalCrossRoutes } from "./admin/internal-cross.routes.js";
import { InternalCrossAdminService } from "./admin/internal-cross-admin-service.js";
import { registerAdminInternalNettingRoutes } from "./admin/internal-netting.routes.js";
import { InternalNettingAdminService } from "./admin/internal-netting-admin-service.js";
import { registerAdminInternalClearingRoutes } from "./admin/internal-clearing.routes.js";
import { InternalClearingAdminService } from "./admin/internal-clearing-admin-service.js";
import { registerAdminResolutionRiskRoutes } from "./admin/resolution-risk.routes.js";
import { ResolutionRiskAdminService } from "./admin/resolution-risk-admin-service.js";
import { registerAdminControlPlaneRoutes } from "./admin/control-plane.routes.js";
import { ControlPlaneAdminService } from "./admin/control-plane-admin-service.js";
import { registerAdminReplayRoutes } from "./admin/replay.routes.js";
import { ReplayAdminService } from "./admin/replay-admin-service.js";
import { registerAdminCompatibilityReviewRoutes } from "./admin/compatibility-review.routes.js";
import { registerAdminQualificationRoutes } from "./admin/qualification.routes.js";
import { QualificationAdminService, createDefaultPromotionGateConfig } from "./admin/qualification-admin-service.js";
import { registerAdminQualificationSafetyRoutes } from "./admin/qualification-safety.routes.js";
import { QualificationSafetyAdminService } from "./admin/qualification-safety-admin-service.js";
import { registerAdminSimulationRoutes } from "./admin/simulation.routes.js";
import { registerAdminSimulationConsoleRoutes } from "./admin/simulation-console.routes.js";
import { SimulationAdminService } from "./admin/simulation-admin-service.js";
import { HistoricalSimulationCatalogService } from "./admin/historical-simulation-catalog-service.js";
import { PromotionGateEvaluator } from "../core/qualification/promotion-gate-evaluator.js";
import { EconomicQualityEngine } from "../core/qualification/economic-quality-engine.js";
import { QualificationRunManager } from "../core/qualification/qualification-run-manager.js";
import { ShadowQualificationEvaluator } from "../core/qualification/shadow-qualification-evaluator.js";
import { AutoSafetyActionEngine, createDefaultAutoSafetyActionConfig } from "../core/qualification/auto-safety-action-engine.js";
import {
  QualificationRuntimeHook,
  type QualificationRuntimeConfig
} from "../core/qualification/runtime-qualification-hook.js";
import { ExternalOnlyBaselineBuilder } from "../core/qualification/baselines/external-only-baseline.js";
import { NoInternalizationBaselineBuilder } from "../core/qualification/baselines/no-internalization-baseline.js";
import { NoResolutionRiskBaselineBuilder } from "../core/qualification/baselines/no-resolution-risk-baseline.js";
import { CostModel, OrderRouter, PlanComposer, PlanRunner, RouteScout, Splitter, type SORAcceptancePolicy, type CanonicalRFQInput } from "../core/sor/index.js";
import {
  compareShadowDecisions,
  isCanarySampled,
  isCanaryWindowActive,
  type ShadowMode
} from "../core/sor/canary-shadow.js";
import { RFQStateMachine, type RFQState } from "../core/rfq-engine/rfq-state-machine.js";
import { rankQuotesByEffectiveCost } from "../core/ranking/quote-ranking.js";
import { ExecutionRouterService } from "../core/execution-router/execution-router.js";
import {
  sorEnabledState,
  sorShadowDivergenceTotal,
  sorShadowMatchTotal,
  sorShadowPriceDeltaBps,
  sorShadowTotal
} from "../observability/metrics.js";
import { withSpan } from "../observability/tracing.js";
import { InternalCrossingEngine } from "../core/internal-engine/engine.js";
import { OrderBook } from "../core/internal-engine/order-book.js";
import { OrderLocker } from "../core/internal-engine/locker.js";
import { isInternalCrossKillSwitchActive } from "../core/internal-engine/runtime-controls.js";
import { ResolutionPairComparator } from "../core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../core/rfq-engine/resolution-risk-scoring-engine.js";
import { ResolutionRiskAssessmentService } from "../core/rfq-engine/resolution-risk-assessment-service.js";
import { ResolutionRiskReadService } from "../core/rfq-engine/resolution-risk-read-service.js";
import { ResolutionRiskEligibilityService } from "../core/rfq-engine/resolution-risk-eligibility-service.js";
import { ResolutionRiskGroupingService } from "../core/rfq-engine/resolution-risk-grouping-service.js";
import { ResolutionRiskPolicyService } from "../core/rfq-engine/resolution-risk-policy-service.js";
import type { NormalizedResolutionProfile } from "../core/rfq-engine/resolution-risk.types.js";
import { ReplayEnvelopeWriter } from "../core/replay/replay-envelope-writer.js";
import { ReplayDecisionCaptureService } from "../core/replay/replay-decision-capture-service.js";
import { ExactReplayRunner } from "../core/replay/exact-replay-runner.js";
import { DiffReplayRunner } from "../core/replay/diff-replay-runner.js";
import {
  createPerformanceGuardrailConfig,
  type PerformanceGuardrailConfig
} from "../guardrails/guardrail-config.js";
import { GuardrailEvaluator } from "../guardrails/guardrail-evaluator.js";
import { DegradationManager } from "../guardrails/degradation-manager.js";
import { Phase3AGuardrailShadowResolver } from "../guardrails/phase3a-guardrail-shadow.js";
import { OverlapGraphBuilder } from "../core/combo-engine/overlap-graph-builder.js";
import { CandidateGroupEnumerator } from "../core/combo-engine/candidate-group-enumerator.js";
import { ClearingCompressionScorer } from "../core/combo-engine/clearing-compression-scorer.js";
import { HistoricalSimulationRunner } from "../simulation/historical-simulation-runner.js";
import { PolymarketOnlyBaselineEvaluator } from "../simulation/baselines/polymarket-only-baseline.js";
import { LimitlessOnlyBaselineEvaluator } from "../simulation/baselines/limitless-only-baseline.js";
import { BestExternalOnlyBaselineEvaluator } from "../simulation/baselines/best-external-only-baseline.js";
import { NoInternalizationBaselineEvaluator } from "../simulation/baselines/no-internalization-baseline.js";
import { OpinionOnlyBaselineEvaluator } from "../simulation/baselines/opinion-only-baseline.js";
import { MyriadOnlyBaselineEvaluator } from "../simulation/baselines/myriad-only-baseline.js";
import { PredictOnlyBaselineEvaluator } from "../simulation/baselines/predict-only-baseline.js";
import { createDefaultHistoricalLotusEvaluators } from "../simulation/default-historical-lotus-evaluators.js";
import { CanonicalCompatibilityRepository } from "../repositories/canonical-compatibility.repository.js";
import { CompatibilityOverrideRepository } from "../repositories/compatibility-override.repository.js";
import { ExecutionIntentRepository } from "../repositories/execution-intent.repository.js";
import { ExecutionRecordRepository } from "../repositories/execution-record.repository.js";
import { CompatibilityOverrideService } from "../canonical/compatibility-override-service.js";
import { RouteSelectionTraceWriter } from "../routing/route-selection-trace.js";
import { ExecutionStateMachine } from "../execution/execution-state-machine.js";
import type { ExecutionState } from "../execution/execution-state-types.js";
import type { ExecutionIntent } from "../execution/execution-intent.js";
import type { ExecutionRecord } from "../execution/execution-record.js";
import { FailureRecoveryManager } from "../execution/failure-recovery-manager.js";
import { selectRecoveryPolicy } from "../execution/recovery-policies.js";

export interface ServerDependencies {
  logger: Logger;
  redisClient: RedisClient;
  pgPool: Pool;
  db: AppDb;
  canonicalServiceBaseUrl: string;
  jwtSecret: string;
  devSimulationPreviewEnabled?: boolean;
  sorEnabled?: boolean;
  sorCanaryShadowEnabled?: boolean;
  sorCanaryPercent?: number;
  sorCanaryStartAt?: string;
  sorCanaryEndAt?: string;
  internalCrossEnabled?: boolean;
  internalCrossShadowEnabled?: boolean;
  internalCrossShadowPercent?: number;
  internalCrossShadowStartAt?: string;
  internalCrossShadowEndAt?: string;
  internalNettingEnabled?: boolean;
  internalNettingShadowEnabled?: boolean;
  internalNettingShadowPercent?: number;
  internalNettingShadowStartAt?: string;
  internalNettingShadowEndAt?: string;
  internalNettingCanaryEnabled?: boolean;
  internalNettingCanaryPercent?: number;
  internalNettingCanaryStartAt?: string;
  internalNettingCanaryEndAt?: string;
  internalClearingEnabled?: boolean;
  internalClearingShadowEnabled?: boolean;
  internalClearingShadowPercent?: number;
  internalClearingShadowStartAt?: string;
  internalClearingShadowEndAt?: string;
  internalClearingCanaryEnabled?: boolean;
  internalClearingCanaryPercent?: number;
  internalClearingCanaryStartAt?: string;
  internalClearingCanaryEndAt?: string;
  resolutionRiskEnabled?: boolean;
  resolutionRiskShadowEnabled?: boolean;
  resolutionRiskShadowPercent?: number;
  resolutionRiskShadowStartAt?: string;
  resolutionRiskShadowEndAt?: string;
  phase3AGuardrailShadowEnabled?: boolean;
  phase3AGuardrailShadowPercent?: number;
  phase3AGuardrailShadowStartAt?: string;
  phase3AGuardrailShadowEndAt?: string;
  reliabilityWeight: number;
  latencyWeight: number;
  failureWeight: number;
  sorResolutionRiskPenalty?: number;
  sorAcceptAonAwait: boolean;
  sorAcceptNonAonBackground: boolean;
  performanceGuardrailConfig?: PerformanceGuardrailConfig;
  qualificationRuntimeConfig?: QualificationRuntimeConfig;
}

export const buildServer = async (dependencies: ServerDependencies): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false
  });
  const sorEnabled = dependencies.sorEnabled ?? false;
  const sorCanaryShadowEnabled = dependencies.sorCanaryShadowEnabled ?? false;
  const sorCanaryPercent = dependencies.sorCanaryPercent ?? 0;
  const internalCrossEnabled = dependencies.internalCrossEnabled ?? false;

  await app.register(fastifyJwt, {
    secret: dependencies.jwtSecret
  });

  app.decorate("infraLogger", dependencies.logger);
  const domainEventEmitter = new InMemoryRFQEventEmitter();
  const sessionRepository = new RFQSessionRepository(dependencies.pgPool);
  const eventRepository = new RFQEventRepository(dependencies.pgPool);
  const quoteRepository = new RFQQuoteRepository(dependencies.pgPool);
  const executionRepository = new RFQExecutionRepository(dependencies.pgPool);
  const lpKeyRepository = new LPKeyRepository(dependencies.pgPool);
  const lpStatsRepository = new LPStatsRepository(dependencies.pgPool, dependencies.logger);
  const sessionManager = new RFQSessionManager({
    redis: dependencies.redisClient
  });

  const exposureRepository = new ExposureRepository(dependencies.pgPool, dependencies.logger);
  const exposureCache = new ExposureRedisCache(dependencies.redisClient);
  const comboRepository = new ComboRepository(dependencies.pgPool);
  const riskEngine = new RiskEngine(
    exposureRepository,
    exposureCache,
    createCanonicalMarketClient({ baseUrl: dependencies.canonicalServiceBaseUrl }),
    dependencies.pgPool,
    {
      userNotionalCap: Number(process.env.RISK_USER_NOTIONAL_CAP || "1000000"),
      marketNotionalCap: Number(process.env.RISK_MARKET_NOTIONAL_CAP || "10000000"),
      lpNotionalCap: Number(process.env.RISK_LP_NOTIONAL_CAP || "5000000"),
      globalNotionalCap: Number(process.env.RISK_GLOBAL_NOTIONAL_CAP || "50000000"),
      maxOrderNotional: Number(process.env.RISK_MAX_ORDER_NOTIONAL || "500000"),
    },
    dependencies.logger
  );

  const replayDecisionCaptureService = new ReplayDecisionCaptureService(
    new ReplayEnvelopeWriter({ pool: dependencies.pgPool }),
    dependencies.logger
  );
  const canonicalCompatibilityRepository = new CanonicalCompatibilityRepository(dependencies.pgPool);
  const compatibilityOverrideRepository = new CompatibilityOverrideRepository(dependencies.pgPool);
  const compatibilityOverrideService = new CompatibilityOverrideService(
    canonicalCompatibilityRepository,
    compatibilityOverrideRepository
  );
  const routeSelectionTraceWriter = new RouteSelectionTraceWriter(dependencies.pgPool);
  const executionIntentRepository = new ExecutionIntentRepository(dependencies.pgPool);
  const executionRecordRepository = new ExecutionRecordRepository(dependencies.pgPool);
  const failureRecoveryManager = new FailureRecoveryManager(dependencies.pgPool);
  const qualificationRuntimeConfig = dependencies.qualificationRuntimeConfig ?? { enabled: false };
  const qualificationRunManager = new QualificationRunManager({
    pool: dependencies.pgPool,
    logger: dependencies.logger
  });
  const shadowQualificationEvaluator = new ShadowQualificationEvaluator({
    qualificationRunManager,
    economicQualityEngine: new EconomicQualityEngine(),
    externalOnlyBaselineBuilder: new ExternalOnlyBaselineBuilder(),
    noInternalizationBaselineBuilder: new NoInternalizationBaselineBuilder(),
    noResolutionRiskBaselineBuilder: new NoResolutionRiskBaselineBuilder(),
    logger: dependencies.logger
  });
  const qualificationHook = qualificationRuntimeConfig.enabled
    ? new QualificationRuntimeHook({
        qualificationRunManager,
        shadowQualificationEvaluator,
        logger: dependencies.logger
      })
    : undefined;
  const performanceGuardrailConfig =
    dependencies.performanceGuardrailConfig ??
    createPerformanceGuardrailConfig({
      version: "performance-guardrails-v1",
      maxSorPlanningLatencyMs: 250,
      maxNettingPlanningLatencyMs: 250,
      maxClearingPlanningLatencyMs: 250,
      maxBucketEntityCount: 500,
      maxGraphEdges: 5000,
      maxCandidateGroups: 1000,
      maxLockWaitMs: 3000,
      maxLockHoldMs: 5000,
      maxReplayWriteFailuresBeforeDegrade: 25,
      degradationPolicyVersion: "degradation-policy-v1"
    });
  const guardrailEvaluator = new GuardrailEvaluator();
  const degradationManager = new DegradationManager({
    pool: dependencies.pgPool,
    logger: dependencies.logger
  });
  const phase3AGuardrailShadowResolver = new Phase3AGuardrailShadowResolver({
    pool: dependencies.pgPool,
    config: {
      enabled: dependencies.phase3AGuardrailShadowEnabled ?? false,
      percent: dependencies.phase3AGuardrailShadowPercent ?? 0,
      ...(dependencies.phase3AGuardrailShadowStartAt
        ? { startAt: dependencies.phase3AGuardrailShadowStartAt }
        : {}),
      ...(dependencies.phase3AGuardrailShadowEndAt
        ? { endAt: dependencies.phase3AGuardrailShadowEndAt }
        : {}),
    },
  });
  const replayWriteFailureStatsSource = {
    getReplayWriteFailures: () => replayDecisionCaptureService.getTotalFailureCount()
  };
  const resolutionRiskAssessmentService = new ResolutionRiskAssessmentService({
    replayDecisionCaptureService,
    pool: dependencies.pgPool,
    comparator: new ResolutionPairComparator(),
    scoringEngine: new ResolutionRiskScoringEngine(),
    logger: dependencies.logger,
    config: {
      version: "resolution-risk-v1"
    },
    replayCaptureConfig: {
      mode: "BEST_EFFORT",
      configVersion: "replay-capture-v1",
      engineVersion: "resolution-risk-assessment-service-v1",
      featureFlags: {}
    }
  });
  const resolutionRiskReadService = new ResolutionRiskReadService({
    pool: dependencies.pgPool,
    version: "resolution-risk-v1"
  });
  const resolutionRiskPolicyService = new ResolutionRiskPolicyService({
    enabled: dependencies.resolutionRiskEnabled ?? false,
    shadowEnabled: dependencies.resolutionRiskShadowEnabled ?? false,
    shadowPercent: dependencies.resolutionRiskShadowPercent ?? 0,
    ...(dependencies.resolutionRiskShadowStartAt ? { shadowStartAt: dependencies.resolutionRiskShadowStartAt } : {}),
    ...(dependencies.resolutionRiskShadowEndAt ? { shadowEndAt: dependencies.resolutionRiskShadowEndAt } : {}),
    logger: dependencies.logger,
    ...(qualificationHook ? { qualificationHook } : {}),
    ...(qualificationRuntimeConfig.resolutionRisk
      ? { qualificationConfig: qualificationRuntimeConfig.resolutionRisk }
      : {})
  });
  const resolutionRiskEligibilityService = new ResolutionRiskEligibilityService({
    readService: resolutionRiskReadService,
    policyService: resolutionRiskPolicyService
  });
  const resolutionRiskGroupingService = new ResolutionRiskGroupingService({
    pool: dependencies.pgPool,
    readService: resolutionRiskReadService,
    logger: dependencies.logger
  });
  const createRFQService = new CreateRFQService({
    sessionRepository,
    eventRepository,
    sessionManager,
    canonicalMarketClient: createCanonicalMarketClient({
      baseUrl: dependencies.canonicalServiceBaseUrl
    }),
    eventEmitter: domainEventEmitter,
    logger: dependencies.logger,
    riskEngine,
    resolutionRiskGroupingService,
    resolutionRiskPolicyService,
    replayDecisionCaptureService,
    replayCaptureConfig: {
      mode: "BEST_EFFORT",
      configVersion: "replay-capture-v1",
      engineVersion: "rfq-grouping-v1",
      featureFlags: {}
    },
    ...(qualificationHook ? { qualificationHook } : {}),
    ...(qualificationRuntimeConfig.rfqGrouping
      ? { qualificationConfig: qualificationRuntimeConfig.rfqGrouping }
      : {})
  });
  const lpAuthMiddleware = createLPAuthMiddleware({
    redisClient: dependencies.redisClient,
    lpKeyRepository,
    logger: dependencies.logger
  });
  const userAuthMiddleware = createUserAuthMiddleware();
  const receiveLPQuoteService = new ReceiveLPQuoteService({
    sessionRepository,
    quoteRepository,
    eventRepository,
    sessionManager,
    redisClient: dependencies.redisClient,
    eventEmitter: domainEventEmitter,
    lpStatsRepository,
    logger: dependencies.logger
  });

  const sorRouteScout = new RouteScout({
    redis: dependencies.redisClient,
    lpSource: {
      getWholeComboQuotes: async () => [],
      getPerLegQuotes: async (rfq) => {
        const dbQuotes = await quoteRepository.listBySessionId(rfq.rfqId, 50);
        return dbQuotes.map((quote) => ({
          quoteId: String(quote.quote_payload.quoteId ?? quote.id),
          providerId:
            typeof quote.quote_payload.lpId === "string"
              ? quote.quote_payload.lpId
              : quote.lp_key_id,
          providerType: "LP" as const,
          legId: rfq.rfqId,
          availableSize: Number.parseFloat(quote.quantity),
          quotedPrice: Number.parseFloat(quote.price),
          fees: {
            provider_fee: quote.fee_bps / 10000
          },
          latencyMs: 0,
          fillProb: 0.95,
          metadata: {
            quote_status: quote.quote_status
          }
        }));
      }
    },
    canonicalClient: {
      getOrderbookSnapshot: async () => null
    }
  });
  const internalOrderBook = new OrderBook(dependencies.redisClient);
  const internalOrderLocker = new OrderLocker(dependencies.redisClient);
  const internalEngine = new InternalCrossingEngine(
    dependencies.pgPool,
    internalOrderBook,
    internalOrderLocker,
    dependencies.logger,
    resolutionRiskEligibilityService,
    replayDecisionCaptureService,
    {
      mode: "BEST_EFFORT",
      configVersion: "replay-capture-v1",
      engineVersion: "internal-cross-v1",
      featureFlags: {}
    },
    qualificationHook,
    qualificationRuntimeConfig.phase1InternalCross
  );
  const orderRouter = new OrderRouter({
    routeScout: sorRouteScout,
    costModel: new CostModel(),
    splitter: new Splitter(),
    planComposer: new PlanComposer({
      pool: dependencies.pgPool,
      logger: dependencies.logger
    }),
    internalEngine,
    logger: dependencies.logger,
    internalCrossingEnabled: internalCrossEnabled,
    ...(dependencies.internalCrossShadowEnabled !== undefined
      ? { internalCrossingShadowEnabled: dependencies.internalCrossShadowEnabled }
      : {}),
    ...(dependencies.internalCrossShadowPercent !== undefined
      ? { internalCrossingShadowPercent: dependencies.internalCrossShadowPercent }
      : {}),
    ...(dependencies.internalCrossShadowStartAt ? { internalCrossingShadowStartAt: dependencies.internalCrossShadowStartAt } : {}),
    ...(dependencies.internalCrossShadowEndAt ? { internalCrossingShadowEndAt: dependencies.internalCrossShadowEndAt } : {}),
    isKillSwitchActive: async () => isInternalCrossKillSwitchActive(dependencies.redisClient),
    resolutionRiskReadService,
    resolutionRiskPolicyService,
    ...(dependencies.sorResolutionRiskPenalty !== undefined
      ? { resolutionRiskPenalty: dependencies.sorResolutionRiskPenalty }
      : {}),
    replayDecisionCaptureService,
    compatibilityOverrideService,
    routeSelectionTraceWriter,
    replayCaptureConfig: {
      mode: "BEST_EFFORT",
      configVersion: "replay-capture-v1",
      engineVersion: "sor-plan-v1",
      featureFlags: {}
    },
    guardrailConfig: performanceGuardrailConfig,
    guardrailEvaluator,
    degradationManager,
    replayWriteFailureStatsSource,
    controlPlaneShardId: "sor-main",
    phase3AGuardrailShadowResolver,
    ...(qualificationHook ? { qualificationHook } : {}),
    ...(qualificationRuntimeConfig.sor ? { qualificationConfig: qualificationRuntimeConfig.sor } : {})
  });

  const sorExecutionRouter = {
    executeStep: async () => ({
      ok: true as const,
      executionRef: `sor-exec-${Date.now()}`
    })
  };

  const planRunner = new PlanRunner({
    pool: dependencies.pgPool,
    redis: dependencies.redisClient,
    executionRouter: sorExecutionRouter,
    riskEngine,
    logger: dependencies.logger
  });
  sorEnabledState.set(sorEnabled ? 1 : 0);

  const legacyExecutionRouter = new ExecutionRouterService({
    sessionRepository,
    quoteRepository,
    executionRepository,
    sessionManager,
    executionGateway: {
      execute: async () => ({
        ok: true as const,
        venueExecutionRef: `legacy-exec-${Date.now()}`
      })
    },
    eventEmitter: domainEventEmitter,
    logger: dependencies.logger,
    lpStatsRepository,
    riskEngine
  });

  const transitionRFQState = async (
    sessionId: string,
    targetState: RFQState,
    reason: string
  ): Promise<void> => {
    const session = await sessionRepository.findById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found for transition.`);
    }

    const current = asRFQState(session.status);
    if (!current) {
      throw new Error(`Unknown RFQ state ${session.status} for session ${sessionId}.`);
    }
    if (current === targetState) {
      return;
    }

    const stateMachine = new RFQStateMachine({
      initialState: current,
      logger: dependencies.logger
    });
    if (!stateMachine.canTransitionTo(targetState)) {
      throw new Error(`Invalid RFQ transition ${current} -> ${targetState}`);
    }

    const next = stateMachine.transitionTo(targetState, {
      reason,
      metadata: { sessionId }
    });
    await sessionRepository.updateStatus(sessionId, next);
    domainEventEmitter.emitEvent({
      type: "STATE_TRANSITION",
      sessionId,
      occurredAt: new Date().toISOString(),
      payload: {
        from: current,
        to: next
      }
    });
  };

  const wsGateway = await registerWebSocketPlugin(app, {
    redisClient: dependencies.redisClient,
    logger: dependencies.logger
  });
  await registerHealthRoute(app);
  await registerMetricsRoute(app);
  await registerResolutionRiskRoutes(app, {
    buildAssessmentsForCanonicalEvent: (canonicalEventId) =>
      resolutionRiskAssessmentService.buildAssessmentsForCanonicalEvent(canonicalEventId),
    comparePair: (profileAId, profileBId) =>
      resolutionRiskAssessmentService.comparePair(profileAId, profileBId),
    resolveProfileByVenueMarket: async (venue, marketId) =>
      findResolutionProfileByVenueMarket(dependencies.pgPool, venue, marketId)
  });
  await registerRFQRoute(app, userAuthMiddleware, {
    createRFQ: (request) =>
      createRFQService.execute(request, {
        weights: {
          reliabilityWeight: dependencies.reliabilityWeight,
          latencyWeight: dependencies.latencyWeight,
          failureWeight: dependencies.failureWeight
        }
      }),
    acceptRFQ: async (sessionId, request) => {
      const session = await sessionRepository.findById(sessionId);
      if (!session) throw new Error("Session not found");

      const quote = await quoteRepository.findByExternalQuoteId(sessionId, request.quoteId);
      if (!quote) throw new Error("Quote not found");

      const acceptancePolicy = readAcceptancePolicy(session.metadata);

      const reservationToken = await riskEngine.validateBeforeExecution(session, quote);

      const rfqInput: CanonicalRFQInput = {
        rfqId: session.id,
        idempotencyKey: session.idempotency_key,
        quantity: session.quantity,
        side: session.side,
        canonicalMarketId: session.canonical_market_id,
        stpMode: (session.metadata as any)?.stp_mode ?? "CANCEL_NEWEST",
        takerId: session.taker_id,
        metadata: {
          reservation_token: reservationToken,
          legs: [
            {
              leg_id: "00000000-0000-0000-0000-000000000000",
              symbol: session.canonical_market_id,
              target_quantity: session.quantity
            }
          ]
        }
      };
      const selectedQuoteInput = {
        quoteId: request.quoteId,
        ...(typeof quote.quote_payload.lpId === "string"
          ? { lpId: quote.quote_payload.lpId }
          : {}),
        price: Number.parseFloat(quote.price),
        quantity: Number.parseFloat(session.quantity),
        feeBps: quote.fee_bps,
        validUntil: quote.valid_until.toISOString(),
        payload: quote.quote_payload
      } as const;
      const requestedNotional = (
        Number.parseFloat(session.quantity) * Number.parseFloat(quote.price)
      ).toFixed(8);
      const executionReplayConfig = {
        mode: "BEST_EFFORT" as const,
        configVersion: "replay-capture-v1",
        engineVersion: "execution-infra-v1",
        featureFlags: {
          compatibilityExecutionInfra: true
        }
      };
      const captureOperationalReplay = async (
        decisionType: "EXECUTION_STATE_TRANSITION" | "FAILURE_RECOVERY_DECISION",
        entityId: string,
        inputSnapshot: Record<string, unknown>,
        decisionTrace: Record<string, unknown>,
        outputSnapshot: Record<string, unknown>
      ) => {
        if (!replayDecisionCaptureService) {
          return null;
        }

        return replayDecisionCaptureService.capture({
          config: executionReplayConfig,
          buildEnvelope: (config) => ({
            decisionType,
            entityId,
            correlationId: sessionId,
            configVersion: config.configVersion,
            engineVersion: config.engineVersion,
            featureFlags: config.featureFlags,
            inputSnapshot,
            decisionTrace,
            outputSnapshot
          })
        });
      };
      const createExecutionAuditContext = async (input: {
        routeType: string;
        routePlanId?: string | null;
        routeSelectionTraceId?: string | null;
        compatibilityDecisionIds?: readonly string[];
        compatibilityVersionIds?: readonly string[];
        replayEnvelopeId?: string | null;
        intendedVenues: readonly string[];
        executionVenue: string;
        providerExecutionKey: string;
        metadata?: Record<string, unknown>;
      }): Promise<{
        intent: ExecutionIntent;
        getRecord: () => ExecutionRecord;
        transition: (
          nextState: ExecutionState,
          reason: string,
          options?: {
            payload?: Record<string, unknown>;
            syncStatus?: string;
            settlementStatus?: string;
            fillDetails?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
          }
        ) => Promise<ExecutionRecord>;
        recordRecovery: (flags?: {
          quoteExpired?: boolean;
          localSyncFailed?: boolean;
          duplicateSubmissionRisk?: boolean;
        }) => Promise<void>;
      }> => {
        const intent = await executionIntentRepository.create({
          requestKey: `${session.idempotency_key}:${input.routeType}`,
          routePlanId: input.routePlanId ?? null,
          routeSelectionTraceId: input.routeSelectionTraceId ?? null,
          initiatingPrincipal: session.taker_id,
          requestedAction: session.side.toUpperCase(),
          requestedNotional,
          requestedSize: session.quantity,
          routeType: input.routeType,
          approvalState: "APPROVED",
          intendedVenues: input.intendedVenues,
          compatibilityDecisionIds: input.compatibilityDecisionIds ?? [],
          compatibilityVersionIds: input.compatibilityVersionIds ?? [],
          replayEnvelopeId: input.replayEnvelopeId ?? null,
          metadata: {
            sessionId,
            quoteId: request.quoteId,
            canonicalMarketId: session.canonical_market_id,
            ...(input.metadata ?? {})
          }
        });

        let record = await executionRecordRepository.create({
          executionIntentId: intent.id,
          venue: input.executionVenue,
          executionState: "CREATED",
          syncStatus: "pending",
          settlementStatus: "pending",
          providerExecutionKey: input.providerExecutionKey,
          replayEnvelopeId: input.replayEnvelopeId ?? null,
          metadata: {
            routeSelectionTraceId: input.routeSelectionTraceId ?? null,
            routePlanId: input.routePlanId ?? null,
            compatibilityDecisionIds: input.compatibilityDecisionIds ?? [],
            compatibilityVersionIds: input.compatibilityVersionIds ?? [],
            ...(input.metadata ?? {})
          }
        });
        const stateMachine = new ExecutionStateMachine();

        const transition = async (
          nextState: ExecutionState,
          reason: string,
          options: {
            payload?: Record<string, unknown>;
            syncStatus?: string;
            settlementStatus?: string;
            fillDetails?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
          } = {}
        ): Promise<ExecutionRecord> => {
          const fromState = stateMachine.getState();
          stateMachine.transitionTo(nextState, {
            reason,
            ...(options.payload ? { payload: options.payload } : {})
          });

          const nextSyncStatus = options.syncStatus ?? record.syncStatus;
          const nextSettlementStatus = options.settlementStatus ?? record.settlementStatus;
          const nextFillDetails = options.fillDetails ?? (record.fillDetails as Record<string, unknown>);
          const nextMetadata = {
            ...(record.metadata as Record<string, unknown>),
            ...(options.metadata ?? {})
          };
          const transitionReplay = await captureOperationalReplay(
            "EXECUTION_STATE_TRANSITION",
            record.id,
            {
              executionIntentId: intent.id,
              executionRecordId: record.id,
              routePlanId: intent.routePlanId,
              routeSelectionTraceId: intent.routeSelectionTraceId,
              compatibilityDecisionIds: intent.compatibilityDecisionIds,
              compatibilityVersionIds: intent.compatibilityVersionIds,
              replayEnvelopeId: record.replayEnvelopeId
            },
            {
              fromState,
              toState: nextState,
              reason,
              payload: options.payload ?? {}
            },
            {
              executionState: nextState,
              syncStatus: nextSyncStatus,
              settlementStatus: nextSettlementStatus,
              fillDetails: nextFillDetails
            }
          );

          if (
            fromState !== null ||
            record.executionState !== nextState ||
            nextSyncStatus !== record.syncStatus ||
            nextSettlementStatus !== record.settlementStatus ||
            nextFillDetails !== record.fillDetails ||
            nextMetadata !== record.metadata
          ) {
            record = await executionRecordRepository.create({
              executionIntentId: intent.id,
              venue: record.venue,
              venueExecutionRef: record.venueExecutionRef,
              executionState: nextState,
              syncStatus: nextSyncStatus,
              settlementStatus: nextSettlementStatus,
              fillDetails: nextFillDetails,
              retryLineage: record.retryLineage,
              providerExecutionKey: record.providerExecutionKey,
              replayEnvelopeId: transitionReplay?.id ?? record.replayEnvelopeId,
              metadata: nextMetadata
            });
          }

          await executionRecordRepository.appendStateTransition(
            record.id,
            fromState,
            nextState,
            {
              reason,
              ...(options.payload ? { payload: options.payload } : {})
            },
            transitionReplay?.id ?? null
          );

          return record;
        };

        const recordRecovery = async (flags: {
          quoteExpired?: boolean;
          localSyncFailed?: boolean;
          duplicateSubmissionRisk?: boolean;
        } = {}): Promise<void> => {
          const policy = selectRecoveryPolicy({
            intent,
            record,
            ...(flags.quoteExpired !== undefined ? { quoteExpired: flags.quoteExpired } : {}),
            ...(flags.localSyncFailed !== undefined ? { localSyncFailed: flags.localSyncFailed } : {}),
            ...(flags.duplicateSubmissionRisk !== undefined
              ? { duplicateSubmissionRisk: flags.duplicateSubmissionRisk }
              : {})
          });
          const recoveryReplay = await captureOperationalReplay(
            "FAILURE_RECOVERY_DECISION",
            record.id,
            {
              executionIntentId: intent.id,
              executionRecordId: record.id,
              routePlanId: intent.routePlanId,
              routeSelectionTraceId: intent.routeSelectionTraceId,
              compatibilityDecisionIds: intent.compatibilityDecisionIds,
              compatibilityVersionIds: intent.compatibilityVersionIds
            },
            {
              currentState: record.executionState,
              flags
            },
            {
              policyName: policy.policyName,
              actionType: policy.actionType,
              safeToAutoApply: policy.safeToAutoApply,
              rationale: policy.rationale,
              syncStatus: record.syncStatus,
              settlementStatus: record.settlementStatus
            }
          );

          await failureRecoveryManager.recordRecoveryAction({
            intent,
            record,
            replayEnvelopeId: recoveryReplay?.id ?? null,
            ...(flags.quoteExpired !== undefined ? { quoteExpired: flags.quoteExpired } : {}),
            ...(flags.localSyncFailed !== undefined ? { localSyncFailed: flags.localSyncFailed } : {}),
            ...(flags.duplicateSubmissionRisk !== undefined
              ? { duplicateSubmissionRisk: flags.duplicateSubmissionRisk }
              : {})
          });
        };

        await transition("CREATED", "execution_intent_created", {
          payload: {
            routeType: input.routeType
          }
        });

        return {
          intent,
          getRecord: () => record,
          transition,
          recordRecovery
        };
      };

      let buildResult;
      try {
        buildResult = await orderRouter.buildPlan(rfqInput, selectedQuoteInput, acceptancePolicy);
      } catch (error) {
        if (riskEngine.rollbackReservation) {
          await riskEngine.rollbackReservation(reservationToken).catch((rollbackError: unknown) => {
            dependencies.logger.error(
              { err: rollbackError, sessionId, reservationToken },
              "Failed to rollback risk reservation after internal-cross/SOR build failure."
            );
          });
        }
        throw error;
      }

      if (buildResult.kind === "internal_filled") {
        const executionAudit = await createExecutionAuditContext({
          routeType: "INTERNAL_CROSS",
          routePlanId: null,
          routeSelectionTraceId: buildResult.routeSelectionTraceId ?? null,
          compatibilityDecisionIds: buildResult.compatibilityDecisionIds ?? [],
          compatibilityVersionIds: buildResult.compatibilityVersionIds ?? [],
          replayEnvelopeId: buildResult.replayEnvelopeId ?? null,
          intendedVenues: ["INTERNAL_CROSS"],
          executionVenue: "INTERNAL_CROSS",
          providerExecutionKey: `internal:${sessionId}`,
          metadata: {
            crossingFilledSize: buildResult.filledSize
          }
        });
        await executionAudit.transition("CHECKED", "reservation_validated");
        await executionAudit.transition("QUOTED", "quote_selected");
        await executionAudit.transition("APPROVED", "internal_cross_ready");
        await executionAudit.transition("EXECUTING", "internal_cross_executing", {
          payload: {
            tradeCount: buildResult.trades.length
          }
        });
        await executionAudit.transition("FILLED", "internal_cross_filled", {
          fillDetails: {
            filledSize: buildResult.filledSize,
            trades: buildResult.trades
          },
          syncStatus: "synced"
        });
        await executionAudit.transition("SETTLED", "internal_cross_settled", {
          settlementStatus: "settled"
        });
        if (riskEngine.rollbackReservation) {
          await riskEngine.rollbackReservation(reservationToken);
        }
        await transitionRFQState(sessionId, "ACCEPTED", "internal_match_full");
        await transitionRFQState(sessionId, "SETTLED", "internal_match_full");
        return {
          status: "PLAN_ACCEPTED" as const,
          plan_id: `internal-${sessionId}`,
          plan_state: "COMPLETED" as const,
          dispatch_mode: "awaited" as const,
          final_status: "COMPLETED" as const
        };
      }

      const executeSORAccept = async () => {
        const plan = buildResult.plan;
        const executionAudit = await createExecutionAuditContext({
          routeType: "SOR_PLAN",
          routePlanId: plan.id,
          routeSelectionTraceId: buildResult.routeSelectionTraceId ?? null,
          compatibilityDecisionIds: buildResult.compatibilityDecisionIds ?? [],
          compatibilityVersionIds: buildResult.compatibilityVersionIds ?? [],
          replayEnvelopeId: buildResult.replayEnvelopeId ?? null,
          intendedVenues: [...new Set(plan.steps.map((step) => step.providerId))],
          executionVenue: plan.steps.length > 1 ? "MULTI_VENUE" : (plan.steps[0]?.providerType ?? "VENUE"),
          providerExecutionKey: `sor:${plan.id}`,
          metadata: {
            acceptancePolicy,
            stepCount: plan.steps.length
          }
        });
        await executionAudit.transition("CHECKED", "reservation_validated");
        await executionAudit.transition("QUOTED", "quote_selected");
        await executionAudit.transition("APPROVED", "sor_plan_ready", {
          payload: {
            routePlanId: plan.id,
            routeSelectionTraceId: buildResult.routeSelectionTraceId ?? null
          }
        });

        const runPlanAndTransition = async (): Promise<"COMPLETED" | "PARTIAL" | "FAILED" | "UNWOUND"> => {
          await transitionRFQState(sessionId, "ACCEPTED", "sor_plan_created");
          await transitionRFQState(sessionId, "EXECUTING", "sor_plan_running");
          await executionAudit.transition("EXECUTING", "sor_plan_running", {
            payload: {
              routePlanId: plan.id
            }
          });

          let result;
          try {
            result = await planRunner.run(plan);
          } catch (error) {
            await executionAudit.transition("SYNC_PENDING", "sor_plan_sync_ambiguous", {
              payload: {
                routePlanId: plan.id,
                error: error instanceof Error ? error.message : "unknown_error"
              },
              syncStatus: "sync_pending"
            });
            await executionAudit.recordRecovery({ localSyncFailed: true });
            await executionAudit.transition("RECONCILING", "manual_reconciliation_required", {
              payload: {
                routePlanId: plan.id
              }
            });
            throw error;
          }
          if (result.status === "COMPLETED" || result.status === "PARTIAL") {
            await transitionRFQState(sessionId, "SETTLED", "sor_plan_completed");
          } else {
            await transitionRFQState(sessionId, "FAILED", "sor_plan_failed");
          }

          if (result.status === "COMPLETED") {
            await executionAudit.transition("FILLED", "sor_plan_completed", {
              syncStatus: "synced",
              fillDetails: {
                planId: plan.id,
                status: result.status
              }
            });
            await executionAudit.transition("SETTLED", "sor_execution_settled", {
              settlementStatus: "settled"
            });
          } else if (result.status === "PARTIAL") {
            await executionAudit.transition("PARTIALLY_FILLED", "sor_plan_partially_filled", {
              syncStatus: "synced",
              fillDetails: {
                planId: plan.id,
                status: result.status
              }
            });
            await executionAudit.recordRecovery();
          } else {
            await executionAudit.transition("FAILED", "sor_plan_failed", {
              syncStatus: "synced",
              fillDetails: {
                planId: plan.id,
                status: result.status,
                ...(result.failureReason ? { failureReason: result.failureReason } : {})
              }
            });
            await executionAudit.recordRecovery();
          }
          return result.status;
        };

        const shouldAwait =
          acceptancePolicy === "ALL_OR_NONE"
            ? dependencies.sorAcceptAonAwait
            : !dependencies.sorAcceptNonAonBackground;

        if (shouldAwait) {
          const finalStatus = await runPlanAndTransition();
          return {
            status: "PLAN_ACCEPTED" as const,
            plan_id: plan.id,
            plan_state: "DRAFT" as const,
            dispatch_mode: "awaited" as const,
            final_status: finalStatus
          };
        }

        void runPlanAndTransition().catch((error: unknown) => {
          dependencies.logger.error(
            { err: error, sessionId, planId: plan.id },
            "Background SOR plan execution failed."
          );
        });

        return {
          status: "PLAN_ACCEPTED" as const,
          plan_id: plan.id,
          plan_state: "DRAFT" as const,
          dispatch_mode: "background" as const
        };
      };

      const executeLegacyAccept = async () => {
        const rawQuotes = await quoteRepository.listBySessionId(sessionId, 100);
        const rankedQuotes = rankQuotesByEffectiveCost(
          rawQuotes.map((row) => ({
            quoteId: String(row.quote_payload.quoteId ?? row.id),
            ...(typeof row.quote_payload.lpId === "string" ? { lpId: row.quote_payload.lpId } : {}),
            basePrice: Number.parseFloat(row.price),
            venueFee: row.fee_bps / 10000,
            protocolFee: 0,
            gasCost: 0,
            slippageEstimate: 0,
            reliabilityScore: 100,
            latencyScore: 100,
            expires_at: row.valid_until.toISOString(),
            soft_refresh_flag: false
          }))
        );
        const executionAudit = await createExecutionAuditContext({
          routeType: "LEGACY_EXECUTION",
          routePlanId: null,
          routeSelectionTraceId: null,
          compatibilityDecisionIds: [],
          compatibilityVersionIds: [],
          replayEnvelopeId: null,
          intendedVenues: rankedQuotes.flatMap((quote) => (quote.lpId ? [quote.lpId] : [])),
          executionVenue: "LEGACY_EXECUTION",
          providerExecutionKey: `legacy:${sessionId}`,
          metadata: {
            quoteCount: rankedQuotes.length
          }
        });
        await executionAudit.transition("CHECKED", "reservation_validated");
        await executionAudit.transition("QUOTED", "quote_selected");
        await executionAudit.transition("APPROVED", "legacy_execution_ready");

        await transitionRFQState(sessionId, "ACCEPTED", "legacy_execution_requested");
        await executionAudit.transition("EXECUTING", "legacy_execution_requested");
        const legacyResult = await legacyExecutionRouter.execute({
          sessionId,
          rankedQuotes,
          fallbackToNextQuote: true,
          reservationToken
        });

        if (legacyResult.ok) {
          await executionAudit.transition("FILLED", "legacy_execution_success", {
            syncStatus: "synced",
            fillDetails: {
              executedQuoteId: legacyResult.executedQuoteId ?? null
            }
          });
          await executionAudit.transition("SETTLED", "legacy_execution_settled", {
            settlementStatus: "settled"
          });
          await transitionRFQState(sessionId, "SETTLED", "legacy_execution_success");
          return {
            status: "PLAN_ACCEPTED" as const,
            plan_id: `legacy-${sessionId}`,
            plan_state: "LEGACY_EXECUTED" as const,
            dispatch_mode: "awaited" as const,
            final_status: "COMPLETED" as const
          };
        }

        await executionAudit.transition("FAILED", "legacy_execution_failed", {
          syncStatus: "synced",
          fillDetails: {
            attempts: legacyResult.attempts
          }
        });
        await executionAudit.recordRecovery();
        await transitionRFQState(sessionId, "FAILED", "legacy_execution_failed");
        return {
          status: "PLAN_ACCEPTED" as const,
          plan_id: `legacy-${sessionId}`,
          plan_state: "LEGACY_EXECUTED" as const,
          dispatch_mode: "awaited" as const,
          final_status: "FAILED" as const
        };
      };

      const isShadowSampled = isCanaryWindowActive({
        enabled: sorCanaryShadowEnabled,
        ...(dependencies.sorCanaryStartAt ? { startAt: dependencies.sorCanaryStartAt } : {}),
        ...(dependencies.sorCanaryEndAt ? { endAt: dependencies.sorCanaryEndAt } : {})
      }) && isCanarySampled(sessionId, sorCanaryPercent);

      const runShadowComparison = async (mode: ShadowMode): Promise<void> => {
        await withSpan(
          "sor.canary.evaluate",
          {
            rfq_id: sessionId,
            session_id: sessionId,
            sor_enabled: sorEnabled,
            canary_sampled: isShadowSampled,
            state: "CANARY_EVALUATE"
          },
          async () => {
            sorShadowTotal.labels(mode, String(isShadowSampled)).inc();
            if (!isShadowSampled) {
              return;
            }

            try {
              const allQuotes = await quoteRepository.listBySessionId(sessionId, 100);
              const legacyTop = rankQuotesByEffectiveCost(
                allQuotes.map((row) => ({
                  quoteId: String(row.quote_payload.quoteId ?? row.id),
                  ...(typeof row.quote_payload.lpId === "string" ? { lpId: row.quote_payload.lpId } : {}),
                  basePrice: Number.parseFloat(row.price),
                  venueFee: row.fee_bps / 10000,
                  protocolFee: 0,
                  gasCost: 0,
                  slippageEstimate: 0,
                  reliabilityScore: 100,
                  latencyScore: 100,
                  expires_at: row.valid_until.toISOString(),
                  soft_refresh_flag: false
                }))
              )[0];

              const shadowRfqInput: CanonicalRFQInput = {
                rfqId: session.id,
                idempotencyKey: session.idempotency_key,
                quantity: session.quantity,
                side: session.side,
                canonicalMarketId: session.canonical_market_id,
                stpMode: (session.metadata as any)?.stp_mode ?? "CANCEL_NEWEST",
                takerId: session.taker_id,
                metadata: {
                  reservation_token: reservationToken,
                  legs: [
                    {
                      leg_id: "00000000-0000-0000-0000-000000000000",
                      symbol: session.canonical_market_id,
                      target_quantity: session.quantity
                    }
                  ]
                }
              };
              const sorCandidates = await sorRouteScout.discoverCandidates(
                shadowRfqInput,
                selectedQuoteInput,
                acceptancePolicy
              );
              const sorScores = await orderRouter.evaluateCandidates(
                shadowRfqInput,
                selectedQuoteInput,
                acceptancePolicy
              );

              const bestSORScore = [...sorScores].sort(
                (left, right) => left.effectiveUnitCost - right.effectiveUnitCost
              )[0];
              const sorCandidate = sorCandidates.find(
                (candidate) => candidate.id === bestSORScore?.candidateId
              );

              const authoritativeDecision =
                mode === "legacy_authoritative"
                  ? ({
                    quoteId: legacyTop?.quoteId ?? request.quoteId,
                    ...(legacyTop?.lpId ? { providerId: legacyTop.lpId } : {}),
                    ...(typeof legacyTop?.basePrice === "number" ? { price: legacyTop.basePrice } : {})
                  } as const)
                  : ({
                    quoteId: request.quoteId,
                    ...(typeof quote.quote_payload.lpId === "string"
                      ? { providerId: quote.quote_payload.lpId }
                      : {}),
                    price: Number.parseFloat(quote.price)
                  } as const);

              const shadowDecision =
                mode === "legacy_authoritative"
                  ? ({
                    quoteId: bestSORScore?.candidateId ?? request.quoteId,
                    ...(sorCandidate?.provider_id ? { providerId: sorCandidate.provider_id } : {}),
                    ...(typeof sorCandidate?.quoted_price === "number"
                      ? { price: sorCandidate.quoted_price }
                      : {})
                  } as const)
                  : ({
                    quoteId: legacyTop?.quoteId ?? request.quoteId,
                    ...(legacyTop?.lpId ? { providerId: legacyTop.lpId } : {}),
                    ...(typeof legacyTop?.basePrice === "number" ? { price: legacyTop.basePrice } : {})
                  } as const);

              const comparison = compareShadowDecisions(authoritativeDecision, shadowDecision);

              await withSpan(
                "sor.canary.compare",
                {
                  rfq_id: sessionId,
                  session_id: sessionId,
                  sor_enabled: sorEnabled,
                  canary_sampled: isShadowSampled,
                  decision_match: comparison.match,
                  price_delta_bps: comparison.priceDeltaBps,
                  state: "CANARY_COMPARE"
                },
                async () => {
                  if (comparison.match) {
                    sorShadowMatchTotal.labels(comparison.dimension).inc();
                  } else {
                    sorShadowDivergenceTotal.labels(comparison.reason ?? "error").inc();
                  }
                  sorShadowPriceDeltaBps.observe(comparison.priceDeltaBps);

                  await eventRepository.append({
                    sessionId,
                    ...(quote ? { quoteId: quote.id } : {}),
                    eventType: "SOR_CANARY_DECISION",
                    eventPayload: {
                      mode,
                      sampled: true,
                      match: comparison.match,
                      dimension: comparison.dimension,
                      reason: comparison.reason ?? null,
                      price_delta_bps: comparison.priceDeltaBps,
                      authoritative_decision: authoritativeDecision,
                      shadow_decision: shadowDecision
                    }
                  });
                }
              );
            } catch (error) {
              sorShadowDivergenceTotal.labels("error").inc();
              dependencies.logger.error(
                { err: error, sessionId, mode },
                "SOR canary shadow comparison failed."
              );
            }
          }
        );
      };

      if (sorEnabled) {
        const response = await executeSORAccept();
        if (isShadowSampled) {
          void runShadowComparison("sor_authoritative");
        }
        return response;
      }

      const legacyResponse = await executeLegacyAccept();
      if (isShadowSampled) {
        void runShadowComparison("legacy_authoritative");
      }
      return legacyResponse;
    }
  });
  const adminAuthMiddleware = createAdminAuthMiddleware();
  const simulationPreviewAdminMiddleware = createAdminSimulationPreviewMiddleware({
    enabled: dependencies.devSimulationPreviewEnabled ?? false
  });
  await registerAdminRiskRoutes(app, adminAuthMiddleware, {
    riskEngine,
    exposureRepo: exposureRepository,
    exposureCache,
  });
  await registerAdminComboRoutes(app, adminAuthMiddleware, {
    comboRepo: comboRepository,
    exposureRepo: exposureRepository,
    exposureCache
  });
  await registerAdminSORRoutes(app, adminAuthMiddleware, {
    sorAdminService: new SORAdminService({
      pool: dependencies.pgPool,
      redis: dependencies.redisClient,
      planRunner,
      logger: dependencies.logger
    })
  });
  await registerAdminInternalCrossRoutes(app, adminAuthMiddleware, {
    internalCrossAdminService: new InternalCrossAdminService({
      pool: dependencies.pgPool,
      redis: dependencies.redisClient,
      logger: dependencies.logger
    })
  });
  await registerAdminInternalNettingRoutes(app, adminAuthMiddleware, {
    internalNettingAdminService: new InternalNettingAdminService({
      pool: dependencies.pgPool,
      redis: dependencies.redisClient,
      logger: dependencies.logger
    })
  });
  await registerAdminInternalClearingRoutes(app, adminAuthMiddleware, {
    internalClearingAdminService: new InternalClearingAdminService({
      pool: dependencies.pgPool,
      redis: dependencies.redisClient,
      logger: dependencies.logger
    })
  });
  const resolutionRiskAdminService = new ResolutionRiskAdminService({
    pool: dependencies.pgPool,
    redis: dependencies.redisClient,
    assessmentService: resolutionRiskAssessmentService,
    logger: dependencies.logger,
    version: "resolution-risk-v1"
  });
  await registerAdminResolutionRiskRoutes(app, adminAuthMiddleware, {
    resolutionRiskAdminService
  });
  const controlPlaneAdminService = new ControlPlaneAdminService({
    pool: dependencies.pgPool,
    logger: dependencies.logger,
    phase3AGuardrailShadowResolver,
  });
  await registerAdminControlPlaneRoutes(app, adminAuthMiddleware, {
    controlPlaneAdminService,
  });
  await registerAdminReplayRoutes(app, adminAuthMiddleware, {
    replayAdminService: new ReplayAdminService({
      replayMetadataReader: controlPlaneAdminService,
      exactReplayRunner: new ExactReplayRunner({
        pool: dependencies.pgPool,
        resolutionPairComparator: new ResolutionPairComparator(),
        resolutionRiskScoringEngine: new ResolutionRiskScoringEngine(),
        costModel: new CostModel(),
        splitter: new Splitter(),
        overlapGraphBuilder: new OverlapGraphBuilder(),
        candidateGroupEnumerator: new CandidateGroupEnumerator(),
        clearingCompressionScorer: new ClearingCompressionScorer(),
      }),
      diffReplayRunner: new DiffReplayRunner({
        pool: dependencies.pgPool,
        resolutionPairComparator: new ResolutionPairComparator(),
        costModel: new CostModel(),
        splitter: new Splitter(),
        overlapGraphBuilder: new OverlapGraphBuilder(),
        candidateGroupEnumerator: new CandidateGroupEnumerator(),
        clearingCompressionScorer: new ClearingCompressionScorer(),
      }),
      logger: dependencies.logger,
    }),
  });
  await registerAdminCompatibilityReviewRoutes(app, adminAuthMiddleware, {
    compatibilityOverrideService
  });
  await registerAdminQualificationRoutes(app, adminAuthMiddleware, {
    qualificationAdminService: new QualificationAdminService({
      pool: dependencies.pgPool,
      promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig()),
      logger: dependencies.logger,
    }),
  });
  await registerAdminQualificationSafetyRoutes(app, adminAuthMiddleware, {
    qualificationSafetyAdminService: new QualificationSafetyAdminService({
      pool: dependencies.pgPool,
      autoSafetyActionEngine: new AutoSafetyActionEngine({
        pool: dependencies.pgPool,
        controlPlaneAdminService,
        config: createDefaultAutoSafetyActionConfig(),
        logger: dependencies.logger
      }),
      logger: dependencies.logger
    })
  });
  await registerAdminSimulationRoutes(app, simulationPreviewAdminMiddleware, {
    simulationAdminService: new SimulationAdminService({
      pool: dependencies.pgPool,
      historicalSimulationRunner: new HistoricalSimulationRunner({
        pool: dependencies.pgPool,
        polymarketOnlyBaselineEvaluator: new PolymarketOnlyBaselineEvaluator(),
        limitlessOnlyBaselineEvaluator: new LimitlessOnlyBaselineEvaluator(),
        opinionOnlyBaselineEvaluator: new OpinionOnlyBaselineEvaluator(),
        myriadOnlyBaselineEvaluator: new MyriadOnlyBaselineEvaluator(),
        predictOnlyBaselineEvaluator: new PredictOnlyBaselineEvaluator(),
        bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
        noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
        lotusEvaluators: createDefaultHistoricalLotusEvaluators(),
        logger: dependencies.logger
      }),
      resolutionRiskAdminService,
      historicalSimulationCatalogService: new HistoricalSimulationCatalogService({
        pool: dependencies.pgPool,
        version: "historical-sim-catalog-v1",
        logger: dependencies.logger
      }),
      configVersion: "historical-sim-v1",
      engineVersion: "historical-sim-v1",
      logger: dependencies.logger
    })
  });
  await registerAdminSimulationConsoleRoutes(app, simulationPreviewAdminMiddleware);
  await registerLPQuotesRoute(app, lpAuthMiddleware, receiveLPQuoteService);

  const forwardableEventTypes: ReadonlySet<string> = new Set([
    "QUOTE_RECEIVED",
    "STATE_TRANSITION",
    "EXECUTION_UPDATE",
    "RISK_REJECTED",
    "RISK_EXECUTION_REJECTED"
  ]);

  for (const eventType of forwardableEventTypes.values()) {
    domainEventEmitter.on(eventType, (event: RFQDomainEvent) => {
      if (
        (event.type as string) !== "QUOTE_RECEIVED" &&
        (event.type as string) !== "STATE_TRANSITION" &&
        (event.type as string) !== "EXECUTION_UPDATE" &&
        (event.type as string) !== "RISK_REJECTED" &&
        (event.type as string) !== "RISK_EXECUTION_REJECTED"
      ) {
        return;
      }

      void wsGateway.publishEvent({
        type: event.type as any,
        topic: `rfq:${event.sessionId}`,
        emittedAt: event.occurredAt,
        payload: event.payload
      });
    });
  }

  return app;
};

const readAcceptancePolicy = (metadata: Record<string, unknown>): SORAcceptancePolicy => {
  const value = metadata.acceptance_policy;
  if (value === "ALL_OR_NONE" || value === "PARTIAL_ALLOWED" || value === "BEST_EFFORT") {
    return value;
  }
  return "ALL_OR_NONE";
};

const asRFQState = (value: string): RFQState | null => {
  if (
    value === "CREATED" ||
    value === "BROADCAST" ||
    value === "COLLECTING_QUOTES" ||
    value === "RANKING" ||
    value === "AWAITING_USER" ||
    value === "ACCEPTED" ||
    value === "EXECUTING" ||
    value === "SETTLED" ||
    value === "FAILED" ||
    value === "EXPIRED"
  ) {
    return value;
  }
  return null;
};

interface ResolutionProfileLookupRow {
  id: string;
  venue: string;
  venue_market_id: string;
  canonical_event_id: string;
  canonical_market_id: string;
  oracle_type: string | null;
  oracle_name: string | null;
  resolution_authority_type: string | null;
  primary_resolution_text: string | null;
  supplemental_rules_text: string | null;
  dispute_window_hours: string | null;
  settlement_lag_hours: string | null;
  market_type: string | null;
  outcome_schema: Record<string, unknown> | null;
  has_ambiguous_time_boundary: boolean;
  has_ambiguous_jurisdiction_boundary: boolean;
  has_ambiguous_source_reference: boolean;
  historical_divergence_rate: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const findResolutionProfileByVenueMarket = async (
  pool: Pool,
  venue: string,
  marketId: string
): Promise<NormalizedResolutionProfile | null> => {
  const result = await pool.query<ResolutionProfileLookupRow>(
    `SELECT *
       FROM resolution_profiles
      WHERE venue = $1
        AND venue_market_id = $2
      LIMIT 1`,
    [venue, marketId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    venue: row.venue,
    venueMarketId: row.venue_market_id,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    oracleType: row.oracle_type,
    oracleName: row.oracle_name,
    resolutionAuthorityType: row.resolution_authority_type,
    primaryResolutionText: row.primary_resolution_text,
    supplementalRulesText: row.supplemental_rules_text,
    disputeWindowHours: row.dispute_window_hours,
    settlementLagHours: row.settlement_lag_hours,
    marketType: row.market_type,
    outcomeSchema: row.outcome_schema,
    hasAmbiguousTimeBoundary: row.has_ambiguous_time_boundary,
    hasAmbiguousJurisdictionBoundary: row.has_ambiguous_jurisdiction_boundary,
    hasAmbiguousSourceReference: row.has_ambiguous_source_reference,
    historicalDivergenceRate: row.historical_divergence_rate,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
};
