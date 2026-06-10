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
import { buildLiveExecutionCandidatesResponse, registerExecutionRoutes } from "./routes/execution.js";
import { registerTurnkeyAuthRoutes } from "./routes/turnkey-auth.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerMarketCatalogRoutes } from "./routes/markets.js";
import {
  calculateOrderbookStreamChecksum,
  ORDERBOOK_STREAM_SCHEMA_VERSION,
  parseMarketOrderbookTopic
} from "../services/orderbook-stream.service.js";
import {
  RedisMarketCatalogSnapshotCache,
  resolveMarketCatalogSnapshotCacheKeyPrefix
} from "../services/market-catalog-snapshot-cache.js";
import { MarketCatalogSnapshotMaterializer } from "../services/market-catalog-snapshot-materializer.js";
import { HotMarketQuoteReadinessSource } from "../services/hot-market-quote-readiness.service.js";
import {
  RedisMarketOrderbookLiveCache,
  resolveMarketOrderbookLiveCacheNamespace
} from "../services/market-orderbook-live-cache.js";
import {
  buildVenueBalanceActivationActions,
  hasPolymarketActivationApprovalSpender
} from "../core/funding/venue-activation.js";
import { registerUserWithdrawalWalletRoutes } from "./routes/user-withdrawal-wallets.js";
import { registerUserWalletRoutes, toSafeWallet } from "./routes/user-wallets.js";
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
import { registerAdminTriMatchReviewRoutes } from "./admin/tri-match-review.routes.js";
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
import {
  CompositeVenueQuoteSource,
  CostModel,
  OrderRouter,
  PlanComposer,
  PlanRunner,
  QuoteSnapshotCache,
  RouteScout,
  SharedCoreVenueQuoteMappingResolver,
  Splitter,
  type SORAcceptancePolicy,
  type CanonicalRFQInput
} from "../core/sor/index.js";
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
import { withLatencyStage } from "../observability/latency.js";
import { withSpan } from "../observability/tracing.js";
import { LimitlessQuoteReader, LimitlessRestOrderbookClient } from "../integrations/limitless/limitless-quote-reader.js";
import { LimitlessProfileFeeReader } from "../integrations/limitless/limitless-fee-reader.js";
import { PolymarketClobFeeReader } from "../integrations/polymarket/polymarket-fee-reader.js";
import { PolymarketQuoteReader, PolymarketRestOrderbookClient } from "../integrations/polymarket/polymarket-quote-reader.js";
import { PolymarketGammaClient } from "../integrations/polymarket/polymarket-gamma-client.js";
import { LimitlessHistoricalClient } from "../integrations/limitless/limitless-client.js";
import { PredictClient } from "../integrations/predict/predict-client.js";
import { PredictQuoteReader } from "../integrations/predict/predict-quote-reader.js";
import {
  createOpinionOrderbookClient,
  resolveOpinionOrderbookApiKeys
} from "../integrations/opinion/opinion-orderbook-client.js";
import { OpinionQuoteReader } from "../integrations/opinion/opinion-quote-reader.js";
import { MyriadClient } from "../integrations/myriad/myriad-client.js";
import { MyriadQuoteReader } from "../integrations/myriad/myriad-quote-reader.js";
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
import { HistoricalMarketStateRepository } from "../repositories/historical-market-state.repository.js";
import {
  DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS,
  VenueOrderbookSnapshotRepository
} from "../repositories/venue-orderbook-snapshot.repository.js";
import { UserWalletRepository } from "../repositories/user-wallet.repository.js";
import { UserVenueAccountRepository } from "../repositories/user-venue-account.repository.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { CompatibilityOverrideService } from "../canonical/compatibility-override-service.js";
import { PairMatchReviewService } from "./admin/pair-match-review-service.js";
import { TriMatchReviewService } from "./admin/tri-match-review-service.js";
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
  SignedTradeBundleService,
  ExecutionOrderOrchestratorV1,
  TestExecutionAdapter,
  alwaysHealthyPreflightDeps
} from "../execution-system/index.js";
import { MonetizationRepository } from "../repositories/monetization.repository.js";
import { FundingReadinessChecker, FundingService } from "../core/funding/funding-service.js";
import { FundingError, type VenueBalanceView } from "../core/funding/types.js";
import {
  PolymarketFundingBalanceReadService,
  buildPolymarketFundingBalanceReadConfigFromEnv,
  type PolymarketFundingBalanceReadOutput
} from "../core/funding/polymarket-balance-read-service.js";
import {
  PolymarketClobReadinessSyncService,
  buildPolymarketClobReadinessPreparation,
  buildPolymarketClobReadinessSyncConfigFromEnv
} from "../core/funding/polymarket-clob-readiness-sync.js";
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
import { buildOpinionBuilderAccountClientFromEnv } from "../integrations/opinion/opinion-builder-account-client.js";
import {
  buildPolymarketDepositWalletClientConfigFromEnv,
  PolymarketDepositWalletClient
} from "../integrations/polymarket/polymarket-deposit-wallet-client.js";
import { UserWalletService } from "../core/funding/user-wallets.js";
import { buildUserWalletBalanceReaderFromEnv } from "../core/funding/user-wallet-balances.js";
import { UserVenueAccountService } from "../core/execution/user-venue-accounts.js";
import { toSafeVenueAccount } from "../core/execution/user-venue-accounts.js";
import {
  ExecutableRouteService,
  SellQuoteService
} from "../execution-system/executable-routing.js";
import {
  buildExecutionStatusWatcherConfigFromEnv,
  ExecutionStatusWatcher,
  executionPortfolioTopic,
  executionPositionsTopic,
  executionQuoteTopic,
  executionUserTopic,
  notificationUserTopic
} from "../execution-system/execution-status-watcher.js";
import {
  PgExecutionQuoteRepository,
  PgExecutionOrderRepository,
  PgSignedTradePositionRecorder,
  PgSignedTradeExecutionStatusRepository,
  PgVerifiedPositionRepository
} from "../repositories/execution-routing.repository.js";
import { PgNotificationRepository } from "../repositories/notification.repository.js";
import { MarketCatalogRepository, SharedCoreQuoteMappingRepository } from "../repositories/market-catalog.repository.js";
import { LiveMarketDataViewService, type MarketOrderbookResponse } from "../services/market-data-view.service.js";
import { HotQuoteSnapshotService, resolveHotQuoteRedisNamespace } from "../services/hot-quote-snapshot.service.js";
import {
  buildMarketOrderbookRecorderConfigs,
  MarketOrderbookRecorder,
  resolveMarketOrderbookRecorderDutyProfile
} from "../services/market-orderbook-recorder.service.js";
import {
  buildFundingReadinessWatcherConfigFromEnv,
  FundingReadinessWatcher
} from "../core/funding/funding-readiness-watcher.js";
import {
  buildFundingIntentCleanupConfigFromEnv,
  FundingIntentCleanupWatcher
} from "../core/funding/funding-intent-cleanup.js";

const isPolymarketCLOBTradeReadySource = (source: string | null | undefined): boolean =>
  source === "CLOB_COLLATERAL_ALLOWANCE" || source === "USER_CLOB_SYNC_CONFIRMED";

const hasPolymarketCLOBTradeReadyBalance = (
  source: string | null | undefined,
  amount: string | null | undefined
): boolean => isPolymarketCLOBTradeReadySource(source) && isPositiveAmount(amount);

// Display-only fallback: execution still performs live CLOB readiness checks before submit.
const POLYMARKET_CLOB_SYNC_CONFIRMATION_MAX_AGE_MS = 60 * 60 * 1000;
const POLYMARKET_CLOB_SYNC_CONFIRMATION_DISPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const isPositiveAmount = (value: string | null | undefined): boolean => {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const minAmountString = (left: string, right: string): string => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return left;
  }
  return String(Math.min(leftNumber, rightNumber));
};

const isRecentPolymarketClobSyncConfirmation = (
  confirmedAt: string,
  now = Date.now(),
  maxAgeMs = POLYMARKET_CLOB_SYNC_CONFIRMATION_MAX_AGE_MS
): boolean => {
  const timestamp = Date.parse(confirmedAt);
  return Number.isFinite(timestamp) && now - timestamp <= maxAgeMs;
};

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
  runtimeMode?: "api" | "worker";
}

const parseAdminJwtTtlSeconds = (value: string | undefined): number => {
  const parsed = Number(value ?? "3600");
  return Number.isFinite(parsed) && parsed >= 300 && parsed <= 86_400 ? Math.trunc(parsed) : 3600;
};

const parseUserJwtTtlSeconds = (value: string | undefined): number => {
  const parsed = Number(value ?? "86400");
  return Number.isFinite(parsed) && parsed >= 300 && parsed <= 2_592_000 ? Math.trunc(parsed) : 86_400;
};

const parseAdminMagicLinkTtlSeconds = (value: string | undefined): number => {
  const parsed = Number(value ?? "900");
  return Number.isFinite(parsed) && parsed >= 60 && parsed <= 3600 ? Math.trunc(parsed) : 900;
};

const DEFAULT_POLYMARKET_VENUE_BALANCE_READ_TIMEOUT_MS = 2_500;
const VENUE_BALANCE_READ_TIMEOUT = Symbol("VENUE_BALANCE_READ_TIMEOUT");
const LOTUS_FASTIFY_MAX_PARAM_LENGTH = 2_048;

export const buildServer = async (dependencies: ServerDependencies): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false,
    routerOptions: {
      maxParamLength: LOTUS_FASTIFY_MAX_PARAM_LENGTH
    }
  });
  const runtimeMode = dependencies.runtimeMode ?? "api";
  const backgroundWorkersEnabled = runtimeMode === "worker";
  const workerOnly = runtimeMode === "worker";
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
  const executionOrderRepository = new PgExecutionOrderRepository(dependencies.pgPool);
  const verifiedPositionRepository = new PgVerifiedPositionRepository(dependencies.pgPool);
  const signedTradeExecutionStatusRepository = new PgSignedTradeExecutionStatusRepository(dependencies.pgPool);
  const signedTradePositionRecorder = new PgSignedTradePositionRecorder(dependencies.pgPool);
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
  const userWalletBalanceReader = buildUserWalletBalanceReaderFromEnv(process.env);
  const polymarketDepositWalletClient = new PolymarketDepositWalletClient(
    buildPolymarketDepositWalletClientConfigFromEnv(process.env)
  );
  const userVenueAccountService = new UserVenueAccountService(
    userVenueAccountRepository,
    userWalletService,
    buildPredictAccountClientFromEnv(process.env),
    buildLimitlessPartnerAccountClientFromEnv(process.env),
    polymarketDepositWalletClient,
    buildOpinionBuilderAccountClientFromEnv(process.env)
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
  if (backgroundWorkersEnabled) {
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
  }
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
  const polymarketClobReadinessSyncConfig = buildPolymarketClobReadinessSyncConfigFromEnv(process.env);
  const polymarketClobReadinessSyncService = new PolymarketClobReadinessSyncService(polymarketClobReadinessSyncConfig);
  const readPolymarketUsableBalanceForUser = async (input: {
    userId: string;
    fundingIntentId: string;
    routeLegId: string;
  }): Promise<PolymarketFundingBalanceReadOutput> => {
    const confirmation = await userVenueAccountService.getLatestPolymarketClobReadinessConfirmation(input.userId);
    const freshConfirmation = confirmation && isRecentPolymarketClobSyncConfirmation(confirmation.confirmedAt)
      ? confirmation
      : null;
    let balance: PolymarketFundingBalanceReadOutput;
    try {
      balance = await polymarketFundingBalanceReadService.readUsableBalance(input);
    } catch (error) {
      if (!freshConfirmation || !isPositiveAmount(freshConfirmation.readyAmount)) {
        throw error;
      }
      return {
        usableBalance: freshConfirmation.readyAmount,
        collateralBalance: freshConfirmation.clobCollateralBalance,
        collateralAllowance: freshConfirmation.clobCollateralAllowance,
        clobAllowanceSpenders: freshConfirmation.clobAllowanceSpenders,
        approvalSpenderSource: freshConfirmation.clobAllowanceSpenders.length > 0 ? "CLOB_ALLOWANCE_MAP" : "UNAVAILABLE",
        onchainPusdBalance: null,
        onchainPusdAllowance: null,
        bridgedUsdcBalance: null,
        usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED"
      };
    }
    if (hasPolymarketCLOBTradeReadyBalance(balance.usableBalanceSource, balance.usableBalance)) {
      return balance;
    }
    if (!freshConfirmation || !isPositiveAmount(freshConfirmation.readyAmount)) {
      return balance;
    }
    const boundedLiveAmount =
      balance.usableBalanceSource === "ONCHAIN_CLOB_SPENDER_ALLOWANCE" && isPositiveAmount(balance.usableBalance)
        ? balance.usableBalance
        : isPositiveAmount(balance.onchainPusdBalance) && isPositiveAmount(balance.onchainPusdAllowance)
          ? minAmountString(balance.onchainPusdBalance ?? "0", balance.onchainPusdAllowance ?? "0")
          : freshConfirmation.readyAmount;
    const usableBalance = minAmountString(boundedLiveAmount, freshConfirmation.readyAmount);
    if (!isPositiveAmount(usableBalance)) {
      return balance;
    }
    return {
      ...balance,
      usableBalance,
      collateralBalance: freshConfirmation.clobCollateralBalance,
      collateralAllowance: freshConfirmation.clobCollateralAllowance,
      clobAllowanceSpenders: freshConfirmation.clobAllowanceSpenders.length > 0
        ? freshConfirmation.clobAllowanceSpenders
        : balance.clobAllowanceSpenders,
      usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED"
    };
  };
  const readRecentPolymarketClobConfirmationBalanceForUser = async (
    userId: string,
    maxAgeMs = POLYMARKET_CLOB_SYNC_CONFIRMATION_MAX_AGE_MS
  ): Promise<PolymarketFundingBalanceReadOutput | null> => {
    const confirmation = await userVenueAccountService.getLatestPolymarketClobReadinessConfirmation(userId);
    if (
      !confirmation ||
      !isRecentPolymarketClobSyncConfirmation(confirmation.confirmedAt, Date.now(), maxAgeMs) ||
      !isPositiveAmount(confirmation.readyAmount)
    ) {
      return null;
    }
    return {
      usableBalance: confirmation.readyAmount,
      collateralBalance: confirmation.clobCollateralBalance,
      collateralAllowance: confirmation.clobCollateralAllowance,
      clobAllowanceSpenders: confirmation.clobAllowanceSpenders,
      approvalSpenderSource: confirmation.clobAllowanceSpenders.length > 0 ? "CLOB_ALLOWANCE_MAP" : "UNAVAILABLE",
      onchainPusdBalance: null,
      onchainPusdAllowance: null,
      bridgedUsdcBalance: null,
      usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED"
    };
  };
  const buildPolymarketVenueBalanceView = (
    polymarket: PolymarketFundingBalanceReadOutput,
    balances: readonly VenueBalanceView[],
    freshness: "live" | "stale"
  ): VenueBalanceView => {
    const sourceReady = hasPolymarketCLOBTradeReadyBalance(
      polymarket.usableBalanceSource,
      polymarket.usableBalance
    );
    const usableAmount = sourceReady ? polymarket.usableBalance : "0";
    const pendingWithdrawalAmount = balances.find((balance) =>
      balance.venue === "POLYMARKET" && balance.token.toUpperCase() === "USDC"
    )?.pendingWithdrawalAmount ?? "0";
    const usable = Number(usableAmount);
    const pending = Number(pendingWithdrawalAmount);
    const availableAmount = Number.isFinite(usable) && Number.isFinite(pending)
      ? String(Math.max(usable - pending, 0))
      : usableAmount;
    return {
      venue: "POLYMARKET",
      token: "USDC",
      readyAmount: usableAmount,
      pendingWithdrawalAmount,
      availableAmount,
      updatedAt: new Date().toISOString(),
      balanceSource: polymarket.usableBalanceSource === "USER_CLOB_SYNC_CONFIRMED"
        ? "POLYMARKET_CLOB_SYNC_CONFIRMED"
        : "POLYMARKET_CLOB_READ",
      balanceFreshness: freshness,
      readinessReason: sourceReady
        ? "POLYMARKET_CLOB_COLLATERAL_CONFIRMED"
        : polymarket.usableBalanceSource === "ONCHAIN_CLOB_SPENDER_ALLOWANCE"
          ? "POLYMARKET_CLOB_SYNC_PENDING"
          : polymarket.usableBalanceSource === "ONCHAIN_PUSD_ALLOWANCE"
          ? "POLYMARKET_CLOB_APPROVAL_REQUIRED"
          : "POLYMARKET_CLOB_COLLATERAL_NOT_READY",
      usableBalanceSource: polymarket.usableBalanceSource,
      approvalSpenderSource: polymarket.approvalSpenderSource
    };
  };
  const applyPolymarketClobConfirmationActivation = (
    polymarket: ReturnType<typeof buildVenueBalanceActivationActions>[number],
    balance: PolymarketFundingBalanceReadOutput,
    freshness: "live" | "stale"
  ): void => {
    polymarket.clobCollateralBalance = balance.collateralBalance;
    polymarket.clobCollateralAllowance = balance.collateralAllowance;
    polymarket.clobAllowanceSpenders = balance.clobAllowanceSpenders;
    polymarket.approvalSpenderSource = balance.approvalSpenderSource;
    polymarket.activationRequired = false;
    polymarket.mode = "NOT_REQUIRED";
    polymarket.status = "NOT_REQUIRED";
    polymarket.tokenSymbol = "pUSD";
    polymarket.readinessReason = "POLYMARKET_CLOB_COLLATERAL_CONFIRMED";
    polymarket.instructions = [
      freshness === "live"
        ? "Polymarket CLOB collateral is confirmed and available for live routes."
        : "Polymarket CLOB collateral was recently confirmed and is available for live routes."
    ];
    polymarket.blockers = [];
  };
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

  const polymarketQuoteCache = new QuoteSnapshotCache();
  const limitlessQuoteCache = new QuoteSnapshotCache();
  const predictQuoteCache = new QuoteSnapshotCache();
  const opinionQuoteCache = new QuoteSnapshotCache();
  const myriadQuoteCache = new QuoteSnapshotCache();
  const hotQuoteMemoryCache = new QuoteSnapshotCache();
  const venueOrderbookSnapshotRepository = new VenueOrderbookSnapshotRepository(dependencies.pgPool);
  const hotQuoteSnapshots = new HotQuoteSnapshotService({
    memoryCache: hotQuoteMemoryCache,
    redis: dependencies.redisClient,
    dbFallback: venueOrderbookSnapshotRepository,
    logger: dependencies.logger,
    config: {
      redisNamespace: resolveHotQuoteRedisNamespace({
        LOTUS_DEPLOY_ENV: process.env.LOTUS_DEPLOY_ENV,
        LOTUS_ENV: process.env.LOTUS_ENV,
        APP_ENV: process.env.APP_ENV,
        NODE_ENV: process.env.NODE_ENV
      })
    }
  });
  const sharedCoreQuoteMappingResolver = new SharedCoreVenueQuoteMappingResolver(
    new SharedCoreQuoteMappingRepository(dependencies.pgPool)
  );
  await warmQuoteMappingReadinessOnce(
    sharedCoreQuoteMappingResolver,
    dependencies.logger,
    "startup",
    QUOTE_MAPPING_READINESS_STARTUP_WARMUP_TIMEOUT_MS
  );
  const stopQuoteMappingReadinessWarmup = startQuoteMappingReadinessWarmup(
    sharedCoreQuoteMappingResolver,
    dependencies.logger
  );
  app.addHook("onClose", async () => {
    stopQuoteMappingReadinessWarmup();
  });
  const marketOrderbookLiveCache = new RedisMarketOrderbookLiveCache(dependencies.redisClient, {
    namespace: resolveMarketOrderbookLiveCacheNamespace({
      LOTUS_DEPLOY_ENV: process.env.LOTUS_DEPLOY_ENV,
      LOTUS_ENV: process.env.LOTUS_ENV,
      APP_ENV: process.env.APP_ENV,
      NODE_ENV: process.env.NODE_ENV
    }),
    ttlMs: 30_000,
    maxSnapshotsPerTopic: 16
  });
  const marketQuoteReadinessSource = new HotMarketQuoteReadinessSource({
    mappingResolver: sharedCoreQuoteMappingResolver,
    hotSnapshots: hotQuoteSnapshots,
    fallbackSource: venueOrderbookSnapshotRepository,
    logger: app.log,
    config: {
      maxAgeMs: DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS
    }
  });
  const polymarketClobHost = process.env.POLYMARKET_CLOB_HOST ?? process.env.POLY_CLOB_HOST ?? "https://clob.polymarket.com";
  const polymarketGammaBaseUrl = process.env.POLYMARKET_GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com";
  const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";
  const venueQuoteSource = new CompositeVenueQuoteSource([
    new PolymarketQuoteReader({
      client: new PolymarketRestOrderbookClient({
        clobHost: polymarketClobHost
      }),
      streamCache: polymarketQuoteCache,
      feeBps: parseOptionalNumber(process.env.POLYMARKET_QUOTE_FEE_BPS),
      feeReader: new PolymarketClobFeeReader({ clobHost: polymarketClobHost }),
      metadataClient: new PolymarketGammaClient({
        baseUrl: polymarketGammaBaseUrl,
        clobHost: polymarketClobHost
      })
    }),
    new LimitlessQuoteReader({
      client: new LimitlessRestOrderbookClient({
        baseUrl: limitlessBaseUrl
      }),
      streamCache: limitlessQuoteCache,
      feeBps: parseOptionalNumber(process.env.LIMITLESS_QUOTE_FEE_BPS),
      feeReader: new LimitlessProfileFeeReader({
        baseUrl: limitlessBaseUrl,
        apiKey: process.env.LIMITLESS_API_KEY,
        hmacTokenId: process.env.LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
        hmacSecret: process.env.LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
        account: process.env.LIMITLESS_QUOTE_FEE_PROFILE_ACCOUNT ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS
      })
    }),
    new PredictQuoteReader({
      client: new PredictClient({
        environment: process.env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet",
        ...(process.env.PREDICT_MAINNET_BASE_URL ? { baseUrl: process.env.PREDICT_MAINNET_BASE_URL } : {}),
        ...(process.env.PREDICT_API_KEY ? { apiKey: process.env.PREDICT_API_KEY } : {}),
        logger: dependencies.logger
      }),
      streamCache: predictQuoteCache,
      environment: process.env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet",
      feeBps: parseOptionalNumber(process.env.PREDICT_QUOTE_FEE_BPS)
    }),
    new OpinionQuoteReader({
      client: createOpinionOrderbookClient({
        baseUrl: process.env.OPINION_OPENAPI_BASE_URL ?? process.env.OPINION_CLOB_BASE_URL ?? "https://openapi.opinion.trade/openapi",
        apiKeys: resolveOpinionOrderbookApiKeys(process.env),
        requestTimeoutMs: parseOptionalNumber(process.env.OPINION_QUOTE_TIMEOUT_MS) ?? 1_500,
        logger: dependencies.logger
      }),
      streamCache: opinionQuoteCache,
      topicRate: parseOptionalNumber(process.env.OPINION_QUOTE_TOPIC_RATE),
      feeBps: parseOptionalNumber(process.env.OPINION_QUOTE_FEE_BPS)
    }),
    new MyriadQuoteReader({
      client: new MyriadClient({
        baseUrl: process.env.MYRIAD_BASE_URL ?? "https://api-v2.myriadprotocol.com/",
        ...(process.env.MYRIAD_API_KEY ? { apiKey: process.env.MYRIAD_API_KEY } : {}),
        logger: dependencies.logger
      }),
      streamCache: myriadQuoteCache
    })
  ], sharedCoreQuoteMappingResolver, () => new Date(), hotQuoteSnapshots, {
    readerTimeoutMs: 1_500,
    perVenueReaderTimeoutMs: {
      LIMITLESS: 1_500,
      OPINION: 1_500,
      POLYMARKET: 1_500,
      PREDICT_FUN: 1_500
    }
  });
  const historicalMarketStateRepository = new HistoricalMarketStateRepository(dependencies.pgPool);
  const marketDataViewService = new LiveMarketDataViewService(venueQuoteSource, {
    liveOrderbookSource: marketOrderbookLiveCache,
    historicalChartSource: {
      listChartPoints: async (input) => {
        // API chart reads must stay storage-backed. Live venue history fetches belong
        // in sync/worker jobs so terminal loads do not block on upstream venues.
        const results = await Promise.allSettled([
          venueOrderbookSnapshotRepository.listChartPoints(input),
          historicalMarketStateRepository.listChartPoints(input)
        ]);
        return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      }
    }
  });
  const marketCatalogSnapshotCache = new RedisMarketCatalogSnapshotCache(dependencies.redisClient, {
    keyPrefix: resolveMarketCatalogSnapshotCacheKeyPrefix({
      lotusDeployEnv: process.env.LOTUS_DEPLOY_ENV,
      lotusEnv: process.env.LOTUS_ENV,
      appEnv: process.env.APP_ENV,
      nodeEnv: process.env.NODE_ENV,
      canonicalServiceBaseUrl: dependencies.canonicalServiceBaseUrl
    })
  });
  if (backgroundWorkersEnabled) {
    const workerDutyProfile = resolveMarketOrderbookRecorderDutyProfile({
      LOTUS_DEPLOY_ENV: process.env.LOTUS_DEPLOY_ENV,
      LOTUS_ENV: process.env.LOTUS_ENV,
      APP_ENV: process.env.APP_ENV,
      NODE_ENV: process.env.NODE_ENV
    });
    dependencies.logger.info({ workerDutyProfile }, "Starting market background worker duties.");
    const marketOrderbookRecorders = buildMarketOrderbookRecorderConfigs(workerDutyProfile).map((config) =>
      new MarketOrderbookRecorder(
        marketCatalogRepository,
        venueQuoteSource,
        venueOrderbookSnapshotRepository,
        dependencies.logger,
        config,
        hotQuoteSnapshots
      )
    );
    for (const marketOrderbookRecorder of marketOrderbookRecorders) {
      marketOrderbookRecorder.start();
    }
    app.addHook("onClose", async () => {
      await Promise.all(marketOrderbookRecorders.map((marketOrderbookRecorder) => marketOrderbookRecorder.stop()));
    });
    const marketCatalogSnapshotMaterializers = [
      new MarketCatalogSnapshotMaterializer({
        marketCatalogRepository,
        marketQuoteReadinessSource,
        snapshotCache: marketCatalogSnapshotCache,
        logger: dependencies.logger,
        config: {
          intervalMs: workerDutyProfile === "shared_staging" ? 8_000 : 3_000,
          cacheTtlMs: 300_000,
          quoteReadinessMaxAgeMs: DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS,
          limits: [250],
          routeCoverages: ["all"],
          categories: [],
          categoryRefreshEveryTicks: 1
        }
      }),
      new MarketCatalogSnapshotMaterializer({
        marketCatalogRepository,
        marketQuoteReadinessSource,
        snapshotCache: marketCatalogSnapshotCache,
        logger: dependencies.logger,
        config: {
          intervalMs: workerDutyProfile === "shared_staging" ? 45_000 : 30_000,
          cacheTtlMs: 300_000,
          quoteReadinessMaxAgeMs: DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS,
          limits: [250],
          routeCoverages: ["all", "pair", "tri", "strict_all"],
          categories: ["Crypto", "Sports", "Politics", "Esports"],
          categoryRefreshEveryTicks: 1
        }
      })
    ];
    for (const marketCatalogSnapshotMaterializer of marketCatalogSnapshotMaterializers) {
      marketCatalogSnapshotMaterializer.start();
    }
    app.addHook("onClose", async () => {
      await Promise.all(marketCatalogSnapshotMaterializers.map((materializer) => materializer.stop()));
    });
  }

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
      getOrderbookSnapshot: async () => null,
      getOrderbookSnapshots: async (input) => venueQuoteSource.getCalculatedSnapshots(input)
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
  const adapterRegistry = new ExecutionVenueAdapterRegistry();
  if (dependencies.executionSystemSandboxEnabled) {
    for (const venue of ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT", "MYRIAD", "TEST"]) {
      adapterRegistry.register(new TestExecutionAdapter(venue));
    }
  }
  if (process.env.POLYMARKET_EXECUTION_MODE === "v2") {
    adapterRegistry.register(new PolymarketExecutionAdapterV2(
      buildPolymarketExecutionAdapterV2ConfigFromEnv(process.env),
      undefined,
      {
        readUsableBalance: ({ userId }) =>
          readPolymarketUsableBalanceForUser({
            userId,
            fundingIntentId: "execution-submit",
            routeLegId: "execution-submit"
          })
      }
    ));
  }
  if (
    process.env.LIMITLESS_EXECUTION_MODE === "backend_signer" ||
    process.env.LIMITLESS_EXECUTION_MODE === "delegated_partner_server_wallet" ||
    process.env.LIMITLESS_EXECUTION_MODE === "user_signed_backend_relay"
  ) {
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
      {
        ...buildPredictFunExecutionAdapterConfigFromEnv(process.env),
        predictJwtProvider: userVenueAccountService
      }
    ));
  }
  const signedTradeBundleService = new SignedTradeBundleService(
    executableRouteService,
    adapterRegistry,
    userVenueAccountService,
    undefined,
    process.env,
    signedTradeExecutionStatusRepository,
    signedTradePositionRecorder,
    {
      readUsableBalance: ({ userId }) =>
        readPolymarketUsableBalanceForUser({
          userId,
          fundingIntentId: "signed-bundle-readiness",
          routeLegId: "signed-bundle-readiness"
        }),
      readConditionalTokenApproval: (input) =>
        polymarketFundingBalanceReadService.readConditionalTokenApproval({
          ...input,
          fundingIntentId: "signed-bundle-readiness",
          routeLegId: "signed-bundle-readiness"
      })
    }
  );
  const liveExecutionCandidateProvider = {
    getCandidates: async (input: {
      userId: string;
      side: "buy" | "sell";
      marketId: string;
      outcomeId: string;
      amount: string;
      venues?: readonly string[] | undefined;
    }) => {
      const quantity = Number(input.amount);
      const report = Number.isFinite(quantity) && quantity > 0
        ? await venueQuoteSource.getCalculatedSnapshotReport({
            canonicalMarketId: input.marketId,
            canonicalOutcomeId: input.outcomeId,
            side: input.side,
            quantity
          })
        : { snapshots: [], blocked: [] };
      return buildLiveExecutionCandidatesResponse({
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        amount: input.amount,
        snapshots: report.snapshots,
        snapshotBlockers: report.blocked,
        readiness: await executionVenuesAdminService.listVenues(),
        ...(input.venues ? { venues: input.venues } : {})
      });
    }
  };
  const executionOrderService = new ExecutionOrderOrchestratorV1(
    executionOrderRepository,
    executableRouteService,
    sellQuoteService,
    signedTradeBundleService,
    liveExecutionCandidateProvider,
    dependencies.logger
  );
  if (dependencies.executionSystemSandboxEnabled) {
    const laneGate = new ApprovedLaneExecutionGate(new ScopeAuthorityLaneResolver(executionScopeAuthorities));
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
    logger: dependencies.logger,
    onSubscribe: async ({ topic, send }) => {
      const parsedOrderbookTopic = parseMarketOrderbookTopic(topic);
      if (!parsedOrderbookTopic) {
        return;
      }
      hotQuoteSnapshots.touch({
        canonicalMarketId: parsedOrderbookTopic.canonicalMarketId,
        ...(parsedOrderbookTopic.canonicalOutcomeId
          ? { canonicalOutcomeId: parsedOrderbookTopic.canonicalOutcomeId }
          : {})
      });
      const orderbook = await marketDataViewService.getOrderbook({
        marketId: parsedOrderbookTopic.canonicalMarketId,
        ...(parsedOrderbookTopic.canonicalOutcomeId ? { outcomeId: parsedOrderbookTopic.canonicalOutcomeId } : {}),
        depth: 20
      });
      send({
        type: "MARKET_ORDERBOOK_UPDATE",
        topic,
        emittedAt: new Date().toISOString(),
        payload: toInitialMarketOrderbookPayload(orderbook)
      });
    }
  });
  const executionWsUpdatesEnabled = process.env.EXECUTION_WS_UPDATES_ENABLED !== "false";
  const notificationRepository = new PgNotificationRepository(dependencies.pgPool, async (notification) => {
    if (!executionWsUpdatesEnabled) {
      return;
    }
    await wsGateway.publishEvent({
      type: "USER_NOTIFICATION",
      topic: notificationUserTopic(notification.userId),
      emittedAt: new Date().toISOString(),
      payload: { notification }
    });
  });
  const executionStatusWatcher = new ExecutionStatusWatcher(
    signedTradeExecutionStatusRepository,
    signedTradeBundleService,
    verifiedPositionRepository,
    {
      publishExecutionStatus: async (status) => {
        if (!executionWsUpdatesEnabled) {
          return;
        }
        const payload = {
          executionId: status.executionId,
          status: status.status,
          submittedLegs: status.submittedLegs,
          freshness: status.watcherMetadata?.lastWatcherError ? "stale" : "live",
          updatedAt: status.updatedAt
        };
        await Promise.all([
          wsGateway.publishEvent({
            type: "EXECUTION_STATUS_UPDATE",
            topic: executionQuoteTopic(status.executionId),
            emittedAt: new Date().toISOString(),
            payload
          }),
          wsGateway.publishEvent({
            type: "EXECUTION_STATUS_UPDATE",
            topic: executionUserTopic(status.userId),
            emittedAt: new Date().toISOString(),
            payload
          })
        ]);
      },
      publishPositions: async (input) => {
        if (!executionWsUpdatesEnabled) {
          return;
        }
        const payload = {
          marketId: input.marketId,
          outcomeId: input.outcomeId,
          positions: input.positions,
          generatedAt: new Date().toISOString(),
          freshness: "live"
        };
        await Promise.all([
          wsGateway.publishEvent({
            type: "EXECUTION_POSITION_UPDATE",
            topic: executionPositionsTopic(input.userId, input.marketId, input.outcomeId),
            emittedAt: new Date().toISOString(),
            payload
          }),
          wsGateway.publishEvent({
            type: "EXECUTION_POSITION_UPDATE",
            topic: executionUserTopic(input.userId),
            emittedAt: new Date().toISOString(),
            payload
          })
        ]);
      },
      publishReadiness: async (readiness, userId) => {
        if (!executionWsUpdatesEnabled) {
          return;
        }
        await wsGateway.publishEvent({
          type: "EXECUTION_READINESS_UPDATE",
          topic: executionUserTopic(userId),
          emittedAt: new Date().toISOString(),
          payload: readiness as unknown as Record<string, unknown>
        });
      },
      publishPortfolio: async (input) => {
        if (!executionWsUpdatesEnabled) {
          return;
        }
        const payload = {
          marketId: input.marketId,
          outcomeId: input.outcomeId,
          positions: input.positions,
          generatedAt: new Date().toISOString(),
          freshness: "live"
        };
        await Promise.all([
          wsGateway.publishEvent({
            type: "EXECUTION_MARK_UPDATE",
            topic: executionPortfolioTopic(input.userId),
            emittedAt: new Date().toISOString(),
            payload
          }),
          wsGateway.publishEvent({
            type: "EXECUTION_PORTFOLIO_UPDATE",
            topic: executionUserTopic(input.userId),
            emittedAt: new Date().toISOString(),
            payload
          })
        ]);
      }
    },
    dependencies.logger,
    buildExecutionStatusWatcherConfigFromEnv(process.env)
  );
  if (backgroundWorkersEnabled) {
    executionStatusWatcher.start();
    let executionOrderRefreshStopped = false;
    let executionOrderRefreshTimer: NodeJS.Timeout | null = null;
    const scheduleExecutionOrderRefresh = (delayMs: number): void => {
      if (executionOrderRefreshStopped) {
        return;
      }
      executionOrderRefreshTimer = setTimeout(() => {
        executionOrderRefreshTimer = null;
        void executionOrderService.refreshOpenOrders({ limit: 50 }).catch((error) => {
          dependencies.logger.warn({
            errorName: error instanceof Error ? error.name : "UnknownError"
          }, "Execution order V1 refresher tick failed.");
        }).finally(() => {
          scheduleExecutionOrderRefresh(5_000);
        });
      }, Math.max(0, delayMs));
      executionOrderRefreshTimer.unref?.();
    };
    scheduleExecutionOrderRefresh(0);
    app.addHook("onClose", async () => {
      executionOrderRefreshStopped = true;
      executionStatusWatcher.stop();
      if (executionOrderRefreshTimer) {
        clearTimeout(executionOrderRefreshTimer);
        executionOrderRefreshTimer = null;
      }
    });
  }
  await registerHealthRoute(app);
  await registerMetricsRoute(app);
  if (workerOnly) {
    dependencies.logger.info({}, "Worker service started background jobs and health endpoints.");
    return app;
  }
  await registerTurnkeyAuthRoutes(app, {
    jwtTtlSeconds: parseUserJwtTtlSeconds(process.env.USER_JWT_TTL_SECONDS),
    provisionUserAccount: async ({ userId, turnkeyOrganizationId }) => {
      const wallets = await userWalletService.ensureDefaultWallets(userId, null, turnkeyOrganizationId);
      const setup = await userVenueAccountService.prepareAccountSetupBatch(userId);
      const blockers = [
        ...setup.venueAccounts.flatMap((item) => item.readinessBlockers),
        ...setup.venueAccounts.flatMap((item) => item.setupInstructions),
        ...setup.signatureRequests.map((request) => `${request.venue} requires a user signature before the venue account is fully active.`)
      ];
      const uniqueBlockers = [...new Set(blockers.filter((value) => value.trim().length > 0))];
      return {
        status: uniqueBlockers.length === 0 ? "READY" : "ACTION_REQUIRED",
        walletCount: wallets.filter((wallet) => wallet.status === "ACTIVE").length,
        venueAccountCount: setup.venueAccounts.length,
        blockers: uniqueBlockers
      };
    }
  });
  await registerNotificationRoutes(app, userAuthMiddleware, notificationRepository);
  const listVenueBalancesForUser = async (userId: string): Promise<VenueBalanceView[]> => {
    const balances = await fundingService.listVenueBalances(userId);
    try {
      const polymarket = await withTimeout(
        readPolymarketUsableBalanceForUser({
          userId,
          fundingIntentId: "venue-balance",
          routeLegId: "venue-balance"
        }),
        parseOptionalNumber(process.env.POLYMARKET_VENUE_BALANCE_READ_TIMEOUT_MS)
          ?? DEFAULT_POLYMARKET_VENUE_BALANCE_READ_TIMEOUT_MS
      );
      const sourceReady = hasPolymarketCLOBTradeReadyBalance(
        polymarket.usableBalanceSource,
        polymarket.usableBalance
      );
      const displayBalance = sourceReady
        ? polymarket
        : await readRecentPolymarketClobConfirmationBalanceForUser(
            userId,
            POLYMARKET_CLOB_SYNC_CONFIRMATION_DISPLAY_MAX_AGE_MS
          ).catch(() => null) ?? polymarket;
      const spendableBalance = buildPolymarketVenueBalanceView(
        displayBalance,
        balances,
        sourceReady ? "live" : displayBalance === polymarket ? "live" : "stale"
      );
      const withoutPolymarket = balances.filter((balance) =>
        !(balance.venue === "POLYMARKET" && balance.token.toUpperCase() === "USDC")
      );
      return [spendableBalance, ...withoutPolymarket];
    } catch {
      const confirmationBalance = await readRecentPolymarketClobConfirmationBalanceForUser(
        userId,
        POLYMARKET_CLOB_SYNC_CONFIRMATION_DISPLAY_MAX_AGE_MS
      ).catch(() => null);
      if (confirmationBalance) {
        const spendableBalance = buildPolymarketVenueBalanceView(confirmationBalance, balances, "stale");
        const withoutPolymarket = balances.filter((balance) =>
          !(balance.venue === "POLYMARKET" && balance.token.toUpperCase() === "USDC")
        );
        return [spendableBalance, ...withoutPolymarket];
      }
      return balances.map((balance) => balance.venue === "POLYMARKET"
        ? {
            ...balance,
            balanceSource: balance.balanceSource ?? "PERSISTED_VENUE_BALANCE",
            balanceFreshness: "stale",
            readinessReason: balance.readinessReason ?? "POLYMARKET_LIVE_BALANCE_READ_UNAVAILABLE"
          }
        : balance);
    }
  };
  const listVenueActivationsForUser = async (userId: string) => {
    const polymarketActivationExecuted = await userVenueAccountService.hasExecutedPolymarketBalanceActivation(userId);
    const activations = buildVenueBalanceActivationActions({
      balances: await fundingService.listVenueBalances(userId),
      venueAccounts: await userVenueAccountService.listAccounts(userId),
      polymarketActivationExecuted,
      env: process.env
    });
    const polymarket = activations.find((activation) => activation.venue === "POLYMARKET");
    if (polymarket) {
      try {
        const balance = await withTimeout(
          readPolymarketUsableBalanceForUser({
            userId,
            fundingIntentId: "activation-status",
            routeLegId: "activation-status"
          }),
          parseOptionalNumber(process.env.POLYMARKET_VENUE_BALANCE_READ_TIMEOUT_MS)
            ?? DEFAULT_POLYMARKET_VENUE_BALANCE_READ_TIMEOUT_MS
        );
        polymarket.clobCollateralBalance = balance.collateralBalance;
        polymarket.clobCollateralAllowance = balance.collateralAllowance;
        polymarket.onchainPusdBalance = balance.onchainPusdBalance;
        polymarket.onchainPusdAllowance = balance.onchainPusdAllowance;
        polymarket.bridgedUsdcBalance = balance.bridgedUsdcBalance;
        polymarket.clobAllowanceSpenders = balance.clobAllowanceSpenders;
        polymarket.approvalSpenderSource = balance.approvalSpenderSource;
        const hasActivationApprovalSpender = hasPolymarketActivationApprovalSpender(
          process.env,
          balance.clobAllowanceSpenders
        );
        const requireActivationApprovalSpender = () => {
          polymarket.status = polymarket.status === "ACCOUNT_REQUIRED" ? polymarket.status : "CONFIG_REQUIRED";
          polymarket.readinessReason = "POLYMARKET_CLOB_APPROVAL_SPENDER_UNAVAILABLE";
          polymarket.instructions = [
            "Polymarket activation needs a current CLOB pUSD approval spender discovered from Polymarket or an operator-reviewed fallback spender in backend config."
          ];
          polymarket.blockers = [
            "Polymarket CLOB pUSD approval spender is not configured or discoverable."
          ];
        };
        const bridgedUsdc = Number(balance.bridgedUsdcBalance ?? "0");
        const onchainPusd = Number(balance.onchainPusdBalance ?? "0");
        const usable = Number(balance.usableBalance);
        const sourceReady = hasPolymarketCLOBTradeReadyBalance(
          balance.usableBalanceSource,
          balance.usableBalance
        );
        if (sourceReady && Number.isFinite(usable) && usable > 0) {
          applyPolymarketClobConfirmationActivation(polymarket, balance, "live");
        } else {
          const confirmationBalance = await readRecentPolymarketClobConfirmationBalanceForUser(
            userId,
            POLYMARKET_CLOB_SYNC_CONFIRMATION_DISPLAY_MAX_AGE_MS
          ).catch(() => null);
          if (confirmationBalance) {
            applyPolymarketClobConfirmationActivation(polymarket, confirmationBalance, "stale");
          } else if (polymarketActivationExecuted) {
            polymarket.activationRequired = false;
            polymarket.mode = "VENUE_UI_OR_RELAYER";
            polymarket.status = "SYNC_PENDING";
            polymarket.tokenSymbol = "pUSD";
            polymarket.readinessReason = "POLYMARKET_CLOB_SYNC_PENDING";
            polymarket.instructions = [
              "Polymarket activation was submitted. Lotus is polling CLOB collateral readiness before live trading is enabled."
            ];
            polymarket.blockers = [];
          } else if (Number.isFinite(bridgedUsdc) && bridgedUsdc > 0) {
            polymarket.activationRequired = true;
            polymarket.mode = "VENUE_UI_OR_RELAYER";
            polymarket.tokenSymbol = "pUSD";
            if (hasActivationApprovalSpender) {
              polymarket.status = polymarket.status === "ACCOUNT_REQUIRED" ? polymarket.status : "READY";
              polymarket.readinessReason = "POLYMARKET_USDCE_ACTIVATION_REQUIRED";
              polymarket.instructions = [
                "USDC.e has arrived in the Polymarket deposit wallet, but it must be activated into Polymarket spendable pUSD/CLOB collateral before trading."
              ];
            } else {
              requireActivationApprovalSpender();
            }
          } else if (
            balance.usableBalanceSource === "ONCHAIN_CLOB_SPENDER_ALLOWANCE" &&
            Number.isFinite(onchainPusd) &&
            onchainPusd > 0
          ) {
            polymarket.activationRequired = false;
            polymarket.mode = "NOT_REQUIRED";
            polymarket.status = "SYNC_PENDING";
            polymarket.tokenSymbol = "pUSD";
            polymarket.readinessReason = "POLYMARKET_CLOB_SYNC_PENDING";
            polymarket.instructions = [
              "pUSD is approved on-chain for the current Polymarket CLOB spenders, but Polymarket CLOB has not confirmed spendable collateral yet. Lotus will not submit Polymarket orders until CLOB confirms readiness."
            ];
            polymarket.blockers = [];
          } else if (Number.isFinite(onchainPusd) && onchainPusd > 0) {
            polymarket.activationRequired = true;
            polymarket.mode = "VENUE_UI_OR_RELAYER";
            polymarket.tokenSymbol = "pUSD";
            if (hasActivationApprovalSpender) {
              polymarket.status = polymarket.status === "ACCOUNT_REQUIRED" ? polymarket.status : "READY";
              polymarket.readinessReason = "POLYMARKET_CLOB_APPROVAL_REQUIRED";
              polymarket.instructions = [
                balance.approvalSpenderSource === "CLOB_ALLOWANCE_MAP"
                  ? "pUSD is present in the Polymarket deposit wallet, but current Polymarket CLOB allowance is not ready. Activate again to approve the current CLOB trading spenders; a previous activation may have approved a legacy spender."
                  : "pUSD is present in the Polymarket deposit wallet, but Lotus could not discover current CLOB spenders. Activate will use the operator-reviewed fallback spender config."
              ];
            } else {
              requireActivationApprovalSpender();
            }
          }
        }
      } catch {
        const balance = await readRecentPolymarketClobConfirmationBalanceForUser(
          userId,
          POLYMARKET_CLOB_SYNC_CONFIRMATION_DISPLAY_MAX_AGE_MS
        ).catch(() => null);
        if (balance) {
          applyPolymarketClobConfirmationActivation(polymarket, balance, "stale");
        } else if (polymarketActivationExecuted) {
          polymarket.activationRequired = false;
          polymarket.mode = "VENUE_UI_OR_RELAYER";
          polymarket.status = "SYNC_PENDING";
          polymarket.tokenSymbol = "pUSD";
          polymarket.readinessReason = "POLYMARKET_CLOB_SYNC_PENDING";
          polymarket.instructions = [
            "Polymarket activation was submitted. Lotus is polling CLOB collateral readiness before live trading is enabled."
          ];
          polymarket.blockers = [];
        }
      }
    }
    return activations;
  };
  const accountSnapshotCache = new Map<string, { expiresAt: number; snapshot: unknown }>();
  const accountSnapshotTimeout = async <T>(read: Promise<T>, fallback: T): Promise<T> => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        read,
        new Promise<T>((resolve) => {
          timeout = setTimeout(() => resolve(fallback), 2_000);
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  app.get("/account/snapshot", { preHandler: userAuthMiddleware }, async (request, reply) => {
    const generatedAt = new Date().toISOString();
    const userId = request.user.userId;
    const cached = accountSnapshotCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return reply.status(200).send(cached.snapshot);
    }
    const fallbackSection = async <T>(section: string, read: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await accountSnapshotTimeout(read, fallback);
      } catch (error) {
        app.log.warn({
          section,
          userId,
          errorName: error instanceof Error ? error.name : "UnknownError"
        }, "Account snapshot section unavailable; returning partial snapshot");
        return fallback;
      }
    };
    const [
      balances,
      activations,
      wallets,
      venueSetup,
      openOrders,
      history,
      fundingHistory
    ] = await Promise.all([
      fallbackSection("venueBalances", listVenueBalancesForUser(userId), []),
      fallbackSection("venueActivations", listVenueActivationsForUser(userId), []),
      fallbackSection("wallets", userWalletService.listWallets(userId), []),
      fallbackSection("venueAccounts", userVenueAccountService.prepareAccountSetupBatch(userId), {
        venueAccounts: [],
        signatureRequests: []
      }),
      fallbackSection("openOrders", signedTradeExecutionStatusRepository.listOpenExecutionStatusesForUser({ userId, limit: 51 }), []),
      fallbackSection("history", signedTradeExecutionStatusRepository.listExecutionStatusesForUser({ userId, limit: 51 }), []),
      fallbackSection("fundingHistory", fundingService.listFundingHistory(userId, { pageSize: 50 }), {
        items: [],
        page: 1,
        pageSize: 50,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false
      })
    ]);
    const walletSnapshots = await Promise.all(wallets.map(async (wallet) => {
      try {
        return toSafeWallet(wallet, await accountSnapshotTimeout(userWalletBalanceReader.readWalletBalances(wallet), null));
      } catch (error) {
        app.log.warn({
          section: "walletBalance",
          userId,
          walletId: wallet.walletId,
          chainFamily: wallet.chainFamily,
          errorName: error instanceof Error ? error.name : "UnknownError"
        }, "Wallet balance unavailable; returning wallet identity with unavailable balance");
        return toSafeWallet(wallet, null);
      }
    }));
    const snapshot = {
      generatedAt,
      balances,
      activations,
      wallets: walletSnapshots,
      venueAccounts: venueSetup.venueAccounts.map((item) => ({
        venue: item.venue,
        setupMode: item.setupMode,
        venueAccount: toSafeVenueAccount(item.account, item.readinessBlockers, item.setupInstructions)
      })),
      setupRequests: venueSetup.signatureRequests,
      openOrders: { generatedAt, items: openOrders.slice(0, 50), nextCursor: openOrders.length > 50 ? openOrders[49]?.updatedAt ?? null : null },
      history: { generatedAt, items: history.slice(0, 50), nextCursor: history.length > 50 ? history[49]?.updatedAt ?? null : null },
      fundingHistory
    };
    accountSnapshotCache.set(userId, { expiresAt: Date.now() + 5_000, snapshot });
    return reply.status(200).send(snapshot);
  });
  await registerFundingRoutes(app, userAuthMiddleware, {
    createIntent: (userId, request) => fundingService.createIntent(userId, request),
    getIntent: (userId, fundingIntentId) => fundingService.getIntent(userId, fundingIntentId),
    quoteIntent: (userId, fundingIntentId) => fundingService.quoteIntent(userId, fundingIntentId),
    submitRouteLeg: (userId, fundingIntentId, request) => fundingService.submitRouteLeg(userId, fundingIntentId, request),
    submitSignedSolanaRouteLeg: (userId, fundingIntentId, request) => fundingService.submitSignedSolanaRouteLeg(userId, fundingIntentId, request),
    refreshIntentStatus: (userId, fundingIntentId) => fundingService.refreshIntentStatus(userId, fundingIntentId),
    listVenueCapabilities: async () => fundingService.listVenueCapabilities(),
    listVenueBalances: listVenueBalancesForUser,
    listVenueActivations: listVenueActivationsForUser,
    preparePolymarketActivation: async (userId, input) => {
      const account = await userVenueAccountService.getAccount(userId, "POLYMARKET");
      if (account?.status !== "ACTIVE" || !account.venueAccountAddress) {
        throw new FundingError("BALANCE_ACTIVATION_UNAVAILABLE", "An active Polymarket deposit wallet is required before activation.", 409);
      }
      try {
        let approvalSpenders: string[] = [];
        let conditionalApprovalSpenders: string[] = [];
        try {
          const activationBalance = await polymarketFundingBalanceReadService.readUsableBalance({
            userId,
            fundingIntentId: "activation-prepare",
            routeLegId: "activation-prepare"
          });
          approvalSpenders = activationBalance.clobAllowanceSpenders.map((spender) => spender.spenderAddress);
          if (input?.tokenId) {
            const conditional = await polymarketFundingBalanceReadService.readConditionalTokenApproval({
              userId,
              fundingIntentId: "activation-prepare",
              routeLegId: "activation-prepare",
              tokenId: input.tokenId
            });
            conditionalApprovalSpenders = conditional.clobAllowanceSpenders.map((spender) => spender.spenderAddress);
          }
        } catch {
          approvalSpenders = [];
          conditionalApprovalSpenders = [];
        }
        return await polymarketDepositWalletClient.prepareActivation({
          ownerAddress: account.walletAddress,
          depositWalletAddress: account.venueAccountAddress,
          approvalSpenders,
          conditionalApprovalSpenders
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("no USDC.e or pUSD balance")) {
          throw new FundingError("BALANCE_ACTIVATION_UNAVAILABLE", "Polymarket deposit wallet has no USDC.e or pUSD balance to activate.", 409);
        }
        throw error;
      }
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
      let approvalSpenders: string[] = [];
      let conditionalApprovalSpenders: string[] = [];
      try {
        const activationBalance = await polymarketFundingBalanceReadService.readUsableBalance({
          userId,
          fundingIntentId: "activation-submit",
          routeLegId: "activation-submit"
        });
        approvalSpenders = activationBalance.clobAllowanceSpenders.map((spender) => spender.spenderAddress);
      } catch {
        approvalSpenders = [];
      }
      for (const call of request.calls) {
        const conditionalAddress = (process.env.POLYMARKET_CONDITIONAL_TOKENS_ADDRESS ??
          process.env.POLYMARKET_CTF_CONTRACT_ADDRESS ??
          "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045").toLowerCase();
        if (call.target.toLowerCase() === conditionalAddress && call.data.toLowerCase().startsWith("0xa22cb465")) {
          const clean = call.data.slice(10);
          const operator = `0x${clean.slice(24, 64)}`;
          if (/^0x[a-fA-F0-9]{40}$/.test(operator)) conditionalApprovalSpenders.push(operator);
        }
      }
      const activation = await polymarketDepositWalletClient.submitActivation({
        ...request,
        approvalSpenders,
        conditionalApprovalSpenders
      });
      await userVenueAccountService.recordPolymarketBalanceActivation({
        userId,
        ownerAddress: request.ownerAddress,
        depositWalletAddress: request.depositWalletAddress,
        relayerTransactionId: activation.relayerTransactionId,
        relayerState: activation.relayerState,
        transactionHash: activation.transactionHash
      });
      accountSnapshotCache.delete(userId);
      return activation;
    },
    preparePolymarketClobSync: async (userId) => {
      const account = await userVenueAccountService.getAccount(userId, "POLYMARKET");
      if (account?.status !== "ACTIVE" || !account.walletAddress || !account.venueAccountAddress) {
        throw new FundingError("POLYMARKET_CLOB_SYNC_UNAVAILABLE", "An active Polymarket deposit wallet is required before CLOB readiness sync.", 409);
      }
      return buildPolymarketClobReadinessPreparation({
        signerAddress: account.walletAddress,
        depositWalletAddress: account.venueAccountAddress
      }, polymarketClobReadinessSyncConfig);
    },
    submitPolymarketClobSync: async (userId, request) => {
      const account = await userVenueAccountService.getAccount(userId, "POLYMARKET");
      if (account?.status !== "ACTIVE" || !account.walletAddress || !account.venueAccountAddress) {
        throw new FundingError("POLYMARKET_CLOB_SYNC_UNAVAILABLE", "An active Polymarket deposit wallet is required before CLOB readiness sync.", 409);
      }
      if (
        account.walletAddress.toLowerCase() !== request.signedPayload.signer.toLowerCase() ||
        account.venueAccountAddress.toLowerCase() !== request.signedPayload.account.toLowerCase()
      ) {
        throw new FundingError("POLYMARKET_CLOB_SYNC_FORBIDDEN", "Polymarket CLOB readiness sync request does not match the user's active deposit wallet.", 403);
      }
      try {
        const sync = await polymarketClobReadinessSyncService.sync({
          account: {
            signerAddress: account.walletAddress,
            depositWalletAddress: account.venueAccountAddress
          },
          signedPayload: request.signedPayload
        });
        await userVenueAccountService.recordPolymarketClobReadinessSync({
          userId,
          status: sync.status,
          readinessReason: sync.readinessReason,
          readyAmount: sync.readyAmount,
          clobCollateralBalance: sync.clobCollateralBalance,
          clobCollateralAllowance: sync.clobCollateralAllowance,
          clobAllowanceSpenders: sync.clobAllowanceSpenders,
          ownerAddress: sync.ownerAddress,
          signerAddress: sync.signerAddress
        });
        accountSnapshotCache.delete(userId);
        return sync;
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Polymarket CLOB readiness sync failed.";
        throw new FundingError("POLYMARKET_CLOB_SYNC_FAILED", message, 409);
      }
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
    sellQuoteService,
    signedTradeBundleService,
    executionOrderService,
    positionRepository: verifiedPositionRepository,
    executionStatusRepository: signedTradeExecutionStatusRepository,
    liveCandidateProvider: liveExecutionCandidateProvider
  });
  await registerMarketCatalogRoutes(app, {
    marketCatalogRepository,
    marketQuoteReadinessSource,
    marketCatalogSnapshotCache,
    marketActivityTracker: hotQuoteSnapshots,
    marketDataViewService
  });
  await registerUserWalletRoutes(app, userAuthMiddleware, {
    listWallets: (userId) => userWalletService.listWallets(userId),
    readWalletBalances: (wallet) => userWalletBalanceReader.readWalletBalances(wallet),
    ensureDefaultWallets: (userId, email, turnkeyOrganizationId) =>
      userWalletService.ensureDefaultWallets(userId, email, turnkeyOrganizationId),
    registerTurnkeyDefaultWallets: (userId, turnkeyOrganizationId, accounts) =>
      userWalletService.registerTurnkeyDefaultWallets(userId, turnkeyOrganizationId, accounts)
  });
  await registerUserVenueAccountRoutes(app, userAuthMiddleware, {
    listAccounts: (userId) => userVenueAccountService.listAccounts(userId),
    getAccount: (userId, venue) => userVenueAccountService.getAccount(userId, venue),
    ensureAccount: (input) => userVenueAccountService.ensureAccount(input),
    prepareAccountSetupBatch: (userId) => userVenueAccountService.prepareAccountSetupBatch(userId),
    completeAccountSetupBatch: (input) => userVenueAccountService.completeAccountSetupBatch(input),
    preparePredictFunAccountAuth: (userId) => userVenueAccountService.preparePredictFunAccountAuth(userId),
    completePredictFunAccountAuth: (input) => userVenueAccountService.completePredictFunAccountAuth(input),
    completeOpinionAccountLink: (input) => userVenueAccountService.completeOpinionAccountLink(input)
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
      const session = await withLatencyStage("rfq_load", {
        endpoint: "POST /rfq/:id/accept"
      }, () => sessionRepository.findById(sessionId));
      if (!session) throw new Error("Session not found");

      const quote = await withLatencyStage("rfq_quote_load", {
        endpoint: "POST /rfq/:id/accept",
        canonicalMarketId: session.canonical_market_id
      }, () => quoteRepository.findByExternalQuoteId(sessionId, request.quoteId));
      if (!quote) throw new Error("Quote not found");

      const acceptancePolicy = readAcceptancePolicy(session.metadata);

      const reservationToken = await withLatencyStage("rfq_accept_risk_reservation", {
        endpoint: "POST /rfq/:id/accept",
        canonicalMarketId: session.canonical_market_id
      }, () => riskEngine.validateBeforeExecution(session, quote));

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
        await withLatencyStage("rfq_accept_monetization_preflight", {
          endpoint: "POST /rfq/:id/accept",
          canonicalMarketId: session.canonical_market_id
        }, async () => {
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
        });
      }
      const canonicalIdentity = await withLatencyStage("canonical_identity_lookup", {
        endpoint: "POST /rfq/:id/accept",
        canonicalMarketId: session.canonical_market_id
      }, () => resolveCanonicalIdentity(
        dependencies.pgPool,
        session.canonical_market_id
      ));
      let buildResult;
      try {
        buildResult = await withLatencyStage("route_optimization", {
          endpoint: "POST /rfq/:id/accept",
          canonicalMarketId: session.canonical_market_id,
          routeType: acceptancePolicy
        }, () => orderRouter.buildPlan(rfqInput, selectedQuoteInput, acceptancePolicy));
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
          ghostFillProtectionEnabled: true,
          // In the legacy RFQ model a single LP quotes for the full quantity, so the
          // single-venue baseline equals the total requested size (no share improvement).
          singleVenueMaxFillSize: session.quantity
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

      const rawQuotes = await withLatencyStage("quote_source_lookup", {
        endpoint: "POST /rfq/:id/accept",
        canonicalMarketId: session.canonical_market_id
      }, () => quoteRepository.listBySessionId(sessionId, 100));
      const rankedQuotes = await withLatencyStage("route_optimization", {
        endpoint: "POST /rfq/:id/accept",
        canonicalMarketId: session.canonical_market_id,
        routeType: "LEGACY_QUOTE_RANKING"
      }, async () => rankQuotesByEffectiveCost(
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
      ));
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

      const executionScopeToken = request.executionScopeToken;
      const validatedScope = executionScopeToken
        ? await withLatencyStage("execution_scope_token_validation", {
            endpoint: "POST /rfq/:id/accept",
            canonicalMarketId: session.canonical_market_id
          }, () => executionScopeTokenService.validate({
            token: executionScopeToken,
            principalId: session.taker_id,
            sessionId,
            quoteId: request.quoteId,
            canonicalMarketId: session.canonical_market_id,
            actualVenueTargets: executionRequest.venueTargets,
            authorities: executionScopeAuthorities
          }))
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

      const outcome = await withLatencyStage("rfq_accept_preflight", {
        endpoint: "POST /rfq/:id/accept",
        canonicalMarketId: session.canonical_market_id,
        routeType: executionRequest.routeType
      }, () => executionControlGateway.execute(executionRequest));
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
  await registerAdminTriMatchReviewRoutes(app, adminAuthMiddleware, {
    triMatchReviewService: new TriMatchReviewService(new PairEdgeRepository(dependencies.pgPool))
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

const toInitialMarketOrderbookPayload = (orderbook: MarketOrderbookResponse): Record<string, unknown> => ({
  schemaVersion: ORDERBOOK_STREAM_SCHEMA_VERSION,
  updateType: "snapshot",
  seq: 0,
  canonicalMarketId: orderbook.marketId,
  canonicalOutcomeId: orderbook.outcomeId,
  source: "initial_snapshot",
  status: orderbook.status,
  generatedAt: orderbook.generatedAt,
  depth: orderbook.depth,
  bestBid: orderbook.bestBid,
  bestAsk: orderbook.bestAsk,
  midpoint: orderbook.midpoint,
  spread: orderbook.spread,
  venues: orderbook.venues,
  venueCount: orderbook.venues.length,
  liveVenueCount: orderbook.venues.filter((venue) =>
    venue.snapshotStatus === "live" && venue.blockers.length === 0 && (venue.bestBid !== null || venue.bestAsk !== null)
  ).length,
  bids: orderbook.bids,
  asks: orderbook.asks,
  blockers: orderbook.blockers,
  checksum: calculateOrderbookStreamChecksum({
    canonicalMarketId: orderbook.marketId,
    canonicalOutcomeId: orderbook.outcomeId,
    bestBid: orderbook.bestBid,
    bestAsk: orderbook.bestAsk,
    bids: orderbook.bids,
    asks: orderbook.asks,
    blockers: orderbook.blockers.map((blocker) => blocker.reason)
  })
});

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
  vmp_id: string | null;
  vmp_title: string | null;
  vmp_description: string | null;
  vmp_resolution_source: string | null;
  vmp_resolution_title: string | null;
  vmp_resolution_rules_text: string | null;
  vmp_normalized_payload: Record<string, unknown> | null;
  vmp_raw_source_payload: Record<string, unknown> | null;
  vrp_id: string | null;
  vrp_resolution_source: string | null;
  vrp_resolution_title: string | null;
  vrp_rule_text: string | null;
}

interface OfficialVenueResolutionMetadata {
  title: string | null;
  primaryResolutionText: string;
  supplementalRulesText: string | null;
  resolutionSourceText: string | null;
  oracleType: string | null;
  oracleName: string | null;
  resolver: string | null;
  sourceUrl: string | null;
  fetchedBy: string;
}

interface VenueDeclaredOracleSource {
  oracleType: string;
  oracleName: string;
}

const polymarketResolutionMetadataClient = new PolymarketGammaClient();

const RESOLUTION_PROFILE_LOOKUP_SELECT = `SELECT rp.*,
            vmp.id AS vmp_id,
            vmp.title AS vmp_title,
            vmp.description AS vmp_description,
            vmp.resolution_source AS vmp_resolution_source,
            vmp.resolution_title AS vmp_resolution_title,
            vmp.resolution_rules_text AS vmp_resolution_rules_text,
            vmp.normalized_payload AS vmp_normalized_payload,
            vmp.raw_source_payload AS vmp_raw_source_payload,
            vrp.id AS vrp_id,
            vrp.resolution_source AS vrp_resolution_source,
            vrp.resolution_title AS vrp_resolution_title,
            vrp.rule_text AS vrp_rule_text
       FROM resolution_profiles rp
       LEFT JOIN venue_market_profiles vmp
              ON vmp.venue = rp.venue
             AND vmp.venue_market_id = rp.venue_market_id
       LEFT JOIN venue_resolution_profiles vrp
              ON vrp.venue_market_profile_id = vmp.id`;

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

const fetchOfficialVenueResolutionMetadata = async (
  row: ResolutionProfileLookupRow
): Promise<OfficialVenueResolutionMetadata | null> => {
  const venue = row.venue.trim().toUpperCase();
  if (venue === "POLYMARKET") {
    return await fetchPolymarketOfficialResolutionMetadata(row) ?? fetchPersistedVenueResolutionMetadata(row);
  }
  if (venue === "LIMITLESS") {
    return await fetchLimitlessOfficialResolutionMetadata(row) ?? fetchPersistedVenueResolutionMetadata(row);
  }

  return fetchPersistedVenueResolutionMetadata(row);
};

const fetchPolymarketOfficialResolutionMetadata = async (
  row: ResolutionProfileLookupRow
): Promise<OfficialVenueResolutionMetadata | null> => {
  const identifiers = collectPolymarketMetadataIdentifiers(row);
  for (const identifier of identifiers) {
    try {
      const markets = await polymarketResolutionMetadataClient.getMarketByIdentifier(identifier);
      const market = markets.find((entry) => {
        const raw = apiServerAsRecord(entry.raw);
        return apiServerFirstString(raw.description, raw.resolutionRules, raw.rules) !== null;
      }) ?? markets[0];
      if (!market) {
        continue;
      }

      const raw = apiServerAsRecord(market.raw);
      const primaryResolutionText = selectOfficialVenueRuleText(raw, apiServerFirstString(raw.question, raw.title, market.title));
      if (!primaryResolutionText) {
        continue;
      }

      const resolutionSourceText = selectOfficialVenueSourceText(raw, primaryResolutionText, row.venue)
        ?? extractResolutionSourceText(primaryResolutionText);
      const oracleSource = deriveVenueDeclaredOracleSource(resolutionSourceText ?? primaryResolutionText);

      return {
        title: apiServerFirstString(raw.question, raw.title, market.title),
        primaryResolutionText,
        supplementalRulesText: resolutionSourceText,
        resolutionSourceText,
        oracleType: oracleSource?.oracleType ?? null,
        oracleName: oracleSource?.oracleName ?? null,
        resolver: apiServerFirstString(raw.resolvedBy, raw.resolved_by, raw.resolver),
        sourceUrl: extractFirstUrl(resolutionSourceText ?? primaryResolutionText) ?? defaultOracleSourceUrl(oracleSource),
        fetchedBy: `polymarket_gamma:${identifier}`
      };
    } catch {
      continue;
    }
  }

  return null;
};

const fetchLimitlessOfficialResolutionMetadata = async (
  row: ResolutionProfileLookupRow
): Promise<OfficialVenueResolutionMetadata | null> => {
  const identifiers = collectLimitlessMetadataIdentifiers(row);
  const client = new LimitlessHistoricalClient({
    baseUrl: process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange",
    apiKey: process.env.LIMITLESS_API_KEY?.trim() ?? ""
  });

  for (const identifier of identifiers) {
    try {
      const detail = await client.getMarketDetail(identifier);
      const rawDetail = apiServerAsRecord(detail);
      const primaryResolutionText = selectOfficialVenueRuleText(rawDetail, apiServerFirstString(rawDetail.title, rawDetail.proxyTitle, identifier));
      if (primaryResolutionText && looksLikeTrustedResolutionText(primaryResolutionText)) {
        const resolutionSourceText = selectOfficialVenueSourceText(rawDetail, primaryResolutionText, row.venue)
          ?? extractResolutionSourceText(primaryResolutionText);
        const oracleSource = deriveVenueDeclaredOracleSource(resolutionSourceText ?? primaryResolutionText);
        return {
          title: apiServerFirstString(rawDetail.title, rawDetail.proxyTitle, identifier),
          primaryResolutionText,
          supplementalRulesText: resolutionSourceText,
          resolutionSourceText: resolutionSourceText ?? "Limitless public market detail",
          oracleType: oracleSource?.oracleType ?? null,
          oracleName: oracleSource?.oracleName ?? null,
          resolver: null,
          sourceUrl: extractFirstUrl(resolutionSourceText ?? primaryResolutionText) ?? defaultOracleSourceUrl(oracleSource),
          fetchedBy: `limitless_market_detail:${identifier}`
        };
      }
    } catch {
      // Fall through to persisted payload checks below.
    }
  }

  const persistedPayloads = [
    apiServerAsRecord(row.vmp_raw_source_payload).limitlessMarketDetail,
    apiServerAsRecord(row.vmp_raw_source_payload).marketDetail,
    apiServerAsRecord(row.vmp_normalized_payload).limitlessMarketDetail,
    apiServerAsRecord(row.vmp_normalized_payload).marketDetail
  ].map(apiServerAsRecord);

  for (const payload of persistedPayloads) {
    const primaryResolutionText = selectOfficialVenueRuleText(payload, apiServerFirstString(payload.title, payload.proxyTitle, row.vmp_title));
    if (!primaryResolutionText || !looksLikeTrustedResolutionText(primaryResolutionText)) {
      continue;
    }
    const resolutionSourceText = selectOfficialVenueSourceText(payload, primaryResolutionText, row.venue)
      ?? extractResolutionSourceText(primaryResolutionText);
    const oracleSource = deriveVenueDeclaredOracleSource(resolutionSourceText ?? primaryResolutionText);
    return {
      title: apiServerFirstString(payload.title, payload.proxyTitle),
      primaryResolutionText,
      supplementalRulesText: resolutionSourceText,
      resolutionSourceText: resolutionSourceText ?? "Limitless persisted market detail",
      oracleType: oracleSource?.oracleType ?? null,
      oracleName: oracleSource?.oracleName ?? null,
      resolver: null,
      sourceUrl: extractFirstUrl(resolutionSourceText ?? primaryResolutionText) ?? defaultOracleSourceUrl(oracleSource),
      fetchedBy: "limitless_persisted_market_detail"
    };
  }

  return null;
};

const fetchPersistedVenueResolutionMetadata = (
  row: ResolutionProfileLookupRow
): OfficialVenueResolutionMetadata | null => {
  const payloads = [
    apiServerAsRecord(row.vmp_raw_source_payload),
    apiServerAsRecord(row.vmp_normalized_payload)
  ];
  const primaryResolutionText = selectTrustedResolutionText(
    ...payloads.map((payload) => selectOfficialVenueRuleText(payload, row.vmp_title)),
    row.vmp_resolution_rules_text,
    row.vmp_description,
    row.vrp_rule_text,
    row.primary_resolution_text,
    row.supplemental_rules_text
  );
  if (!primaryResolutionText) {
    return null;
  }

  const resolutionSourceText = payloads
    .map((payload) => selectOfficialVenueSourceText(payload, primaryResolutionText, row.venue))
    .find((value): value is string => value !== null)
    ?? sanitizeOfficialVenueSourceText(row.vmp_resolution_source, row.venue)
    ?? sanitizeOfficialVenueSourceText(row.vrp_resolution_source, row.venue)
    ?? sanitizeOfficialVenueSourceText(row.supplemental_rules_text, row.venue)
    ?? extractResolutionSourceText(primaryResolutionText);
  const oracleSource = deriveVenueDeclaredOracleSource(resolutionSourceText ?? primaryResolutionText);

  return {
    title: row.vmp_title,
    primaryResolutionText,
    supplementalRulesText: resolutionSourceText,
    resolutionSourceText,
    oracleType: oracleSource?.oracleType ?? null,
    oracleName: oracleSource?.oracleName ?? null,
    resolver: null,
    sourceUrl: extractFirstUrl(resolutionSourceText ?? primaryResolutionText) ?? defaultOracleSourceUrl(oracleSource),
    fetchedBy: `${row.venue.toLowerCase()}_persisted_market_metadata`
  };
};

const persistOfficialVenueResolutionMetadata = async (
  pool: Pool,
  row: ResolutionProfileLookupRow,
  metadata: OfficialVenueResolutionMetadata
): Promise<void> => {
  const metadataPatch = {
    officialVenueRules: {
      fetchedBy: metadata.fetchedBy,
      sourceUrl: metadata.sourceUrl,
      resolver: metadata.resolver,
      hydratedAt: new Date().toISOString()
    }
  };

  await pool.query(
    `UPDATE resolution_profiles
        SET primary_resolution_text = $1,
            supplemental_rules_text = COALESCE($2, supplemental_rules_text),
            oracle_type = COALESCE($3, oracle_type),
            oracle_name = COALESCE($4, oracle_name),
            metadata = metadata || $5::jsonb,
            updated_at = now()
      WHERE id = $6`,
    [
      metadata.primaryResolutionText,
      metadata.supplementalRulesText,
      metadata.oracleType,
      metadata.oracleName,
      JSON.stringify(metadataPatch),
      row.id
    ]
  );

  if (row.vmp_id) {
    await pool.query(
      `UPDATE venue_market_profiles
          SET description = $1,
              resolution_title = COALESCE($2, resolution_title),
              resolution_rules_text = $1,
              resolution_source = COALESCE($3, resolution_source),
              updated_at = now()
        WHERE id = $4`,
      [metadata.primaryResolutionText, metadata.title, metadata.resolutionSourceText, row.vmp_id]
    );
  }

  if (row.vrp_id) {
    await pool.query(
      `UPDATE venue_resolution_profiles
          SET resolution_title = COALESCE($1, resolution_title),
              resolution_source = COALESCE($2, resolution_source),
              rule_text = $3,
              metadata = metadata || $4::jsonb,
              updated_at = now()
        WHERE id = $5`,
      [
        metadata.title,
        metadata.resolutionSourceText,
        metadata.primaryResolutionText,
        JSON.stringify(metadataPatch),
        row.vrp_id
      ]
    );
  }
};

const hydrateOfficialResolutionMetadataForEvent = async (
  pool: Pool,
  canonicalEventId: string,
  alreadyHydratedProfileId: string
): Promise<void> => {
  const result = await pool.query<ResolutionProfileLookupRow>(
    `${RESOLUTION_PROFILE_LOOKUP_SELECT}
      WHERE rp.canonical_event_id = $1
      ORDER BY rp.id ASC`,
    [canonicalEventId]
  );

  for (const row of result.rows) {
    if (row.id === alreadyHydratedProfileId) {
      continue;
    }
    const metadata = await fetchOfficialVenueResolutionMetadata(row);
    if (metadata) {
      await persistOfficialVenueResolutionMetadata(pool, row, metadata);
    }
  }
};

const collectPolymarketMetadataIdentifiers = (row: ResolutionProfileLookupRow): readonly string[] => {
  const normalizedPayload = apiServerAsRecord(row.vmp_normalized_payload);
  const rawPayload = apiServerAsRecord(row.vmp_raw_source_payload);
  const quoteEvidence = apiServerAsRecord(normalizedPayload.quoteEvidence);
  const rawQuoteEvidence = apiServerAsRecord(rawPayload.quoteEvidence);
  const rawMarket = apiServerAsRecord(rawPayload.market);
  const normalizedMarket = apiServerAsRecord(normalizedPayload.market);
  const parsedVenueMarketSlug = row.venue_market_id.match(/^POLYMARKET:([^:]+):/i)?.[1] ?? null;

  return uniqueNonEmptyStrings([
    apiServerFirstString(normalizedPayload.quoteMatchedIdentifier, rawPayload.quoteMatchedIdentifier),
    apiServerFirstString(quoteEvidence.marketSlug, rawQuoteEvidence.marketSlug),
    apiServerFirstString(normalizedPayload.marketSlug, rawPayload.marketSlug),
    apiServerFirstString(normalizedPayload.slug, rawPayload.slug),
    apiServerFirstString(normalizedMarket.slug, rawMarket.slug),
    parsedVenueMarketSlug,
    apiServerFirstString(quoteEvidence.marketId, rawQuoteEvidence.marketId),
    apiServerFirstString(normalizedPayload.marketId, rawPayload.marketId),
    apiServerFirstString(normalizedMarket.id, rawMarket.id),
    apiServerFirstString(quoteEvidence.conditionId, rawQuoteEvidence.conditionId),
    apiServerFirstString(normalizedPayload.conditionId, rawPayload.conditionId)
  ]);
};

const collectLimitlessMetadataIdentifiers = (row: ResolutionProfileLookupRow): readonly string[] => {
  const normalizedPayload = apiServerAsRecord(row.vmp_normalized_payload);
  const rawPayload = apiServerAsRecord(row.vmp_raw_source_payload);
  const rawMarketDetail = apiServerAsRecord(rawPayload.marketDetail);
  const rawLimitlessMarketDetail = apiServerAsRecord(rawPayload.limitlessMarketDetail);
  const normalizedMarketDetail = apiServerAsRecord(normalizedPayload.marketDetail);
  const normalizedLimitlessMarketDetail = apiServerAsRecord(normalizedPayload.limitlessMarketDetail);
  const parsedVenueMarketSlug = row.venue_market_id.match(/^LIMITLESS:([^:]+):/i)?.[1] ?? null;
  const plainVenueMarketId = row.venue_market_id.includes(":") ? null : row.venue_market_id;

  return uniqueNonEmptyStrings([
    parsedVenueMarketSlug,
    plainVenueMarketId,
    apiServerFirstString(normalizedPayload.marketDetailSlug, rawPayload.marketDetailSlug),
    apiServerFirstString(normalizedPayload.slug, rawPayload.slug),
    apiServerFirstString(normalizedMarketDetail.slug, rawMarketDetail.slug),
    apiServerFirstString(normalizedLimitlessMarketDetail.slug, rawLimitlessMarketDetail.slug),
    apiServerFirstString(normalizedPayload.address, rawPayload.address),
    apiServerFirstString(normalizedMarketDetail.address, rawMarketDetail.address),
    apiServerFirstString(normalizedLimitlessMarketDetail.address, rawLimitlessMarketDetail.address)
  ]);
};

const OFFICIAL_VENUE_RULE_TEXT_FIELDS = [
  "resolutionRules",
  "resolution_rules",
  "resolutionRule",
  "resolution_rule",
  "resolutionRulesText",
  "resolution_rules_text",
  "rules",
  "rule",
  "description",
  "resolveDescription",
  "resolutionCriteria",
  "settlementRules",
  "settlement_rules"
] as const;

const OFFICIAL_VENUE_SOURCE_TEXT_FIELDS = [
  "resolutionSource",
  "resolution_source",
  "resolutionSourceUrl",
  "resolution_source_url",
  "source",
  "sourceName",
  "source_name",
  "resolver",
  "oracle",
  "oracleName",
  "oracle_name"
] as const;

const selectOfficialVenueRuleText = (
  payload: Record<string, unknown>,
  title: string | null
): string | null => {
  const candidates = collectOfficialStringFields(payload, OFFICIAL_VENUE_RULE_TEXT_FIELDS, 4);
  const normalizedTitle = normalizeOfficialComparableText(title ?? "");
  for (const candidate of candidates) {
    const sanitized = stripHtmlRules(candidate);
    if (!sanitized) {
      continue;
    }
    const normalized = normalizeOfficialComparableText(sanitized);
    if (!normalized || (normalizedTitle && normalized === normalizedTitle) || looksLikeGeneratedResolutionPlaceholder(normalized)) {
      continue;
    }
    if (looksLikeTrustedResolutionText(sanitized)) {
      return sanitized;
    }
  }
  return null;
};

const selectOfficialVenueSourceText = (
  payload: Record<string, unknown>,
  rulesText: string,
  venue: string
): string | null => {
  for (const candidate of collectOfficialStringFields(payload, OFFICIAL_VENUE_SOURCE_TEXT_FIELDS, 4)) {
    const sanitized = sanitizeOfficialVenueSourceText(candidate, venue);
    if (sanitized) {
      return sanitized;
    }
  }
  return sanitizeOfficialVenueSourceText(extractResolutionSourceText(rulesText), venue);
};

const sanitizeOfficialVenueSourceText = (
  value: string | null | undefined,
  venue: string
): string | null => {
  const sanitized = stripHtmlRules(value ?? null);
  if (!sanitized) {
    return null;
  }
  const normalized = normalizeOfficialComparableText(sanitized);
  const normalizedVenueAliases = officialVenueSourceAliases(venue);
  if (
    normalizedVenueAliases.has(normalized)
    || normalized === "opinion openapi market"
    || normalized === "predict market metadata"
    || normalized === "limitless public market surface"
    || normalized === "limitless public market detail"
    || normalized === "limitless persisted market detail"
  ) {
    return null;
  }
  if (extractFirstUrl(sanitized)) {
    return sanitized;
  }
  return /\b(source|oracle|resolver|according|official|resolution|settlement|rules)\b/i.test(sanitized)
    ? sanitized
    : null;
};

const officialVenueSourceAliases = (venue: string): ReadonlySet<string> => {
  const normalized = normalizeOfficialComparableText(venue);
  const aliases = new Set([normalized]);
  if (normalized === "predict" || normalized === "predict fun" || normalized === "predict_fun") {
    aliases.add("predict");
    aliases.add("predict fun");
  }
  return aliases;
};

const collectOfficialStringFields = (
  value: unknown,
  fieldNames: readonly string[],
  depth: number
): string[] => {
  if (depth < 0 || typeof value === "string") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectOfficialStringFields(entry, fieldNames, depth - 1));
  }
  const record = apiServerAsRecord(value);
  if (Object.keys(record).length === 0) {
    return [];
  }
  const direct = fieldNames.flatMap((field) => {
    const candidate = record[field];
    return typeof candidate === "string" && candidate.trim().length > 0 ? [candidate] : [];
  });
  const nested = Object.values(record).flatMap((entry) => collectOfficialStringFields(entry, fieldNames, depth - 1));
  return [...direct, ...nested];
};

const normalizeOfficialComparableText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const looksLikeGeneratedResolutionPlaceholder = (normalized: string): boolean =>
  /^(ath|fdv|token launch|first to hit|price|winner|nominee|champion|launch) by date\b/.test(normalized)
  || /^(ath|fdv|token launch|first to hit|price|winner|nominee|champion|launch)\b(?: [a-z0-9]+){0,8} \d{4} \d{2} \d{2}(?: \d{4} \d{2} \d{2})?$/.test(normalized);

const extractResolutionSourceText = (ruleText: string): string | null => {
  const paragraphs = ruleText
    .split(/\n{2,}|\r\n{2,}/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const sourceParagraphs = paragraphs.filter((paragraph) =>
    /resolution source|source for this market|according to|available at|will not be considered/i.test(paragraph)
  );
  return sourceParagraphs.length > 0 ? sourceParagraphs.join("\n\n") : null;
};

const extractFirstUrl = (text: string | null): string | null => {
  const match = text?.match(/https?:\/\/[^\s"',)]+/i);
  return match?.[0] ?? null;
};

const deriveVenueDeclaredOracleSource = (text: string | null | undefined): VenueDeclaredOracleSource | null => {
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\s+/g, " ").trim();

  if (/\bUMA\b|optimistic oracle/i.test(normalized)) {
    return {
      oracleType: "OPTIMISTIC_ORACLE",
      oracleName: "UMA"
    };
  }

  if (/\bKleros\b/i.test(normalized)) {
    return {
      oracleType: "ARBITRATION_ORACLE",
      oracleName: "Kleros"
    };
  }

  const exchangePair = normalized.match(/\b(Binance|Coinbase|Kraken|OKX|Bybit|Bitstamp|Bitfinex|Gemini)\b[^.,"\n]*?\b(BTC[\/_]USDT|BTCUSD|BTC[\/_]USD|ETH[\/_]USDT|ETHUSD|ETH[\/_]USD|SOL[\/_]USDT|SOLUSD|SOL[\/_]USD|[A-Z]{2,10}[\/_]USD[A-Z]?)\b/i);
  if (exchangePair) {
    return {
      oracleType: "EXCHANGE_PRICE_SOURCE",
      oracleName: `${canonicalSourceName(exchangePair[1]!)} ${normalizeOraclePair(exchangePair[2]!)}`
    };
  }

  const tradingViewSymbol = normalized.match(/\bTradingView\b[^.,"\n]*(?:symbol=)?([A-Z0-9_]+:[A-Z0-9_]+)/i);
  if (tradingViewSymbol) {
    return {
      oracleType: "PRICE_CHART_SOURCE",
      oracleName: `TradingView ${tradingViewSymbol[1]!.toUpperCase()}`
    };
  }

  const namedSource = normalized.match(/\bresolution source for this market is ([^,.]+)(?:,|\.)/i)
    ?? normalized.match(/\baccording to ([^,.]+)(?:,|\.)/i);
  if (namedSource) {
    return {
      oracleType: "VENUE_DECLARED_SOURCE",
      oracleName: normalizeDeclaredSourceName(namedSource[1]!)
    };
  }

  return null;
};

const canonicalSourceName = (value: string): string => {
  const normalized = value.toLowerCase();
  if (normalized === "okx") {
    return "OKX";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const normalizeOraclePair = (value: string): string => value.toUpperCase().replace("_", "/");

const normalizeDeclaredSourceName = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s+specifically\s+.*$/i, "")
    .trim()
    .slice(0, 120);

const defaultOracleSourceUrl = (source: VenueDeclaredOracleSource | null): string | null => {
  if (!source) {
    return null;
  }
  const name = source.oracleName.toLowerCase();
  if (name === "uma") {
    return "https://uma.xyz/";
  }
  if (name === "kleros") {
    return "https://kleros.io/";
  }
  return null;
};

const stripHtmlRules = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const stripped = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, "\"")
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped.length > 0 ? stripped : null;
};

const looksLikeTrustedResolutionText = (value: string | null | undefined): value is string => {
  if (!value || value.trim().length < 40) {
    return false;
  }
  return /\b(resolve|resolves|resolution|source|oracle|settle|settlement|outcome|will be considered|will not be considered)\b/i.test(value);
};

const selectTrustedResolutionText = (...values: readonly (string | null | undefined)[]): string | null => {
  for (const value of values) {
    const normalized = stripHtmlRules(value ?? null);
    if (looksLikeTrustedResolutionText(normalized)) {
      return normalized;
    }
  }
  return null;
};

const uniqueNonEmptyStrings = (values: readonly (string | null | undefined)[]): readonly string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
};

const apiServerAsRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const apiServerFirstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

const findResolutionProfileByVenueMarket = async (
  pool: Pool,
  venue: string,
  marketId: string
): Promise<NormalizedResolutionProfile | null> => {
  const result = await pool.query<ResolutionProfileLookupRow>(
    `${RESOLUTION_PROFILE_LOOKUP_SELECT}
      WHERE rp.venue = $1
        AND rp.venue_market_id = $2
      LIMIT 1`,
    [venue, marketId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const officialResolutionMetadata = await fetchOfficialVenueResolutionMetadata(row);
  if (officialResolutionMetadata) {
    await persistOfficialVenueResolutionMetadata(pool, row, officialResolutionMetadata);
  }
  await hydrateOfficialResolutionMetadataForEvent(pool, row.canonical_event_id, row.id);

  const metadata = {
    ...row.metadata,
    ...(officialResolutionMetadata
      ? {
        officialVenueRules: {
          fetchedBy: officialResolutionMetadata.fetchedBy,
          sourceUrl: officialResolutionMetadata.sourceUrl,
          resolver: officialResolutionMetadata.resolver,
          hydratedAt: new Date().toISOString()
        }
      }
      : {})
  };
  const trustedPrimaryResolutionText = officialResolutionMetadata?.primaryResolutionText
    ?? selectTrustedResolutionText(
      row.primary_resolution_text,
      row.vmp_resolution_rules_text,
      row.vmp_description,
      row.vrp_rule_text,
      row.supplemental_rules_text
    );
  const trustedSupplementalRulesText = officialResolutionMetadata?.supplementalRulesText
    ?? selectTrustedResolutionText(
      row.supplemental_rules_text,
      row.vmp_resolution_source,
      row.vrp_resolution_source
    );
  const derivedOracleSource = deriveVenueDeclaredOracleSource(
    officialResolutionMetadata?.resolutionSourceText
    ?? trustedSupplementalRulesText
    ?? trustedPrimaryResolutionText
  );

  return {
    id: row.id,
    venue: row.venue,
    venueMarketId: row.venue_market_id,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    oracleType: officialResolutionMetadata?.oracleType ?? derivedOracleSource?.oracleType ?? row.oracle_type,
    oracleName: officialResolutionMetadata?.oracleName ?? derivedOracleSource?.oracleName ?? row.oracle_name,
    resolutionAuthorityType: row.resolution_authority_type,
    primaryResolutionText: trustedPrimaryResolutionText,
    supplementalRulesText: trustedSupplementalRulesText,
    disputeWindowHours: row.dispute_window_hours,
    settlementLagHours: row.settlement_lag_hours,
    marketType: row.market_type,
    outcomeSchema: row.outcome_schema,
    hasAmbiguousTimeBoundary: row.has_ambiguous_time_boundary,
    hasAmbiguousJurisdictionBoundary: row.has_ambiguous_jurisdiction_boundary,
    hasAmbiguousSourceReference: row.has_ambiguous_source_reference,
    historicalDivergenceRate: row.historical_divergence_rate,
    metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
};

const parseOptionalNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const QUOTE_MAPPING_READINESS_WARMUP_LIMIT = 500;
const QUOTE_MAPPING_READINESS_WARMUP_INTERVAL_MS = 30_000;
const QUOTE_MAPPING_READINESS_STARTUP_WARMUP_TIMEOUT_MS = 2_000;
const QUOTE_MAPPING_READINESS_BACKGROUND_WARMUP_TIMEOUT_MS = 5_000;
const QUOTE_MAPPING_READINESS_WARMUP_TIMEOUT = Symbol("QUOTE_MAPPING_READINESS_WARMUP_TIMEOUT");

type QuoteMappingReadinessWarmupSource = {
  listApprovedReadiness?: (input: { limit: number }) => Promise<readonly unknown[]>;
};

const startQuoteMappingReadinessWarmup = (
  source: QuoteMappingReadinessWarmupSource,
  logger: Pick<Logger, "info" | "warn">
): (() => void) => {
  const interval = setInterval(() => {
    void warmQuoteMappingReadinessOnce(
      source,
      logger,
      "background",
      QUOTE_MAPPING_READINESS_BACKGROUND_WARMUP_TIMEOUT_MS
    );
  }, QUOTE_MAPPING_READINESS_WARMUP_INTERVAL_MS);
  interval.unref?.();
  return () => clearInterval(interval);
};

const warmQuoteMappingReadinessOnce = async (
  source: QuoteMappingReadinessWarmupSource,
  logger: Pick<Logger, "info" | "warn">,
  phase: "startup" | "background",
  timeoutMs: number
): Promise<void> => {
  if (!source.listApprovedReadiness) {
    return;
  }
  const startedAt = Date.now();
  try {
    const rows = await withQuoteMappingWarmupTimeout(
      source.listApprovedReadiness({ limit: QUOTE_MAPPING_READINESS_WARMUP_LIMIT }),
      timeoutMs
    );
    if (rows === QUOTE_MAPPING_READINESS_WARMUP_TIMEOUT) {
      logger.warn(
        { phase, timeoutMs, limit: QUOTE_MAPPING_READINESS_WARMUP_LIMIT },
        "Quote mapping readiness warmup timed out; resolver may still finish in the background."
      );
      return;
    }
    logger.info(
      {
        phase,
        rowCount: rows.length,
        elapsedMs: Date.now() - startedAt,
        limit: QUOTE_MAPPING_READINESS_WARMUP_LIMIT
      },
      "Quote mapping readiness cache warmed."
    );
  } catch (error) {
    logger.warn(
      { err: error, phase, limit: QUOTE_MAPPING_READINESS_WARMUP_LIMIT },
      "Quote mapping readiness warmup failed."
    );
  }
};

const withQuoteMappingWarmupTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | typeof QUOTE_MAPPING_READINESS_WARMUP_TIMEOUT> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof QUOTE_MAPPING_READINESS_WARMUP_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(QUOTE_MAPPING_READINESS_WARMUP_TIMEOUT), Math.max(1, timeoutMs));
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const result = await Promise.race([
      promise,
      new Promise<typeof VENUE_BALANCE_READ_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(VENUE_BALANCE_READ_TIMEOUT), timeoutMs);
      })
    ]);
    if (result === VENUE_BALANCE_READ_TIMEOUT) {
      throw new Error("VENUE_BALANCE_READ_TIMEOUT");
    }
    return result;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};
