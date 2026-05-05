import { createHash } from "node:crypto";
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
import { registerFundingRoutes } from "./routes/funding.js";
import { registerExecutionRoutes } from "./routes/execution.js";
import { registerMarketCatalogRoutes } from "./routes/markets.js";
import { buildVenueBalanceActivationActions } from "../core/funding/venue-activation.js";
import { registerUserWithdrawalWalletRoutes } from "./routes/user-withdrawal-wallets.js";
import { registerUserWalletRoutes } from "./routes/user-wallets.js";
import { registerUserVenueAccountRoutes } from "./routes/user-venue-accounts.js";
import { registerInternalPolymarketFundingBalanceRoute } from "./routes/internal-polymarket-funding-balance.js";
import { registerInternalLimitlessWithdrawalEvidenceRoute } from "./routes/internal-limitless-withdrawal-evidence.js";
import { registerRFQRoute } from "./routes/rfq.js";
import { registerResolutionRiskRoutes } from "./routes/resolution-risk.js";
import { createLPAuthMiddleware } from "../lp/lp-auth-middleware.js";
import { registerLPQuotesRoute } from "../lp/routes/lp-quotes-route.js";
import { ReceiveLPQuoteService } from "../lp/receive-lp-quote-service.js";
import { registerWebSocketPlugin } from "../ws/plugin.js";
import type { RFQDomainEvent } from "../core/rfq-engine/rfq-domain-events.js";
import { LPStatsRepository } from "../repositories/lp-stats.repository.js";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";
import {
  createUserAuthMiddleware,
  createAdminAuthMiddleware,
  createAdminOwnerAuthMiddleware,
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
import { registerAdminPairMatchReviewRoutes } from "./admin/pair-match-review.routes.js";
import { registerAdminExecutionControlRoutes } from "./admin/execution-control.routes.js";
import { registerAdminQualificationRoutes } from "./admin/qualification.routes.js";
import { QualificationAdminService, createDefaultPromotionGateConfig } from "./admin/qualification-admin-service.js";
import { registerAdminQualificationSafetyRoutes } from "./admin/qualification-safety.routes.js";
import { QualificationSafetyAdminService } from "./admin/qualification-safety-admin-service.js";
import { registerAdminSimulationRoutes } from "./admin/simulation.routes.js";
import { registerAdminSimulationConsoleRoutes } from "./admin/simulation-console.routes.js";
import { SimulationAdminService } from "./admin/simulation-admin-service.js";
import { HistoricalSimulationCatalogService } from "./admin/historical-simulation-catalog-service.js";
import { registerAdminPairRolloutRoutes } from "./admin/pair-rollout.routes.js";
import { registerAdminPairQualificationRoutes } from "./admin/pair-qualification.routes.js";
import { registerAdminPairShadowRoutes } from "./admin/pair-shadow.routes.js";
import { registerAdminPairPromotionRoutes } from "./admin/pair-promotion.routes.js";
import { PairRouteAdminService } from "./admin/pair-route-admin-service.js";
import { registerAdminPoliticsNomineeRoutes } from "./admin/politics-nominee.routes.js";
import { PoliticsNomineeAdminService } from "./admin/politics-nominee-admin-service.js";
import { registerAdminPoliticsOfficeWinnerRoutes } from "./admin/politics-office-winner.routes.js";
import { PoliticsOfficeWinnerAdminService } from "./admin/politics-office-winner-admin-service.js";
import { registerAdminPoliticsPartyControlRoutes } from "./admin/politics-party-control.routes.js";
import { PoliticsPartyControlAdminService } from "./admin/politics-party-control-admin-service.js";
import { registerAdminPoliticsOfficeExitRoutes } from "./admin/politics-office-exit.routes.js";
import { PoliticsOfficeExitAdminService } from "./admin/politics-office-exit-admin-service.js";
import { registerAdminPoliticsGeopoliticalRoutes } from "./admin/politics-geopolitical.routes.js";
import { PoliticsGeopoliticalAdminService } from "./admin/politics-geopolitical-admin-service.js";
import { registerAdminSportsRoutes } from "./admin/sports.routes.js";
import { SportsAdminService } from "./admin/sports-admin-service.js";
import { registerAdminCryptoRoutes } from "./admin/crypto.routes.js";
import { CryptoAdminService } from "./admin/crypto-admin-service.js";
import { registerAdminExecutionVenuesRoutes } from "./admin/execution-venues.routes.js";
import { ExecutionVenuesAdminService } from "./admin/execution-venues-admin-service.js";
import { registerAdminTradeReadinessRoutes } from "./admin/trade-readiness.routes.js";
import { registerAdminFundingReadinessRoutes } from "./admin/funding-readiness.routes.js";
import { FundingReadinessAdminService } from "./admin/funding-readiness-admin-service.js";
import { registerAdminAuthRoutes } from "./admin/admin-auth.routes.js";
import { AdminAuthService } from "./admin/admin-auth-service.js";
import {
  createAdminAuthRateLimitConfig,
  FallbackAdminAuthRateLimiter,
  InMemoryAdminAuthRateLimiter,
  RedisAdminAuthRateLimiter
} from "./admin/admin-auth-rate-limiter.js";
import {
  FallbackRateLimiter,
  InMemoryRateLimiter,
  parseRateLimitRule,
  RedisRateLimiter
} from "./rate-limiter.js";
import { buildAdminEmailDeliveryFromEnv } from "./admin/admin-email-delivery.js";
import { registerAdminOpsRoutes } from "./admin/admin-ops.routes.js";
import { registerAdminMonetizationRoutes } from "./admin/monetization.routes.js";
import { registerAdminSchemaMapRoutes } from "./admin/schema-map.routes.js";
import { SchemaMapService } from "./admin/schema-map-service.js";
import { AdminAuthRepository } from "../repositories/admin-auth.repository.js";
import { buildAdminCorsOptions, parseAdminCorsOrigins } from "./admin-cors.js";
import { PairShadowObservationRepository } from "../shadow/pair-shadow-observation-repository.js";
import { PairShadowRuntimeWriter } from "../shadow/pair-shadow-runtime-writer.js";
import { PairShadowRuntimeHooks } from "../shadow/pair-shadow-runtime-hooks.js";
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
import { ExecutionControlRepository } from "../repositories/execution-control.repository.js";
import { FundingRepository } from "../repositories/funding.repository.js";
import { UserWalletRepository } from "../repositories/user-wallet.repository.js";
import { UserVenueAccountRepository } from "../repositories/user-venue-account.repository.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { CompatibilityOverrideService } from "../canonical/compatibility-override-service.js";
import { PairMatchReviewService } from "./admin/pair-match-review-service.js";
import { RouteSelectionTraceWriter } from "../routing/route-selection-trace.js";
import { FailureRecoveryManager } from "../execution/failure-recovery-manager.js";
import { ExecutionPolicyValidator } from "../execution-control/execution-policy-validator.js";
import { ExecutionFreshnessGuard } from "../execution-control/execution-freshness-guard.js";
import { ExecutionApprovalGate } from "../execution-control/execution-approval-gate.js";
import { ExecutionIdempotencyService } from "../execution-control/execution-idempotency-service.js";
import { ExecutionReplayProtector } from "../execution-control/execution-replay-protector.js";
import { ExecutionSubmissionOrchestrator } from "../execution-control/execution-submission-orchestrator.js";
import { ExecutionFailSafeHandler } from "../execution-control/execution-fail-safe-handler.js";
import { ExecutionAuditWriter } from "../execution-control/execution-audit-writer.js";
import { ExecutionControlGateway } from "../execution-control/execution-control-gateway.js";
import type { ExecutionControlRequest } from "../execution-control/execution-control-types.js";
import {
  ExecutionScopeAuthorityError,
  type ExecutionScopeAuthorityRegistry,
  ExecutionScopeTokenService
} from "../execution-control/execution-scope-token.js";
import { CryptoExecutionScopeAuthority } from "../execution-control/crypto-execution-scope-authority.js";
import { PoliticsNomineeExecutionScopeAuthority } from "../execution-control/politics-nominee-execution-scope-authority.js";
import { SportsExecutionScopeAuthority } from "../execution-control/sports-execution-scope-authority.js";
import {
  AccountingUpdateService,
  ApprovedLaneExecutionGate,
  buildFrontendExecutionStatus,
  ExecutionFeeService,
  ExecutionPreflightService,
  ExecutionSystemMetadataSchema,
  ExecutionSystemOrchestrator,
  ExecutionSystemSubmissionHandler,
  ExecutionVenueAdapterRegistry,
  FallbackPolicyService,
  LimitlessExecutionAdapter,
  OpinionExecutionAdapter,
  PredictFunExecutionAdapter,
  getMonetizationPolicyFromEnv,
  getPolymarketExecutionAdapterV2EnvStatus,
  GhostFillProtectionService,
  PolymarketExecutionAdapterV2,
  buildLimitlessExecutionAdapterConfigFromEnv,
  buildOpinionExecutionAdapterConfigFromEnv,
  buildPredictFunExecutionAdapterConfigFromEnv,
  buildPolymarketExecutionAdapterV2ConfigFromEnv,
  RepositoryExecutionAuditSink,
  ScopeAuthorityLaneResolver,
  SettlementVerificationService,
  TestExecutionAdapter,
  alwaysHealthyPreflightDeps
} from "../execution-system/index.js";
import { MonetizationRepository } from "../repositories/monetization.repository.js";
import { FundingReadinessChecker, FundingService } from "../core/funding/funding-service.js";
import { FundingError } from "../core/funding/types.js";
import {
  PolymarketFundingBalanceReadService,
  buildPolymarketFundingBalanceReadConfigFromEnv
} from "../core/funding/polymarket-balance-read-service.js";
import {
  InternalWithdrawalEvidenceReadService
} from "../core/funding/limitless-withdrawal-evidence-read-service.js";
import { buildFundingVenueReadinessCheckersFromEnv } from "../core/funding/venue-readiness.js";
import {
  buildPolymarketWithdrawalEvidenceCheckerFromEnv,
  buildWithdrawalCompletionPersistenceGateFromEnv
} from "../core/funding/withdrawal-evidence.js";
import {
  getPolymarketBridgeWithdrawalConfigFromEnv,
  HttpPolymarketBridgeWithdrawalClient,
  PolymarketBridgeWithdrawalAdapter
} from "../core/funding/polymarket-bridge-withdrawal-adapter.js";
import {
  getPredictFunWithdrawalConfigFromEnv,
  PredictFunWithdrawalAdapter
} from "../core/funding/predictfun-withdrawal-adapter.js";
import {
  getMyriadWithdrawalConfigFromEnv,
  MyriadWalletWithdrawalAdapter
} from "../core/funding/myriad-withdrawal-adapter.js";
import {
  getOpinionWithdrawalConfigFromEnv,
  OpinionSafeWithdrawalAdapter
} from "../core/funding/opinion-withdrawal-adapter.js";
import { LifiRestClient, buildLifiClientConfigFromEnv } from "../integrations/lifi/lifi-client.js";
import {
  getTurnkeyWalletConfigFromEnv,
  isTurnkeyWalletConfigReady,
  TurnkeyUserWalletProvisioner
} from "../integrations/turnkey/turnkey-wallet-client.js";
import { buildPredictAccountClientFromEnv } from "../integrations/predict/predict-account-client.js";
import { buildLimitlessPartnerAccountClientFromEnv } from "../integrations/limitless/limitless-partner-account-client.js";
import {
  buildPolymarketDepositWalletClientConfigFromEnv,
  PolymarketDepositWalletClient
} from "../integrations/polymarket/polymarket-deposit-wallet-client.js";
import { UserWalletService } from "../core/funding/user-wallets.js";
import { UserVenueAccountService } from "../core/execution/user-venue-accounts.js";
import {
  ExecutableRouteService,
  SellQuoteService
} from "../execution-system/executable-routing.js";
import {
  PgExecutionQuoteRepository,
  PgVerifiedPositionRepository
} from "../repositories/execution-routing.repository.js";
import { MarketCatalogRepository } from "../repositories/market-catalog.repository.js";
import {
  buildFundingReadinessWatcherConfigFromEnv,
  FundingReadinessWatcher
} from "../core/funding/funding-readiness-watcher.js";
import {
  buildFundingIntentCleanupConfigFromEnv,
  FundingIntentCleanupWatcher
} from "../core/funding/funding-intent-cleanup.js";

export interface ServerDependencies {
  logger: Logger;
  redisClient: RedisClient;
  pgPool: Pool;
  pairShadowPool?: Pool;
  db: AppDb;
  canonicalServiceBaseUrl: string;
  jwtSecret: string;
  devSimulationPreviewEnabled?: boolean;
  sorEnabled?: boolean;
  executionSystemSandboxEnabled?: boolean;
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
  executionScopeAuthorities?: ExecutionScopeAuthorityRegistry;
}

const parseAdminJwtTtlSeconds = (value: string | undefined): number => {
  const parsed = Number(value ?? "3600");
  return Number.isFinite(parsed) && parsed >= 300 && parsed <= 86_400 ? Math.trunc(parsed) : 3600;
};

const parseAdminMagicLinkTtlSeconds = (value: string | undefined): number => {
  const parsed = Number(value ?? "900");
  return Number.isFinite(parsed) && parsed >= 60 && parsed <= 3600 ? Math.trunc(parsed) : 900;
};

export const buildServer = async (dependencies: ServerDependencies): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false
  });
  const sorEnabled = dependencies.sorEnabled ?? false;
  const sorCanaryShadowEnabled = dependencies.sorCanaryShadowEnabled ?? false;
  const sorCanaryPercent = dependencies.sorCanaryPercent ?? 0;
  const internalCrossEnabled = dependencies.internalCrossEnabled ?? false;

  const adminCorsOrigins = parseAdminCorsOrigins(process.env.ADMIN_CORS_ORIGINS);
  if (adminCorsOrigins.length > 0) {
    await app.register(fastifyCors, buildAdminCorsOptions(adminCorsOrigins));
  }

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
  const fundingRepository = new FundingRepository(dependencies.pgPool);
  const userWalletRepository = new UserWalletRepository(dependencies.pgPool);
  const userVenueAccountRepository = new UserVenueAccountRepository(dependencies.pgPool);
  const executionQuoteRepository = new PgExecutionQuoteRepository(dependencies.pgPool);
  const verifiedPositionRepository = new PgVerifiedPositionRepository(dependencies.pgPool);
  const marketCatalogRepository = new MarketCatalogRepository(dependencies.pgPool);
  const executionVenuesAdminService = new ExecutionVenuesAdminService({
    env: process.env,
    repoRoot: process.cwd(),
    venueAccountRepository: userVenueAccountRepository
  });
  const executableRouteService = new ExecutableRouteService(
    executionVenuesAdminService,
    executionQuoteRepository
  );
  const sellQuoteService = new SellQuoteService(
    verifiedPositionRepository,
    executableRouteService
  );
  const turnkeyWalletConfig = getTurnkeyWalletConfigFromEnv(process.env);
  const turnkeyWalletProvisioner = isTurnkeyWalletConfigReady(turnkeyWalletConfig)
    ? new TurnkeyUserWalletProvisioner(turnkeyWalletConfig)
    : null;
  const userWalletService = new UserWalletService(userWalletRepository, {
    turnkeyEnabled: turnkeyWalletConfig.enabled,
    defaultSolanaWalletEnabled: turnkeyWalletConfig.defaultSolanaWalletEnabled,
    defaultEvmWalletEnabled: turnkeyWalletConfig.defaultEvmWalletEnabled
  }, turnkeyWalletProvisioner);
  const polymarketDepositWalletClient = new PolymarketDepositWalletClient(
    buildPolymarketDepositWalletClientConfigFromEnv(process.env)
  );
  const userVenueAccountService = new UserVenueAccountService(
    userVenueAccountRepository,
    userWalletService,
    buildPredictAccountClientFromEnv(process.env),
    buildLimitlessPartnerAccountClientFromEnv(process.env),
    polymarketDepositWalletClient
  );
  const polymarketBridgeWithdrawalConfig = getPolymarketBridgeWithdrawalConfigFromEnv(process.env);
  const polymarketBridgeWithdrawalAdapter = polymarketBridgeWithdrawalConfig.configured && polymarketBridgeWithdrawalConfig.apiBaseUrl
    ? new PolymarketBridgeWithdrawalAdapter(
        new HttpPolymarketBridgeWithdrawalClient({
          apiBaseUrl: polymarketBridgeWithdrawalConfig.apiBaseUrl,
          timeoutMs: polymarketBridgeWithdrawalConfig.timeoutMs,
          authMode: polymarketBridgeWithdrawalConfig.authMode,
          apiKey: process.env.POLYMARKET_BRIDGE_API_KEY
        }),
        polymarketBridgeWithdrawalConfig
      )
    : null;
  const predictFunWithdrawalConfig = getPredictFunWithdrawalConfigFromEnv(process.env);
  const predictFunWithdrawalAdapter = predictFunWithdrawalConfig.configured
    ? new PredictFunWithdrawalAdapter(predictFunWithdrawalConfig)
    : null;
  const myriadWithdrawalConfig = getMyriadWithdrawalConfigFromEnv(process.env);
  const myriadWithdrawalAdapter = myriadWithdrawalConfig.configured
    ? new MyriadWalletWithdrawalAdapter(myriadWithdrawalConfig)
    : null;
  const opinionWithdrawalConfig = getOpinionWithdrawalConfigFromEnv(process.env);
  const opinionWithdrawalAdapter = opinionWithdrawalConfig.configured
    ? new OpinionSafeWithdrawalAdapter(opinionWithdrawalConfig)
    : null;
  const fundingService = new FundingService(
    fundingRepository,
    new LifiRestClient(buildLifiClientConfigFromEnv(process.env)),
    {
      lifiQuotesEnabled: process.env.FUNDING_LIFI_QUOTES_ENABLED === "true",
      liveSubmitEnabled: process.env.FUNDING_LIVE_SUBMIT_ENABLED === "true",
      venueReadinessChecksEnabled: process.env.FUNDING_VENUE_READINESS_CHECKS_ENABLED === "true",
      env: process.env
    },
    buildFundingVenueReadinessCheckersFromEnv(process.env),
    buildPolymarketWithdrawalEvidenceCheckerFromEnv(process.env),
    buildWithdrawalCompletionPersistenceGateFromEnv(process.env),
    polymarketBridgeWithdrawalAdapter,
    predictFunWithdrawalAdapter,
    userWalletService,
    myriadWithdrawalAdapter,
    opinionWithdrawalAdapter,
    userWalletService,
    userVenueAccountRepository
  );
  const fundingReadinessWatcher = new FundingReadinessWatcher(
    fundingRepository,
    fundingService,
    dependencies.logger,
    buildFundingReadinessWatcherConfigFromEnv(process.env)
  );
  fundingReadinessWatcher.start();
  app.addHook("onClose", async () => {
    fundingReadinessWatcher.stop();
  });
  const fundingIntentCleanupWatcher = new FundingIntentCleanupWatcher(
    fundingRepository,
    dependencies.logger,
    buildFundingIntentCleanupConfigFromEnv(process.env)
  );
  fundingIntentCleanupWatcher.start();
  app.addHook("onClose", async () => {
    fundingIntentCleanupWatcher.stop();
  });
  const fundingIntentCreateRateLimiter = new FallbackRateLimiter(
    new RedisRateLimiter({
      redis: dependencies.redisClient,
      logger: dependencies.logger,
      keyPrefix: "funding-intents",
      keyPepper: dependencies.jwtSecret,
      operationTimeoutMs: 250,
      rules: {
        funding_intent_create: parseRateLimitRule(process.env, "FUNDING_INTENT_CREATE_RATE_LIMIT", {
          windowSeconds: 300,
          maxPerUser: 4,
          maxPerIp: 20
        }),
        withdrawal_intent_create: parseRateLimitRule(process.env, "WITHDRAWAL_INTENT_CREATE_RATE_LIMIT", {
          windowSeconds: 300,
          maxPerUser: 4,
          maxPerIp: 20
        })
      }
    }),
    new InMemoryRateLimiter({
      keyPrefix: "funding-intents",
      keyPepper: dependencies.jwtSecret,
      rules: {
        funding_intent_create: parseRateLimitRule(process.env, "FUNDING_INTENT_CREATE_RATE_LIMIT", {
          windowSeconds: 300,
          maxPerUser: 4,
          maxPerIp: 20
        }),
        withdrawal_intent_create: parseRateLimitRule(process.env, "WITHDRAWAL_INTENT_CREATE_RATE_LIMIT", {
          windowSeconds: 300,
          maxPerUser: 4,
          maxPerIp: 20
        })
      }
    })
  );
  const polymarketFundingBalanceReadService = new PolymarketFundingBalanceReadService(
    buildPolymarketFundingBalanceReadConfigFromEnv(process.env),
    undefined,
    userVenueAccountRepository
  );
  const internalWithdrawalEvidenceReadService = new InternalWithdrawalEvidenceReadService({ env: process.env });
  const failureRecoveryManager = new FailureRecoveryManager(dependencies.pgPool);
  const executionControlRepository = new ExecutionControlRepository(dependencies.pgPool);
  const monetizationPolicy = getMonetizationPolicyFromEnv(process.env);
  const monetizationRepository = new MonetizationRepository(dependencies.pgPool);
  const adminAuthRepository = new AdminAuthRepository(dependencies.pgPool);
  const adminAuthService = new AdminAuthService(adminAuthRepository, {
    keyPepper: process.env.ADMIN_AUTH_KEY_PEPPER,
    allowedEmailDomains: process.env.ADMIN_ALLOWED_EMAIL_DOMAINS,
    adminFrontendBaseUrl: process.env.ADMIN_FRONTEND_BASE_URL,
    magicLinkTtlSeconds: parseAdminMagicLinkTtlSeconds(process.env.ADMIN_MAGIC_LINK_TTL_SECONDS)
  }, buildAdminEmailDeliveryFromEnv(process.env));
  const adminAuthRateLimits = createAdminAuthRateLimitConfig(process.env);
  const adminAuthRateLimiter = new FallbackAdminAuthRateLimiter(
    new RedisAdminAuthRateLimiter({
      redis: dependencies.redisClient,
      logger: dependencies.logger,
      keyPepper: process.env.ADMIN_AUTH_KEY_PEPPER,
      operationTimeoutMs: 250,
      requestLoginLink: adminAuthRateLimits.requestLoginLink,
      manualLogin: adminAuthRateLimits.manualLogin
    }),
    new InMemoryAdminAuthRateLimiter({
      keyPepper: process.env.ADMIN_AUTH_KEY_PEPPER,
      requestLoginLink: adminAuthRateLimits.requestLoginLink,
      manualLogin: adminAuthRateLimits.manualLogin
    })
  );
  const executionAuditWriter = new ExecutionAuditWriter(
    executionIntentRepository,
    executionRecordRepository,
    executionControlRepository,
    failureRecoveryManager,
    dependencies.logger
  );
  let executionSystemSandboxHandler: ExecutionSystemSubmissionHandler | null = null;
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
  const pairShadowPool = dependencies.pairShadowPool ?? dependencies.pgPool;
  const pairShadowRuntimeHooks = new PairShadowRuntimeHooks({
    writer: new PairShadowRuntimeWriter({
      repository: new PairShadowObservationRepository(pairShadowPool),
      repoRoot: process.cwd(),
      ...(dependencies.logger ? { logger: dependencies.logger } : {})
    }),
    ...(dependencies.logger ? { logger: dependencies.logger } : {})
  });
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
    ...(qualificationRuntimeConfig.sor ? { qualificationConfig: qualificationRuntimeConfig.sor } : {}),
    pairShadowRuntimeHooks
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

  const executionControlGateway = new ExecutionControlGateway({
    policyValidator: new ExecutionPolicyValidator(),
    freshnessGuard: new ExecutionFreshnessGuard(),
    approvalGate: new ExecutionApprovalGate(),
    idempotencyService: new ExecutionIdempotencyService(executionControlRepository),
    replayProtector: new ExecutionReplayProtector(executionControlRepository),
    submissionOrchestrator: new ExecutionSubmissionOrchestrator(
      {
        INTERNAL_CROSS: {
          execute: async ({ request }) => {
            const payload = request.submissionPayload as {
              sessionId: string;
              reservationToken: string;
              filledSize: string;
              trades: readonly unknown[];
            };
            if (riskEngine.rollbackReservation) {
              await riskEngine.rollbackReservation(payload.reservationToken);
            }
            await transitionRFQState(payload.sessionId, "ACCEPTED", "internal_match_full");
            await transitionRFQState(payload.sessionId, "SETTLED", "internal_match_full");
            return {
              status: "COMPLETED",
              payload: {
                filledSize: payload.filledSize,
                trades: payload.trades
              }
            };
          }
        },
        SOR_PLAN: {
          execute: async (submissionInput) => {
            const { request } = submissionInput;
            const payload = request.submissionPayload as {
              sessionId: string;
              plan: Parameters<typeof planRunner.run>[0];
              acceptancePolicy: SORAcceptancePolicy;
              awaitExecution: boolean;
            };
            if (dependencies.executionSystemSandboxEnabled && request.executionScopeBinding && executionSystemSandboxHandler) {
              await transitionRFQState(payload.sessionId, "ACCEPTED", "execution_system_v0_sandbox_accepted");
              await transitionRFQState(payload.sessionId, "EXECUTING", "execution_system_v0_sandbox_running");
              const result = await executionSystemSandboxHandler.execute(submissionInput);
              if (result.status === "COMPLETED") {
                await transitionRFQState(payload.sessionId, "SETTLED", "execution_system_v0_sandbox_completed");
              } else if (result.status === "FAILED") {
                await transitionRFQState(payload.sessionId, "FAILED", "execution_system_v0_sandbox_failed");
              }
              return result;
            }
            const runPlan = async () => {
              await transitionRFQState(payload.sessionId, "ACCEPTED", "sor_plan_created");
              await transitionRFQState(payload.sessionId, "EXECUTING", "sor_plan_running");
              const result = await planRunner.run(payload.plan);
              if (result.status === "COMPLETED" || result.status === "PARTIAL") {
                await transitionRFQState(payload.sessionId, "SETTLED", "sor_plan_completed");
              } else {
                await transitionRFQState(payload.sessionId, "FAILED", "sor_plan_failed");
              }
              return result;
            };

            if (!payload.awaitExecution) {
              void runPlan().catch((error: unknown) => {
                dependencies.logger.error(
                  { err: error, sessionId: payload.sessionId, planId: payload.plan.id },
                  "Background SOR plan execution failed."
                );
              });
              return {
                status: "SUBMITTED",
                payload: {
                  planId: payload.plan.id,
                  dispatchMode: "background"
                }
              };
            }

            const result = await runPlan();
            return {
              status:
                result.status === "COMPLETED"
                  ? "COMPLETED"
                  : result.status === "PARTIAL"
                    ? "PARTIAL"
                    : "FAILED",
              payload: {
                planId: payload.plan.id,
                finalStatus: result.status,
                ...(result.failureReason ? { failureReason: result.failureReason } : {})
              }
            };
          }
        },
        LEGACY_RFQ: {
          execute: async ({ request }) => {
            const payload = request.submissionPayload as {
              sessionId: string;
              rankedQuotes: Parameters<typeof legacyExecutionRouter.execute>[0]["rankedQuotes"];
              reservationToken: string;
            };
            await transitionRFQState(payload.sessionId, "ACCEPTED", "legacy_execution_requested");
            const legacyResult = await legacyExecutionRouter.execute({
              sessionId: payload.sessionId,
              rankedQuotes: payload.rankedQuotes,
              fallbackToNextQuote: true,
              reservationToken: payload.reservationToken
            });
            if (legacyResult.ok) {
              await transitionRFQState(payload.sessionId, "SETTLED", "legacy_execution_success");
              return {
                status: "COMPLETED",
                payload: {
                  executedQuoteId: legacyResult.executedQuoteId ?? null
                }
              };
            }
            await transitionRFQState(payload.sessionId, "FAILED", "legacy_execution_failed");
            return {
              status: "FAILED",
              payload: {
                attempts: legacyResult.attempts
              }
            };
          }
        }
      },
      executionControlRepository,
      dependencies.logger
    ),
    failSafeHandler: new ExecutionFailSafeHandler(),
    auditWriter: executionAuditWriter,
    executionControlRepository,
    logger: dependencies.logger
  });
  const politicsNomineeAdminService = new PoliticsNomineeAdminService({
    pool: dependencies.pgPool,
    repoRoot: process.cwd()
  });
  const politicsOfficeWinnerAdminService = new PoliticsOfficeWinnerAdminService({
    pool: dependencies.pgPool,
    repoRoot: process.cwd()
  });
  const politicsPartyControlAdminService = new PoliticsPartyControlAdminService({
    pool: dependencies.pgPool,
    repoRoot: process.cwd()
  });
  const politicsOfficeExitAdminService = new PoliticsOfficeExitAdminService({
    pool: dependencies.pgPool,
    repoRoot: process.cwd()
  });
  const politicsGeopoliticalAdminService = new PoliticsGeopoliticalAdminService({
    pool: dependencies.pgPool,
    repoRoot: process.cwd()
  });
  const sportsAdminService = new SportsAdminService({
    pool: dependencies.pgPool,
    repoRoot: process.cwd()
  });
  const cryptoAdminService = new CryptoAdminService({
    pool: dependencies.pgPool,
    repoRoot: process.cwd()
  });
  const executionScopeTokenService = new ExecutionScopeTokenService(
    process.env.EXECUTION_SCOPE_TOKEN_SECRET ?? dependencies.jwtSecret
  );
  const defaultExecutionScopeAuthorities = {
    CRYPTO_LANE: new CryptoExecutionScopeAuthority(cryptoAdminService),
    SPORTS_LANE: new SportsExecutionScopeAuthority(sportsAdminService),
    POLITICS_NOMINEE_LANE: new PoliticsNomineeExecutionScopeAuthority(politicsNomineeAdminService)
  } as const;
  const executionScopeAuthorities: ExecutionScopeAuthorityRegistry = {
    ...defaultExecutionScopeAuthorities,
    ...(dependencies.executionScopeAuthorities ?? {})
  };
  if (dependencies.executionSystemSandboxEnabled) {
    const laneGate = new ApprovedLaneExecutionGate(new ScopeAuthorityLaneResolver(executionScopeAuthorities));
    const adapterRegistry = new ExecutionVenueAdapterRegistry();
    for (const venue of ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT", "MYRIAD", "TEST"]) {
      adapterRegistry.register(new TestExecutionAdapter(venue));
    }
    if (process.env.POLYMARKET_EXECUTION_MODE === "v2") {
      adapterRegistry.register(new PolymarketExecutionAdapterV2(
        buildPolymarketExecutionAdapterV2ConfigFromEnv(process.env)
      ));
    }
    if (process.env.LIMITLESS_EXECUTION_MODE === "backend_signer" || process.env.LIMITLESS_EXECUTION_MODE === "delegated_partner_server_wallet") {
      adapterRegistry.register(new LimitlessExecutionAdapter(
        buildLimitlessExecutionAdapterConfigFromEnv(process.env)
      ));
    }
    if (process.env.OPINION_EXECUTION_MODE === "user_signed_backend_relay") {
      adapterRegistry.register(new OpinionExecutionAdapter(
        buildOpinionExecutionAdapterConfigFromEnv(process.env)
      ));
    }
    if (process.env.PREDICT_FUN_EXECUTION_MODE === "user_signed_backend_relay") {
      adapterRegistry.register(new PredictFunExecutionAdapter(
        buildPredictFunExecutionAdapterConfigFromEnv(process.env)
      ));
    }
    const preflightDeps = alwaysHealthyPreflightDeps(laneGate);
    preflightDeps.funding = new FundingReadinessChecker(
      fundingService,
      process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true"
    );
    const preflight = new ExecutionPreflightService(preflightDeps);
    executionSystemSandboxHandler = new ExecutionSystemSubmissionHandler(new ExecutionSystemOrchestrator({
      preflight,
      adapters: adapterRegistry,
      settlement: new SettlementVerificationService(adapterRegistry, {
        timeoutMs: 100,
        pollIntervalMs: 5,
        maxAttempts: 1
      }),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(laneGate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService({ policy: monetizationPolicy, futureSettlementFee: 0 }),
      positions: verifiedPositionRepository,
      ...(monetizationPolicy.captureMode !== "DISABLED"
        ? {
            monetization: {
              policy: monetizationPolicy,
              repository: monetizationRepository,
              polymarketBuilderCodeConfigured: getPolymarketExecutionAdapterV2EnvStatus(process.env).builderCodeConfigured
            }
          }
        : {}),
      audit: new RepositoryExecutionAuditSink(executionControlRepository)
    }));
  }

  const wsGateway = await registerWebSocketPlugin(app, {
    redisClient: dependencies.redisClient,
    logger: dependencies.logger
  });
  await registerHealthRoute(app);
  await registerMetricsRoute(app);
  await registerFundingRoutes(app, userAuthMiddleware, {
    createIntent: (userId, request) => fundingService.createIntent(userId, request),
    getIntent: (userId, fundingIntentId) => fundingService.getIntent(userId, fundingIntentId),
    quoteIntent: (userId, fundingIntentId) => fundingService.quoteIntent(userId, fundingIntentId),
    submitRouteLeg: (userId, fundingIntentId, request) => fundingService.submitRouteLeg(userId, fundingIntentId, request),
    refreshIntentStatus: (userId, fundingIntentId) => fundingService.refreshIntentStatus(userId, fundingIntentId),
    listVenueCapabilities: async () => fundingService.listVenueCapabilities(),
    listVenueBalances: (userId) => fundingService.listVenueBalances(userId),
    listVenueActivations: async (userId) => buildVenueBalanceActivationActions({
      balances: await fundingService.listVenueBalances(userId),
      venueAccounts: await userVenueAccountService.listAccounts(userId),
      env: process.env
    }),
    preparePolymarketActivation: async (userId) => {
      const account = await userVenueAccountService.getAccount(userId, "POLYMARKET");
      if (account?.status !== "ACTIVE" || !account.venueAccountAddress) {
        throw new FundingError("BALANCE_ACTIVATION_UNAVAILABLE", "An active Polymarket deposit wallet is required before activation.", 409);
      }
      return polymarketDepositWalletClient.prepareActivation({
        ownerAddress: account.walletAddress,
        depositWalletAddress: account.venueAccountAddress
      });
    },
    submitPolymarketActivation: async (userId, request) => {
      const account = await userVenueAccountService.getAccount(userId, "POLYMARKET");
      if (account?.status !== "ACTIVE" || !account.venueAccountAddress) {
        throw new FundingError("BALANCE_ACTIVATION_UNAVAILABLE", "An active Polymarket deposit wallet is required before activation.", 409);
      }
      if (
        account.walletAddress.toLowerCase() !== request.ownerAddress.toLowerCase() ||
        account.venueAccountAddress.toLowerCase() !== request.depositWalletAddress.toLowerCase()
      ) {
        throw new FundingError("BALANCE_ACTIVATION_UNAVAILABLE", "Polymarket activation request does not match the user's active deposit wallet.", 403);
      }
      return polymarketDepositWalletClient.submitActivation(request);
    },
    listFundingHistory: (userId, input) => fundingService.listFundingHistory(userId, input),
    createWithdrawalIntent: (userId, request) => fundingService.createWithdrawalIntent(userId, request),
    getWithdrawalIntent: (userId, withdrawalIntentId) => fundingService.getWithdrawalIntent(userId, withdrawalIntentId),
    quoteWithdrawalIntent: (userId, withdrawalIntentId) => fundingService.quoteWithdrawalIntent(userId, withdrawalIntentId),
    submitWithdrawalRouteLeg: (userId, withdrawalIntentId, request) =>
      fundingService.submitWithdrawalRouteLeg(userId, withdrawalIntentId, request),
    refreshWithdrawalStatus: (userId, withdrawalIntentId) => fundingService.refreshWithdrawalStatus(userId, withdrawalIntentId)
  }, {
    intentCreateRateLimiter: fundingIntentCreateRateLimiter
  });
  await registerExecutionRoutes(app, userAuthMiddleware, {
    executableRouteService,
    sellQuoteService
  });
  await registerMarketCatalogRoutes(app, {
    marketCatalogRepository
  });
  await registerUserWalletRoutes(app, userAuthMiddleware, {
    listWallets: (userId) => userWalletService.listWallets(userId),
    ensureDefaultWallets: (userId, email) => userWalletService.ensureDefaultWallets(userId, email)
  });
  await registerUserVenueAccountRoutes(app, userAuthMiddleware, {
    listAccounts: (userId) => userVenueAccountService.listAccounts(userId),
    getAccount: (userId, venue) => userVenueAccountService.getAccount(userId, venue),
    ensureAccount: (input) => userVenueAccountService.ensureAccount(input),
    prepareAccountSetupBatch: (userId) => userVenueAccountService.prepareAccountSetupBatch(userId),
    completeAccountSetupBatch: (input) => userVenueAccountService.completeAccountSetupBatch(input),
    preparePredictFunAccountAuth: (userId) => userVenueAccountService.preparePredictFunAccountAuth(userId),
    completePredictFunAccountAuth: (input) => userVenueAccountService.completePredictFunAccountAuth(input)
  });
  await registerUserWithdrawalWalletRoutes(app, userAuthMiddleware, {
    listWallets: async (userId) => (await userWalletService.listWallets(userId))
      .filter((wallet) => wallet.chainFamily === "EVM" && wallet.purpose === "WITHDRAWAL_DESTINATION"),
    upsertEvmWallet: (userId, request) => userWalletService.upsertExternalEvmWithdrawalWallet({
      userId,
      address: request.address,
      label: request.label ?? null
    })
  });
  await registerInternalPolymarketFundingBalanceRoute(app, polymarketFundingBalanceReadService, {
    bearerToken: process.env.POLYMARKET_FUNDING_READ_API_KEY,
    nodeEnv: process.env.NODE_ENV
  });
  await registerInternalLimitlessWithdrawalEvidenceRoute(app, internalWithdrawalEvidenceReadService, {
    bearerTokenByVenue: {
      POLYMARKET: process.env.POLYMARKET_WITHDRAWAL_EVIDENCE_API_KEY,
      LIMITLESS: process.env.LIMITLESS_WITHDRAWAL_EVIDENCE_API_KEY,
      OPINION: process.env.OPINION_WITHDRAWAL_EVIDENCE_API_KEY,
      MYRIAD: process.env.MYRIAD_WITHDRAWAL_EVIDENCE_API_KEY,
      PREDICT_FUN: process.env.PREDICT_FUN_WITHDRAWAL_EVIDENCE_API_KEY
    },
    nodeEnv: process.env.NODE_ENV
  });
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
    createExecutionScopeToken: async (sessionId, request) => {
      const session = await sessionRepository.findById(sessionId);
      if (!session) throw new Error("Session not found");

      const quote = await quoteRepository.findByExternalQuoteId(sessionId, request.quoteId);
      if (!quote) throw new Error("Quote not found");

      const authority = executionScopeAuthorities[request.scopeKind];
      if (!authority) {
        throw new ExecutionScopeAuthorityError(`Execution scope kind ${request.scopeKind} is not configured.`);
      }

      const snapshot = await authority.getScopeSnapshot(request.scopeId);
      if (!snapshot) {
        throw new ExecutionScopeAuthorityError(`Execution scope ${request.scopeId} not found.`);
      }
      if (!snapshot.operatorApprovedToOffer) {
        throw new ExecutionScopeAuthorityError(`Execution scope ${request.scopeId} is not currently operator-approved.`);
      }

      const issued = executionScopeTokenService.issue({
        scopeKind: request.scopeKind,
        scopeId: request.scopeId,
        principalId: session.taker_id,
        sessionId,
        quoteId: request.quoteId,
        canonicalMarketId: session.canonical_market_id,
        ttlSeconds: request.ttlSeconds ?? 120,
        scope: {
          topicKey: snapshot.topicKey,
          laneType: snapshot.laneType,
          venueSet: snapshot.venueSet,
          candidateSet: snapshot.candidateSet
        }
      });

      return {
        token: issued.token,
        expiresAt: issued.claims.expiresAt,
        singleUse: true as const,
        scope: {
          scopeKind: snapshot.scopeKind,
          scopeId: snapshot.scopeId,
          topicKey: snapshot.topicKey,
          laneType: snapshot.laneType,
          venueSet: snapshot.venueSet,
          candidateSet: snapshot.candidateSet
        }
      };
    },
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
      if (monetizationPolicy.captureMode !== "DISABLED") {
        const feeService = new ExecutionFeeService({ policy: monetizationPolicy, futureSettlementFee: 0 });
        const preview = feeService.preview({
          executionId: "00000000-0000-0000-0000-000000000000",
          rfqId: session.id,
          userId: session.taker_id,
          canonicalTopicKey: session.canonical_market_id,
          candidateId: session.canonical_market_id,
          side: session.side,
          size: session.quantity,
          selectedLaneId: "RFQ_ACCEPT_PREVIEW",
          venuePath: ["RFQ_ACCEPT_PREVIEW"],
          executionMode: "SINGLE_VENUE",
          approvedScopeHash: session.idempotency_key,
          maxSlippage: 0,
          fastLaneEnabled: false,
          ghostFillProtectionEnabled: true,
          expectedPrice: Number.parseFloat(quote.price),
          expectedFees: {
            policyVersion: monetizationPolicy.policyVersion,
            currency: monetizationPolicy.currency,
            mode: monetizationPolicy.mode,
            priceImprovementFee: 0,
            executionFee: 0,
            fastLaneFee: 0,
            ghostFillProtectionFee: 0,
            futureSettlementFee: 0,
            totalLotusFee: 0,
            notionalCap: 0,
            capApplied: false,
            totalFees: 0
          },
          idempotencyKey: `${session.idempotency_key}:fee-preview`,
          createdAt: new Date().toISOString(),
          metadata: { quoteId: request.quoteId }
        });
        const maxLotusFee = (Number.parseFloat(requestedNotional) * monetizationPolicy.maxTotalFeeBps / 10_000).toFixed(8);
        const disclosureHash = createHash("sha256")
          .update(JSON.stringify({
            rfqId: session.id,
            quoteId: request.quoteId,
            policyVersion: monetizationPolicy.policyVersion,
            maxLotusFee,
            currency: monetizationPolicy.currency
          }))
          .digest("hex");
        await monetizationRepository.upsertPolicy(monetizationPolicy);
        await monetizationRepository.createLedgerEntry({
          idempotencyKey: `${session.id}:quote:${request.quoteId}:${monetizationPolicy.policyVersion}:PREVIEWED`,
          rfqId: session.id,
          quoteId: request.quoteId,
          userId: session.taker_id,
          laneId: "RFQ_ACCEPT_PREVIEW",
          feePolicyVersion: monetizationPolicy.policyVersion,
          feeType: "LOTUS_TOTAL",
          status: "PREVIEWED",
          amount: String(preview.totalLotusFee ?? preview.totalFees),
          currency: monetizationPolicy.currency,
          metadata: { feeSummary: preview, maxLotusFee }
        });
        await monetizationRepository.createAuthorization({
          idempotencyKey: `${session.id}:quote:${request.quoteId}:${monetizationPolicy.policyVersion}`,
          rfqId: session.id,
          quoteId: request.quoteId,
          userId: session.taker_id,
          feePolicyVersion: monetizationPolicy.policyVersion,
          feeDisclosureHash: disclosureHash,
          maxLotusFee,
          maxPassThroughFee: "0",
          currency: monetizationPolicy.currency,
          feeSummary: preview
        });
        await monetizationRepository.createLedgerEntry({
          idempotencyKey: `${session.id}:quote:${request.quoteId}:${monetizationPolicy.policyVersion}:AUTHORIZED`,
          rfqId: session.id,
          quoteId: request.quoteId,
          userId: session.taker_id,
          laneId: "RFQ_ACCEPT_AUTHORIZATION",
          feePolicyVersion: monetizationPolicy.policyVersion,
          feeType: "LOTUS_TOTAL",
          status: "AUTHORIZED",
          amount: maxLotusFee,
          currency: monetizationPolicy.currency,
          metadata: { feeSummary: preview, feeDisclosureHash: disclosureHash }
        });
      }
      const canonicalIdentity = await resolveCanonicalIdentity(
        dependencies.pgPool,
        session.canonical_market_id
      );
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

      const routeGeneratedAt = new Date();
      const baseExecutionRequest = {
        canonicalEventId: canonicalIdentity.canonicalEventId,
        canonicalExecutableMarketId: canonicalIdentity.canonicalMarketId,
        userWalletReference: {
          principalId: session.taker_id,
          walletRef: null
        },
        requestedSize: session.quantity,
        requestedNotional,
        configVersion: "execution-control-v1",
        engineVersion: "execution-infra-v2",
        routeFreshnessMetadata: {
          routeGeneratedAt,
          quoteObservedAt: quote.created_at ?? routeGeneratedAt,
          quoteValidUntil: quote.valid_until,
          marketStateObservedAt: routeGeneratedAt,
          compatibilityEvaluatedAt: routeGeneratedAt,
          approvalGrantedAt: routeGeneratedAt,
          maxRouteAgeMs: 30_000,
          maxQuoteAgeMs: 30_000,
          maxMarketStateAgeMs: 30_000,
          maxCompatibilityAgeMs: 60_000,
          maxApprovalAgeMs: 300_000
        },
        approvalRequirements: {
          required: false,
          approvalGrantedAt: routeGeneratedAt,
          approvalContextVersion: "server-rfq-accept-v1",
          approvalActorRef: session.taker_id
        },
        idempotencyKey: `${session.idempotency_key}:execution-control`,
        metadata: {
          sessionId,
          quoteId: request.quoteId,
          executionSide: session.side,
          expectedPrice: Number.parseFloat(quote.price),
          maxSlippage: 0,
          fastLaneEnabled: false,
          ghostFillProtectionEnabled: true
        },
        policyContext: {
          routeTypeAllowed: true,
          venuesAllowed: true,
          compatibilityAllowed: true,
          settlementAllowed: true,
          killSwitchActive: false,
          accountAllowed: true,
          scopeAllowed: true,
          rolloutAllowed: true
        }
      } satisfies Omit<
        ExecutionControlRequest,
        | "routePlanId"
        | "venueTargets"
        | "compatibilityReferences"
        | "routeType"
        | "submissionKind"
        | "submissionPayload"
        | "routeSelectionTraceId"
        | "replayEnvelopeId"
      >;

      const toPlanAcceptedResponse = (
        planId: string,
        dispatchMode: "awaited" | "background",
        finalStatus?: "COMPLETED" | "PARTIAL" | "FAILED" | "UNWOUND"
      ) => ({
        status: "PLAN_ACCEPTED" as const,
        plan_id: planId,
        plan_state: "DRAFT" as const,
        dispatch_mode: dispatchMode,
        ...(finalStatus ? { final_status: finalStatus } : {})
      });

      if (buildResult.kind === "internal_filled") {
        const outcome = await executionControlGateway.execute({
          ...baseExecutionRequest,
          routePlanId: null,
          venueTargets: ["INTERNAL_CROSS"],
          compatibilityReferences: {
            decisionIds: buildResult.compatibilityDecisionIds ?? [],
            versionIds: buildResult.compatibilityVersionIds ?? [],
            compatibilityClass: "SAFE_EQUIVALENT"
          },
          routeType: "INTERNAL_CROSS",
          routeSelectionTraceId: buildResult.routeSelectionTraceId ?? null,
          replayEnvelopeId: buildResult.replayEnvelopeId ?? null,
          submissionKind: "INTERNAL_CROSS",
          submissionPayload: {
            sessionId,
            reservationToken,
            filledSize: buildResult.filledSize,
            trades: buildResult.trades
          }
        });
        if (outcome.status === "FAILED" || outcome.status === "BLOCKED") {
          throw new Error(`execution_control_blocked:${outcome.rationale.join(",")}`);
        }
        return {
          status: "PLAN_ACCEPTED" as const,
          plan_id: `internal-${sessionId}`,
          plan_state: "COMPLETED" as const,
          dispatch_mode: "awaited" as const,
          final_status: "COMPLETED" as const,
          execution_id: outcome.executionRecordId
        };
      }

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
      const shouldAwait =
        acceptancePolicy === "ALL_OR_NONE"
          ? dependencies.sorAcceptAonAwait
          : !dependencies.sorAcceptNonAonBackground;
      const executionRequest: ExecutionControlRequest =
        sorEnabled
          ? {
              ...baseExecutionRequest,
              routePlanId: buildResult.plan.id,
              venueTargets: [...new Set(buildResult.plan.steps.map((step) => step.providerId))],
              compatibilityReferences: {
                decisionIds: buildResult.compatibilityDecisionIds ?? [],
                versionIds: buildResult.compatibilityVersionIds ?? [],
                compatibilityClass: "SAFE_EQUIVALENT"
              },
              routeType: "SOR_PLAN",
              routeSelectionTraceId: buildResult.routeSelectionTraceId ?? null,
              replayEnvelopeId: buildResult.replayEnvelopeId ?? null,
              submissionKind: "SOR_PLAN",
              submissionPayload: {
                sessionId,
                plan: buildResult.plan,
                acceptancePolicy,
                awaitExecution: shouldAwait
              }
            }
          : {
              ...baseExecutionRequest,
              routePlanId: null,
              venueTargets: rankedQuotes.flatMap((entry) => (entry.lpId ? [entry.lpId] : [])),
              compatibilityReferences: {
                decisionIds: [],
                versionIds: []
              },
              routeType: "LEGACY_EXECUTION",
              routeSelectionTraceId: null,
              replayEnvelopeId: null,
              submissionKind: "LEGACY_RFQ",
              submissionPayload: {
                sessionId,
                rankedQuotes,
                reservationToken
              }
            };

      const validatedScope = request.executionScopeToken
        ? await executionScopeTokenService.validate({
            token: request.executionScopeToken,
            principalId: session.taker_id,
            sessionId,
            quoteId: request.quoteId,
            canonicalMarketId: session.canonical_market_id,
            actualVenueTargets: executionRequest.venueTargets,
            authorities: executionScopeAuthorities
          })
        : null;

      if (validatedScope) {
        executionRequest.executionScopeBinding = validatedScope.binding;
        executionRequest.metadata = {
          ...(executionRequest.metadata ?? {}),
          executionScopeTokenRef: `${validatedScope.binding.scopeKind}:${validatedScope.binding.scopeId}`,
          executionScopeTopicKey: validatedScope.binding.topicKey,
          executionScopeLaneType: validatedScope.binding.laneType,
          executionScopeVenueSet: validatedScope.binding.venueSet,
          executionScopeCandidateSet: validatedScope.binding.candidateSet
        };
      }

      const outcome = await executionControlGateway.execute(executionRequest);
      if (
        dependencies.executionSystemSandboxEnabled
        && validatedScope
        && outcome.status === "FAILED"
      ) {
        return sorEnabled && buildResult.kind === "plan_created"
          ? {
              ...toPlanAcceptedResponse(
                buildResult.plan.id,
                shouldAwait ? "awaited" : "background",
                "FAILED"
              ),
              execution_id: outcome.executionRecordId
            }
          : {
              status: "PLAN_ACCEPTED" as const,
              plan_id: `legacy-${sessionId}`,
              plan_state: "LEGACY_EXECUTED" as const,
              dispatch_mode: "awaited" as const,
              final_status: "FAILED" as const,
              execution_id: outcome.executionRecordId
            };
      }
      if (outcome.status === "FAILED" || outcome.status === "BLOCKED" || outcome.status === "RECONCILING") {
        throw new Error(`execution_control_failed:${outcome.rationale.join(",")}`);
      }
      const authoritativeResponse = !sorEnabled
        ? {
          status: "PLAN_ACCEPTED" as const,
          plan_id: `legacy-${sessionId}`,
          plan_state: "LEGACY_EXECUTED" as const,
          dispatch_mode: "awaited" as const,
          final_status: outcome.status === "SUBMITTED" ? ("COMPLETED" as const) : ("FAILED" as const),
          execution_id: outcome.executionRecordId
        }
        : {
            ...toPlanAcceptedResponse(
            buildResult.plan.id,
            shouldAwait ? "awaited" : "background",
            shouldAwait ? "COMPLETED" : undefined
            ),
            execution_id: outcome.executionRecordId
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

      if (isShadowSampled) {
        void runShadowComparison(sorEnabled ? "sor_authoritative" : "legacy_authoritative");
      }
      return authoritativeResponse;
    },
    getExecutionStatus: async (_sessionId, executionId) => {
      const record = await executionRecordRepository.findById(executionId);
      if (!record) {
        return null;
      }
      const candidate = (record.metadata as Record<string, unknown>).executionSystemV0;
      const parsed = ExecutionSystemMetadataSchema.safeParse(candidate);
      if (!parsed.success) {
        return {
          executionId: record.id,
          currentState: record.executionState,
          userStatus: record.executionState === "SETTLED" ? "completed" : "preparing route",
          venuePath: [record.venue],
          filledAmount: "0",
          settlementStatus: record.settlementStatus,
          ghostFillStatus: "NOT_APPLICABLE",
          fallbackStatus: "not_used",
          feeSummary: {},
          adapterStatus: [{
            venue: record.venue,
            legStatus: record.executionState,
            settlementStatus: record.settlementStatus
          }],
          receipt: null
        };
      }
      return buildFrontendExecutionStatus(parsed.data);
    }
  });
  const adminAuthMiddleware = createAdminAuthMiddleware();
  const adminOwnerAuthMiddleware = createAdminOwnerAuthMiddleware();
  const simulationPreviewAdminMiddleware = createAdminSimulationPreviewMiddleware({
    enabled: dependencies.devSimulationPreviewEnabled ?? false
  });
  const fundingReadinessAdminService = new FundingReadinessAdminService({
    repository: fundingRepository,
    env: process.env
  });
  await registerAdminAuthRoutes(app, adminAuthMiddleware, {
    adminAuthService,
    rateLimiter: adminAuthRateLimiter,
    ownerMiddleware: adminOwnerAuthMiddleware,
    jwtTtlSeconds: parseAdminJwtTtlSeconds(process.env.ADMIN_JWT_TTL_SECONDS)
  });
  await registerAdminOpsRoutes(app, adminAuthMiddleware, {
    executionIntentRepository,
    executionRecordRepository,
    executionControlRepository,
    fundingReadinessAdminService,
    executionVenuesAdminService
  });
  await registerAdminTradeReadinessRoutes(app, adminAuthMiddleware, {
    executionVenuesAdminService
  });
  await registerAdminMonetizationRoutes(app, adminAuthMiddleware, {
    monetizationRepository
  });
  await registerAdminSchemaMapRoutes(app, adminAuthMiddleware, {
    schemaMapService: new SchemaMapService(dependencies.pgPool)
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
  await registerAdminPairMatchReviewRoutes(app, adminAuthMiddleware, {
    pairMatchReviewService: new PairMatchReviewService(new PairEdgeRepository(dependencies.pgPool))
  });
  await registerAdminExecutionControlRoutes(app, adminAuthMiddleware, {
    executionIntentRepository,
    executionRecordRepository,
    executionControlRepository
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
  const pairRouteAdminService = new PairRouteAdminService({
    pool: dependencies.pgPool,
    shadowPool: pairShadowPool,
    logger: dependencies.logger,
  });
  await registerAdminPairRolloutRoutes(app, adminAuthMiddleware, {
    pairRouteAdminService
  });
  await registerAdminPairQualificationRoutes(app, adminAuthMiddleware, {
    pairRouteAdminService
  });
  await registerAdminPairShadowRoutes(app, adminAuthMiddleware, {
    pairRouteAdminService
  });
  await registerAdminPairPromotionRoutes(app, adminAuthMiddleware, {
    pairRouteAdminService
  });
  await registerAdminPoliticsNomineeRoutes(app, adminAuthMiddleware, {
    politicsNomineeAdminService
  });
  await registerAdminPoliticsOfficeWinnerRoutes(app, adminAuthMiddleware, {
    politicsOfficeWinnerAdminService
  });
  await registerAdminPoliticsPartyControlRoutes(app, adminAuthMiddleware, {
    politicsPartyControlAdminService
  });
  await registerAdminPoliticsOfficeExitRoutes(app, adminAuthMiddleware, {
    politicsOfficeExitAdminService
  });
  await registerAdminPoliticsGeopoliticalRoutes(app, adminAuthMiddleware, {
    politicsGeopoliticalAdminService
  });
  await registerAdminSportsRoutes(app, adminAuthMiddleware, {
    sportsAdminService
  });
  await registerAdminCryptoRoutes(app, adminAuthMiddleware, {
    cryptoAdminService
  });
  await registerAdminExecutionVenuesRoutes(app, adminAuthMiddleware, {
    executionVenuesAdminService
  });
  await registerAdminFundingReadinessRoutes(app, adminAuthMiddleware, {
    fundingReadinessAdminService
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

const resolveCanonicalIdentity = async (
  pool: Pool,
  canonicalMarketId: string
): Promise<{
  canonicalEventId: string | null;
  canonicalMarketId: string;
}> => {
  const result = await pool.query<{ canonical_event_id: string; canonical_market_id: string }>(
    `SELECT canonical_event_id::text, canonical_market_id
       FROM resolution_profiles
      WHERE canonical_market_id = $1
      LIMIT 1`,
    [canonicalMarketId]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      canonicalEventId: null,
      canonicalMarketId
    };
  }

  return {
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id
  };
};

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
