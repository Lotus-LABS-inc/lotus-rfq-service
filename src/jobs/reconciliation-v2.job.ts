import { randomUUID } from "node:crypto";

import type { Logger } from "pino";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import type { RedisClient } from "../db/redis.js";
import {
  reconciliationMismatchTotal,
  reconciliationV2DiscrepanciesTotal,
  reconciliationV2FixesTotal,
  reconciliationV2InfraErrorTotal,
  reconciliationV2LockConflictTotal,
  reconciliationV2RunDurationMs,
  reconciliationV2RunsTotal,
  replayMissingTotal,
} from "../observability/metrics.js";
import type { ResolutionRiskAdminService } from "../api/admin/resolution-risk-admin-service.js";
import { OrderBook } from "../core/internal-engine/order-book.js";
import type { InternalOrder } from "../core/internal-engine/types.js";
import { ComboNettingCandidateRegistry } from "../core/combo-engine/combo-netting-candidate-registry.js";
import { Phase2BCandidateRegistry } from "../core/combo-engine/phase2b-candidate-registry.js";
import { ResidualVectorBuilder } from "../core/combo-engine/residual-vector-builder.js";
import type { ResidualVectorEntity, ResidualVectorLeg } from "../core/combo-engine/types.js";

export type ReconciliationV2Domain =
  | "routing"
  | "internal_cross"
  | "netting_phase2a"
  | "clearing_phase2b"
  | "replay"
  | "reservation"
  | "redis_indexes"
  | "resolution_risk";

export type ReconciliationV2InfraDomain = ReconciliationV2Domain | "job";
export type ReconciliationV2Severity = "warning" | "critical";

export interface ReconciliationV2Discrepancy {
  domain: ReconciliationV2Domain;
  code: string;
  severity: ReconciliationV2Severity;
  entityId: string;
  message: string;
  details: Record<string, unknown>;
  detectedAt: Date;
  fixApplied?: boolean;
}

export interface ReconciliationV2RunOptions {
  batchSize: number;
  dryRun?: boolean;
  autoFix?: boolean;
  domains?: readonly ReconciliationV2Domain[];
}

export interface ReconciliationV2Result {
  dryRun: boolean;
  autoFix: boolean;
  discrepancyCount: number;
  discrepancies: readonly ReconciliationV2Discrepancy[];
  countsByDomain: Record<string, number>;
  countsByCode: Record<string, number>;
}

interface ReconciliationV2Deps {
  pool: Pool;
  redis: RedisClient;
  logger: Pick<Logger, "info" | "warn" | "error">;
  resolutionRiskAdminService: ResolutionRiskAdminService;
  orderBook: OrderBook;
  comboNettingCandidateRegistry: ComboNettingCandidateRegistry;
  phase2bCandidateRegistry: Phase2BCandidateRegistry;
  residualVectorBuilder: ResidualVectorBuilder;
}

interface InternalOrderRow {
  id: string;
  market_id: string;
  user_id: string;
  side: "buy" | "sell";
  price: string;
  initial_size: string;
  remaining_size: string;
  status: "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";
  resolution_profile_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TradeRow {
  id: string;
  market_id: string;
  buy_order_id: string;
  sell_order_id: string;
}

interface ComboResidualLegRow {
  combo_id: string;
  user_id: string;
  state: string;
  leg_id: string;
  canonical_market_id: string;
  canonical_outcome_id: string;
  side: "buy" | "sell";
  remaining_size: string;
  price_hint: string | null;
  metadata: Record<string, unknown> | null;
}

interface RoutingPlanRow {
  id: string;
  rfq_id: string;
  reservation_token: string | null;
  state: string;
}

interface RouteStepIndexRow {
  routing_plan_id: string;
  step_index: number | null;
}

interface ClearingRoundRow {
  id: string;
  compatibility_bucket: string;
}

interface ClearingParticipantRow {
  combo_or_order_id: string;
}

interface Phase2BResidualEntity {
  bucketId: string;
  entity: ResidualVectorEntity;
}

interface ResidualComboPageRow {
  combo_id: string;
}

interface ResolutionRiskEventRow {
  canonical_event_id: string;
}

interface ActiveRunContext {
  runId: string;
  batchSize: number;
  dryRun: boolean;
  autoFix: boolean;
  domains: readonly ReconciliationV2Domain[];
}

const ALL_DOMAINS: readonly ReconciliationV2Domain[] = [
  "routing",
  "internal_cross",
  "netting_phase2a",
  "clearing_phase2b",
  "replay",
  "reservation",
  "redis_indexes",
  "resolution_risk",
] as const;

const ACTIVE_INTERNAL_ORDER_STATUSES = new Set(["OPEN", "PARTIAL"]);
const TERMINAL_INTERNAL_ORDER_STATUSES = new Set(["FILLED", "CANCELLED"]);
const TERMINAL_ROUTING_PLAN_STATES = new Set(["COMPLETED", "FAILED", "UNWOUND"]);
const RUN_LOCK_KEY = "phase3a:reconciliation_v2:lock";
const RUN_LOCK_TTL_MS = 300_000;
const RENEW_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], tonumber(ARGV[2]))
end
return 0
`;
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export class ReconciliationV2LockConflictError extends Error {
  public readonly code = "reconciliation_v2_lock_conflict";

  public constructor(
    public readonly runId: string,
    public readonly lockKey: string,
  ) {
    super(`ReconciliationV2 lock conflict for key ${lockKey}.`);
    this.name = "ReconciliationV2LockConflictError";
  }
}

export class ReconciliationV2InfraError extends Error {
  public readonly code = "reconciliation_v2_infra_error";
  public readonly cause: unknown;

  public constructor(
    public readonly domain: ReconciliationV2InfraDomain,
    public readonly operation: string,
    public readonly runId: string,
    cause: unknown,
  ) {
    super(`ReconciliationV2 infrastructure failure during ${operation} (${domain}).`);
    this.name = "ReconciliationV2InfraError";
    this.cause = cause;
  }
}

export class ReconciliationV2Job {
  private readonly pool: Pool;
  private readonly redis: RedisClient;
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;
  private readonly resolutionRiskAdminService: ResolutionRiskAdminService;
  private readonly orderBook: OrderBook;
  private readonly comboNettingCandidateRegistry: ComboNettingCandidateRegistry;
  private readonly phase2bCandidateRegistry: Phase2BCandidateRegistry;
  private readonly residualVectorBuilder: ResidualVectorBuilder;
  private activeRunContext: ActiveRunContext | null = null;

  public constructor(deps: ReconciliationV2Deps) {
    this.pool = deps.pool;
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.resolutionRiskAdminService = deps.resolutionRiskAdminService;
    this.orderBook = deps.orderBook;
    this.comboNettingCandidateRegistry = deps.comboNettingCandidateRegistry;
    this.phase2bCandidateRegistry = deps.phase2bCandidateRegistry;
    this.residualVectorBuilder = deps.residualVectorBuilder;
  }

  public async run(options: ReconciliationV2RunOptions): Promise<ReconciliationV2Result> {
    const batchSize = this.resolveBatchSize(options.batchSize);
    const dryRun = options.dryRun ?? true;
    const autoFix = options.autoFix ?? false;
    const domains = this.resolveDomains(options.domains);
    const runId = randomUUID();
    const discrepancies: ReconciliationV2Discrepancy[] = [];
    const startedAt = performance.now();

    this.activeRunContext = { runId, batchSize, dryRun, autoFix, domains };

    try {
      await this.acquireRunLock(runId);
      this.logger.info({ runId, batchSize, dryRun, autoFix, domains, lockKey: RUN_LOCK_KEY }, "ReconciliationV2 run started.");

      for (const domain of domains) {
        const next = await this.runDomain(domain, { batchSize, dryRun, autoFix });
        discrepancies.push(...next);
        await this.renewRunLock("job", `domain_complete:${domain}`);
      }

      const result = this.buildResult(discrepancies, dryRun, autoFix);
      reconciliationV2RunsTotal.labels("success", String(dryRun)).inc();
      this.logger.info(
        { runId, discrepancyCount: result.discrepancyCount, countsByDomain: result.countsByDomain },
        "ReconciliationV2 run completed.",
      );
      return result;
    } catch (error) {
      reconciliationV2RunsTotal.labels("error", String(dryRun)).inc();
      this.logger.error(
        { err: error, runId, batchSize, dryRun, autoFix, domains, lockKey: RUN_LOCK_KEY },
        "ReconciliationV2 run failed.",
      );
      throw error;
    } finally {
      reconciliationV2RunDurationMs.observe(performance.now() - startedAt);
      await this.releaseRunLock(runId);
      this.activeRunContext = null;
    }
  }

  private resolveBatchSize(batchSize: number): number {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new Error("ReconciliationV2 batchSize must be a positive integer.");
    }
    return batchSize;
  }

  private resolveDomains(domains?: readonly ReconciliationV2Domain[]): readonly ReconciliationV2Domain[] {
    if (!domains || domains.length === 0) {
      return ALL_DOMAINS;
    }
    return [...new Set(domains)];
  }

  private async acquireRunLock(runId: string): Promise<void> {
    const outcome = await this.safeSet("job", "lock_acquire", RUN_LOCK_KEY, runId, "PX", RUN_LOCK_TTL_MS, "NX");
    if (outcome !== "OK") {
      reconciliationV2LockConflictTotal.inc();
      throw new ReconciliationV2LockConflictError(runId, RUN_LOCK_KEY);
    }
  }

  private async renewRunLock(domain: ReconciliationV2InfraDomain, operation: string): Promise<void> {
    const activeRun = this.requireActiveRun();
    const result = await this.safeEval(
      domain,
      `lock_renew:${operation}`,
      RENEW_LOCK_SCRIPT,
      1,
      RUN_LOCK_KEY,
      activeRun.runId,
      String(RUN_LOCK_TTL_MS),
    );
    if (Number(result) !== 1) {
      reconciliationV2LockConflictTotal.inc();
      throw new ReconciliationV2LockConflictError(activeRun.runId, RUN_LOCK_KEY);
    }
  }

  private async releaseRunLock(runId: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, RUN_LOCK_KEY, runId);
    } catch (error) {
      reconciliationV2InfraErrorTotal.labels("job", "lock_release").inc();
      this.logger.warn({ err: error, runId, lockKey: RUN_LOCK_KEY }, "Failed to release ReconciliationV2 run lock.");
    }
  }

  private requireActiveRun(): ActiveRunContext {
    if (!this.activeRunContext) {
      throw new Error("ReconciliationV2 run context is not active.");
    }
    return this.activeRunContext;
  }

  private async runDomain(
    domain: ReconciliationV2Domain,
    options: { batchSize: number; dryRun: boolean; autoFix: boolean },
  ): Promise<ReconciliationV2Discrepancy[]> {
    switch (domain) {
      case "routing":
        return this.reconcileRouting(options.batchSize);
      case "internal_cross":
        return this.reconcileInternalCross(options);
      case "netting_phase2a":
        return this.reconcileNettingPhase2A(options);
      case "clearing_phase2b":
        return this.reconcileClearingPhase2B(options);
      case "replay":
        return this.reconcileReplay(options.batchSize);
      case "reservation":
        return this.reconcileReservations(options.batchSize);
      case "redis_indexes":
        return this.reconcileRedisIndexes(options);
      case "resolution_risk":
        return this.reconcileResolutionRisk(options.batchSize);
      default:
        return [];
    }
  }

  private async collectPagedRows<T>(input: {
    domain: ReconciliationV2InfraDomain;
    operation: string;
    batchSize: number;
    fetchPage: (cursor: string | null) => Promise<readonly T[]>;
    cursorOf: (row: T) => string;
  }): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | null = null;

    while (true) {
      const page = [...await input.fetchPage(cursor)];
      if (page.length === 0) {
        return rows;
      }

      rows.push(...page);
      cursor = input.cursorOf(page[page.length - 1]!);
      await this.renewRunLock(input.domain, `${input.operation}:${cursor}`);

      if (page.length < input.batchSize) {
        return rows;
      }
    }
  }

  private buildResult(discrepancies: readonly ReconciliationV2Discrepancy[], dryRun: boolean, autoFix: boolean): ReconciliationV2Result {
    const countsByDomain: Record<string, number> = {};
    const countsByCode: Record<string, number> = {};
    for (const discrepancy of discrepancies) {
      countsByDomain[discrepancy.domain] = (countsByDomain[discrepancy.domain] ?? 0) + 1;
      countsByCode[discrepancy.code] = (countsByCode[discrepancy.code] ?? 0) + 1;
    }

    return {
      dryRun,
      autoFix,
      discrepancyCount: discrepancies.length,
      discrepancies,
      countsByDomain,
      countsByCode,
    };
  }

  private emitDiscrepancies(discrepancies: readonly ReconciliationV2Discrepancy[]): ReconciliationV2Discrepancy[] {
    for (const discrepancy of discrepancies) {
      reconciliationV2DiscrepanciesTotal.labels(discrepancy.domain, discrepancy.code, discrepancy.severity).inc();
      reconciliationMismatchTotal.labels(discrepancy.domain, discrepancy.code, discrepancy.severity).inc();
      if (discrepancy.code === "REPLAY_ENVELOPE_MISSING") {
        const decisionType =
          typeof discrepancy.details.decisionType === "string" ? discrepancy.details.decisionType : "UNKNOWN";
        replayMissingTotal.labels(decisionType).inc();
      }
      this.logger.warn({ discrepancy }, "ReconciliationV2 discrepancy detected.");
    }
    return [...discrepancies];
  }

  private discrepancy(
    domain: ReconciliationV2Domain,
    code: string,
    severity: ReconciliationV2Severity,
    entityId: string,
    message: string,
    details: Record<string, unknown>,
    fixApplied?: boolean,
  ): ReconciliationV2Discrepancy {
    return {
      domain,
      code,
      severity,
      entityId,
      message,
      details,
      detectedAt: new Date(),
      ...(fixApplied !== undefined ? { fixApplied } : {}),
    };
  }

  private areStepIndexesContiguous(indexes: readonly number[]): boolean {
    const unique = new Set(indexes);
    if (unique.size !== indexes.length) {
      return false;
    }
    const sorted = [...indexes].sort((a, b) => a - b);
    for (let index = 0; index < sorted.length; index += 1) {
      if (sorted[index] !== index) {
        return false;
      }
    }
    return true;
  }

  private async reconcileRouting(batchSize: number): Promise<ReconciliationV2Discrepancy[]> {
    const discrepancies: ReconciliationV2Discrepancy[] = [];

    const orphanSteps = await this.safeQuery<{ id: string; routing_plan_id: string }>(
      "routing",
      "orphan_route_steps",
      `SELECT rs.id::text AS id, rs.routing_plan_id::text AS routing_plan_id
         FROM route_steps rs
         LEFT JOIN routing_plans rp ON rp.id = rs.routing_plan_id
        WHERE rp.id IS NULL`,
    );
    for (const row of orphanSteps.rows) {
      discrepancies.push(
        this.discrepancy(
          "routing",
          "ORPHAN_ROUTE_STEP",
          "critical",
          row.id,
          "Route step references missing routing plan.",
          { routingPlanId: row.routing_plan_id },
        ),
      );
    }

    const emptyPlans = await this.collectPagedRows<RoutingPlanRow>({
      domain: "routing",
      operation: "routing_plans_empty_page",
      batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<RoutingPlanRow>(
            "routing",
            "routing_plans_empty_page",
            `SELECT rp.id::text AS id, rp.rfq_id::text, rp.reservation_token, rp.state
               FROM routing_plans rp
               LEFT JOIN route_steps rs ON rs.routing_plan_id = rp.id
              WHERE ($1::text IS NULL OR rp.id::text > $1)
                AND rp.state <> ALL($2::text[])
              GROUP BY rp.id, rp.rfq_id, rp.reservation_token, rp.state
             HAVING COUNT(rs.id) = 0
              ORDER BY rp.id::text ASC
              LIMIT $3`,
            [cursor, [...TERMINAL_ROUTING_PLAN_STATES], batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });
    for (const row of emptyPlans) {
      discrepancies.push(
        this.discrepancy(
          "routing",
          "EMPTY_ROUTING_PLAN",
          "warning",
          row.id,
          "Non-terminal routing plan has no route steps.",
          { rfqId: row.rfq_id, state: row.state },
        ),
      );
    }

    const stepIndexes = await this.safeQuery<RouteStepIndexRow>(
      "routing",
      "route_step_indexes",
      `SELECT routing_plan_id::text AS routing_plan_id, step_index
         FROM route_steps
        ORDER BY routing_plan_id::text ASC, step_index ASC NULLS FIRST`,
    );
    const byPlan = new Map<string, number[]>();
    for (const row of stepIndexes.rows) {
      if (row.step_index === null) {
        continue;
      }
      const existing = byPlan.get(row.routing_plan_id) ?? [];
      existing.push(row.step_index);
      byPlan.set(row.routing_plan_id, existing);
    }
    for (const [planId, indexes] of byPlan) {
      if (!this.areStepIndexesContiguous(indexes)) {
        discrepancies.push(
          this.discrepancy(
            "routing",
            "NON_CONTIGUOUS_ROUTE_STEPS",
            "warning",
            planId,
            "Route step indexes contain gaps or duplicates.",
            { stepIndexes: indexes },
          ),
        );
      }
    }

    return this.emitDiscrepancies(discrepancies);
  }

  private async reconcileInternalCross(options: {
    batchSize: number;
    dryRun: boolean;
    autoFix: boolean;
  }): Promise<ReconciliationV2Discrepancy[]> {
    const discrepancies: ReconciliationV2Discrepancy[] = [];
    const trades = await this.collectPagedRows<TradeRow>({
      domain: "internal_cross",
      operation: "trades_page",
      batchSize: options.batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<TradeRow>(
            "internal_cross",
            "trades_page",
            `SELECT id::text, market_id::text, buy_order_id::text, sell_order_id::text
               FROM trades
              WHERE ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [cursor, options.batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });

    for (const trade of trades) {
      const buyOrder = await this.loadInternalOrderById(trade.buy_order_id, "internal_cross", "trade_buy_order_lookup");
      const sellOrder = await this.loadInternalOrderById(trade.sell_order_id, "internal_cross", "trade_sell_order_lookup");
      if (buyOrder === null || sellOrder === null) {
        discrepancies.push(
          this.discrepancy(
            "internal_cross",
            "INTERNAL_CROSS_TRADE_ORDER_MISSING",
            "critical",
            trade.id,
            "Internal cross trade references a missing internal order.",
            {
              marketId: trade.market_id,
              buyOrderId: trade.buy_order_id,
              sellOrderId: trade.sell_order_id,
              missingBuyOrder: buyOrder === null,
              missingSellOrder: sellOrder === null,
            },
          ),
        );
      }
    }

    const orders = await this.collectPagedRows<InternalOrderRow>({
      domain: "internal_cross",
      operation: "internal_orders_page",
      batchSize: options.batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<InternalOrderRow>(
            "internal_cross",
            "internal_orders_page",
            `SELECT id::text, market_id::text, user_id::text, side, price::text, initial_size::text, remaining_size::text,
                    status, NULL::text AS resolution_profile_id, created_at, updated_at
               FROM internal_orders
              WHERE ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [cursor, options.batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });

    for (const row of orders) {
      const snapshot = await this.safeOrderSnapshot("internal_cross", row.id);
      if (ACTIVE_INTERNAL_ORDER_STATUSES.has(row.status) && snapshot.raw === null) {
        let fixApplied = false;
        if (!options.dryRun && options.autoFix) {
          try {
            await this.orderBook.addOrder(row as InternalOrder);
            fixApplied = true;
            reconciliationV2FixesTotal.labels("internal_cross", "POSTGRES_ACTIVE_REDIS_MISSING", "applied").inc();
          } catch (error) {
            reconciliationV2FixesTotal.labels("internal_cross", "POSTGRES_ACTIVE_REDIS_MISSING", "failed").inc();
            throw this.infraError("internal_cross", "rebuild_internal_cross_order_snapshot", error);
          }
        }
        discrepancies.push(
          this.discrepancy(
            "internal_cross",
            "POSTGRES_ACTIVE_REDIS_MISSING",
            "critical",
            row.id,
            "Active internal order is missing from Redis order book.",
            { marketId: row.market_id, status: row.status },
            fixApplied,
          ),
        );
      }

      if (TERMINAL_INTERNAL_ORDER_STATUSES.has(row.status) && snapshot.raw !== null) {
        let fixApplied = false;
        if (!options.dryRun && options.autoFix) {
          try {
            await this.orderBook.removeOrder(row.id);
            fixApplied = true;
            reconciliationV2FixesTotal.labels("internal_cross", "REDIS_STALE_TERMINAL_ORDER", "applied").inc();
          } catch (error) {
            reconciliationV2FixesTotal.labels("internal_cross", "REDIS_STALE_TERMINAL_ORDER", "failed").inc();
            throw this.infraError("internal_cross", "remove_internal_cross_order_snapshot", error);
          }
        }
        discrepancies.push(
          this.discrepancy(
            "internal_cross",
            "REDIS_STALE_TERMINAL_ORDER",
            "warning",
            row.id,
            "Terminal internal order is still present in Redis order book.",
            { marketId: row.market_id, status: row.status },
            fixApplied,
          ),
        );
      }
    }

    return this.emitDiscrepancies(discrepancies);
  }

  private async reconcileNettingPhase2A(options: {
    batchSize: number;
    dryRun: boolean;
    autoFix: boolean;
  }): Promise<ReconciliationV2Discrepancy[]> {
    const discrepancies: ReconciliationV2Discrepancy[] = [];
    const residualCombos = await this.loadResidualComboLegRows("netting_phase2a", options.batchSize);
    const combos = this.groupResidualCombos(residualCombos);
    const groups = await this.collectPagedRows<{
      id: string;
      incoming_combo_id: string;
      matched_combo_id: string;
      match_leg_count: number;
      incoming_exists: string | null;
      matched_exists: string | null;
    }>({
      domain: "netting_phase2a",
      operation: "combo_netting_groups_page",
      batchSize: options.batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<{
            id: string;
            incoming_combo_id: string;
            matched_combo_id: string;
            match_leg_count: number;
            incoming_exists: string | null;
            matched_exists: string | null;
          }>(
            "netting_phase2a",
            "combo_netting_groups_page",
            `SELECT g.id::text,
                    g.incoming_combo_id::text,
                    g.matched_combo_id::text,
                    COUNT(ml.id)::int AS match_leg_count,
                    incoming.id::text AS incoming_exists,
                    matched.id::text AS matched_exists
               FROM combo_netting_groups g
               LEFT JOIN combo_netting_match_legs ml ON ml.netting_group_id = g.id
               LEFT JOIN combo_rfqs incoming ON incoming.id = g.incoming_combo_id
               LEFT JOIN combo_rfqs matched ON matched.id = g.matched_combo_id
              WHERE ($1::text IS NULL OR g.id::text > $1)
              GROUP BY g.id, g.incoming_combo_id, g.matched_combo_id, incoming.id, matched.id
              ORDER BY g.id::text ASC
              LIMIT $2`,
            [cursor, options.batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });

    for (const group of groups) {
      if (group.match_leg_count === 0) {
        discrepancies.push(
          this.discrepancy(
            "netting_phase2a",
            "NETTING_GROUP_MATCH_LEGS_MISSING",
            "critical",
            group.id,
            "Phase 2A netting group has no linked matched legs.",
            {
              incomingComboId: group.incoming_combo_id,
              matchedComboId: group.matched_combo_id,
            },
          ),
        );
      }

      if (group.incoming_exists === null || group.matched_exists === null) {
        discrepancies.push(
          this.discrepancy(
            "netting_phase2a",
            "NETTING_GROUP_COMBO_MISSING",
            "critical",
            group.id,
            "Phase 2A netting group references a missing combo RFQ.",
            {
              incomingComboId: group.incoming_combo_id,
              matchedComboId: group.matched_combo_id,
              missingIncomingCombo: group.incoming_exists === null,
              missingMatchedCombo: group.matched_exists === null,
            },
          ),
        );
      }
    }

    for (const combo of combos) {
      const reverseKey = this.comboNettingCandidateRegistry.comboLegsKey(combo.id);
      const reverseMembers = await this.safeSmembers("netting_phase2a", "combo_registry_reverse_members", reverseKey);
      if (reverseMembers.length > 0) {
        continue;
      }

      let fixApplied = false;
      if (!options.dryRun && options.autoFix) {
        try {
          await this.comboNettingCandidateRegistry.registerComboCandidate({
            id: combo.id,
            legs: combo.legs.map((leg) => ({
              id: leg.leg_id,
              marketId: leg.canonical_market_id,
              outcomeId: leg.canonical_outcome_id,
              side: leg.side,
            })),
          });
          fixApplied = true;
          reconciliationV2FixesTotal.labels("netting_phase2a", "COMBO_NET_REGISTRY_MISSING", "applied").inc();
        } catch (error) {
          reconciliationV2FixesTotal.labels("netting_phase2a", "COMBO_NET_REGISTRY_MISSING", "failed").inc();
          throw this.infraError("netting_phase2a", "combo_registry_rebuild", error);
        }
      }

      discrepancies.push(
        this.discrepancy(
          "netting_phase2a",
          "COMBO_NET_REGISTRY_MISSING",
          "warning",
          combo.id,
          "Residual combo is missing from Phase 2A candidate registry.",
          { legCount: combo.legs.length },
          fixApplied,
        ),
      );
    }

    return this.emitDiscrepancies(discrepancies);
  }

  private async reconcileClearingPhase2B(options: {
    batchSize: number;
    dryRun: boolean;
    autoFix: boolean;
  }): Promise<ReconciliationV2Discrepancy[]> {
    const residualEntities = await this.loadPhase2BResidualEntities(options.batchSize);
    const discrepancies: ReconciliationV2Discrepancy[] = [];
    const rounds = await this.collectPagedRows<{
      id: string;
      participant_count: number;
      leg_match_count: number;
    }>({
      domain: "clearing_phase2b",
      operation: "clearing_rounds_page",
      batchSize: options.batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<{
            id: string;
            participant_count: number;
            leg_match_count: number;
          }>(
            "clearing_phase2b",
            "clearing_rounds_page",
            `SELECT r.id::text,
                    COUNT(DISTINCT p.id)::int AS participant_count,
                    COUNT(DISTINCT lm.id)::int AS leg_match_count
               FROM clearing_rounds r
               LEFT JOIN clearing_round_participants p ON p.clearing_round_id = r.id
               LEFT JOIN clearing_round_leg_matches lm ON lm.clearing_round_id = r.id
              WHERE ($1::text IS NULL OR r.id::text > $1)
              GROUP BY r.id
              ORDER BY r.id::text ASC
              LIMIT $2`,
            [cursor, options.batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });
    const missingParticipantEntities = await this.collectPagedRows<{
      participant_id: string;
      round_id: string;
      combo_or_order_id: string;
    }>({
      domain: "clearing_phase2b",
      operation: "clearing_participants_missing_page",
      batchSize: options.batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<{
            participant_id: string;
            round_id: string;
            combo_or_order_id: string;
          }>(
            "clearing_phase2b",
            "clearing_participants_missing_page",
            `SELECT p.id::text AS participant_id,
                    p.clearing_round_id::text AS round_id,
                    p.combo_or_order_id::text AS combo_or_order_id
               FROM clearing_round_participants p
               LEFT JOIN combo_rfqs c ON c.id::text = p.combo_or_order_id::text
              WHERE ($1::text IS NULL OR p.id::text > $1)
                AND c.id IS NULL
              ORDER BY p.id::text ASC
              LIMIT $2`,
            [cursor, options.batchSize],
          )
        ).rows,
      cursorOf: (row) => row.participant_id,
    });

    for (const round of rounds) {
      if (round.participant_count === 0) {
        discrepancies.push(this.discrepancy("clearing_phase2b", "CLEARING_ROUND_PARTICIPANTS_MISSING", "critical", round.id, "Phase 2B clearing round has no participants.", {}));
      }
      if (round.leg_match_count === 0) {
        discrepancies.push(this.discrepancy("clearing_phase2b", "CLEARING_ROUND_LEG_MATCHES_MISSING", "critical", round.id, "Phase 2B clearing round has no linked leg matches.", {}));
      }
    }

    for (const row of missingParticipantEntities) {
      discrepancies.push(
        this.discrepancy(
          "clearing_phase2b",
          "CLEARING_PARTICIPANT_ENTITY_MISSING",
          "critical",
          row.round_id,
          "Phase 2B clearing participant references a missing combo entity.",
          {
            participantId: row.participant_id,
            comboOrOrderId: row.combo_or_order_id,
          },
        ),
      );
    }

    for (const item of residualEntities) {
      const snapshot = await this.safePhase2BEntitySnapshot("clearing_phase2b", item.entity.entityId);
      if (snapshot !== null) {
        continue;
      }

      let fixApplied = false;
      if (!options.dryRun && options.autoFix) {
        try {
          await this.phase2bCandidateRegistry.registerEntity(this.residualVectorBuilder.build(item.entity));
          fixApplied = true;
          reconciliationV2FixesTotal.labels("clearing_phase2b", "CLEARING_REGISTRY_MISSING", "applied").inc();
        } catch (error) {
          reconciliationV2FixesTotal.labels("clearing_phase2b", "CLEARING_REGISTRY_MISSING", "failed").inc();
          throw this.infraError("clearing_phase2b", "clearing_registry_rebuild", error);
        }
      }

      discrepancies.push(
        this.discrepancy(
          "clearing_phase2b",
          "CLEARING_REGISTRY_MISSING",
          "warning",
          item.entity.entityId,
          "Residual clearing entity is missing from the Phase 2B registry.",
          { bucketId: item.bucketId },
          fixApplied,
        ),
      );
    }

    return this.emitDiscrepancies(discrepancies);
  }

  private async reconcileReplay(batchSize: number): Promise<ReconciliationV2Discrepancy[]> {
    const discrepancies: ReconciliationV2Discrepancy[] = [];

    const routingPlans = await this.collectPagedRows<{ id: string; rfq_id: string }>({
      domain: "replay",
      operation: "routing_plans_page",
      batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<{ id: string; rfq_id: string }>(
            "replay",
            "routing_plans_page",
            `SELECT id::text, rfq_id::text
               FROM routing_plans
              WHERE ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [cursor, batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });
    for (const row of routingPlans) {
      const replay = await this.safeQuery<{ id: string }>(
        "replay",
        "routing_plan_replay_lookup",
        `SELECT id::text
           FROM replay_envelopes
          WHERE decision_type = 'SOR_PLAN'
            AND entity_id = $1
          LIMIT 1`,
        [row.rfq_id],
      );
      if (replay.rowCount === 0) {
        discrepancies.push(this.discrepancy("replay", "REPLAY_ENVELOPE_MISSING", "critical", row.rfq_id, "Routing plan RFQ is missing required replay envelope.", { decisionType: "SOR_PLAN" }));
      }
    }

    const nettingGroups = await this.collectPagedRows<{ id: string; incoming_combo_id: string }>({
      domain: "replay",
      operation: "replay_netting_groups_page",
      batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<{ id: string; incoming_combo_id: string }>(
            "replay",
            "replay_netting_groups_page",
            `SELECT id::text, incoming_combo_id::text
               FROM combo_netting_groups
              WHERE ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [cursor, batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });
    for (const row of nettingGroups) {
      const replay = await this.safeQuery<{ id: string }>(
        "replay",
        "netting_replay_lookup",
        `SELECT id::text
           FROM replay_envelopes
          WHERE decision_type = 'NETTING_PHASE2A'
            AND entity_id = $1
          LIMIT 1`,
        [row.incoming_combo_id],
      );
      if (replay.rowCount === 0) {
        discrepancies.push(this.discrepancy("replay", "REPLAY_ENVELOPE_MISSING", "critical", row.incoming_combo_id, "Phase 2A netting decision is missing replay envelope.", { decisionType: "NETTING_PHASE2A" }));
      }
    }

    const trades = await this.collectPagedRows<TradeRow>({
      domain: "replay",
      operation: "replay_trades_page",
      batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<TradeRow>(
            "replay",
            "replay_trades_page",
            `SELECT id::text, market_id::text, buy_order_id::text, sell_order_id::text
               FROM trades
              WHERE ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [cursor, batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });
    for (const trade of trades) {
      for (const orderId of new Set([trade.buy_order_id, trade.sell_order_id])) {
        const replay = await this.safeQuery<{ id: string }>(
          "replay",
          "internal_cross_replay_lookup",
          `SELECT id::text
             FROM replay_envelopes
            WHERE decision_type = 'INTERNAL_CROSS'
              AND entity_id = $1
            LIMIT 1`,
          [orderId],
        );
        if (replay.rowCount === 0) {
          discrepancies.push(this.discrepancy("replay", "REPLAY_ENVELOPE_MISSING", "critical", trade.id, "Internal cross decision is missing replay envelope.", { decisionType: "INTERNAL_CROSS", expectedEntityId: orderId }));
        }
      }
    }

    const clearingRounds = await this.collectPagedRows<ClearingRoundRow>({
      domain: "replay",
      operation: "replay_clearing_rounds_page",
      batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<ClearingRoundRow>(
            "replay",
            "replay_clearing_rounds_page",
            `SELECT id::text, compatibility_bucket
               FROM clearing_rounds
              WHERE ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [cursor, batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });
    for (const row of clearingRounds) {
      const participants = await this.safeQuery<ClearingParticipantRow>(
        "replay",
        "clearing_participants_lookup",
        `SELECT combo_or_order_id::text AS combo_or_order_id
           FROM clearing_round_participants
          WHERE clearing_round_id = $1
          ORDER BY combo_or_order_id ASC`,
        [row.id],
      );
      const entityId = `${row.compatibility_bucket}:${participants.rows.map((item) => item.combo_or_order_id).join("|")}`;
      const replay = await this.safeQuery<{ id: string }>(
        "replay",
        "clearing_replay_lookup",
        `SELECT id::text
           FROM replay_envelopes
          WHERE decision_type = 'CLEARING_PHASE2B'
            AND entity_id = $1
          LIMIT 1`,
        [entityId],
      );
      if (replay.rowCount === 0) {
        discrepancies.push(this.discrepancy("replay", "REPLAY_ENVELOPE_MISSING", "critical", row.id, "Phase 2B clearing decision is missing replay envelope.", { decisionType: "CLEARING_PHASE2B", expectedEntityId: entityId }));
      }
    }

    return this.emitDiscrepancies(discrepancies);
  }

  private async reconcileReservations(batchSize: number): Promise<ReconciliationV2Discrepancy[]> {
    const discrepancies: ReconciliationV2Discrepancy[] = [];
    const plans = await this.collectPagedRows<RoutingPlanRow>({
      domain: "reservation",
      operation: "reservation_plans_page",
      batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<RoutingPlanRow>(
            "reservation",
            "reservation_plans_page",
            `SELECT id::text, rfq_id::text, reservation_token, state
               FROM routing_plans
              WHERE reservation_token IS NOT NULL
                AND ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [cursor, batchSize],
          )
        ).rows,
      cursorOf: (row) => row.id,
    });

    for (const plan of plans) {
      const lockKey = `risk:lock:exec:${plan.rfq_id}`;
      const lockValue = await this.safeGet("reservation", "reservation_lock_lookup", lockKey);
      if (lockValue === null) {
        discrepancies.push(this.discrepancy("reservation", "MISSING_RESERVATION_LOCK", "warning", plan.id, "Reservation token exists in Postgres but Redis reservation lock is missing.", { rfqId: plan.rfq_id, reservationToken: plan.reservation_token }));
      } else if (lockValue !== plan.reservation_token) {
        discrepancies.push(this.discrepancy("reservation", "RESERVATION_TOKEN_MISMATCH", "critical", plan.id, "Reservation lock token does not match routing plan reservation token.", { rfqId: plan.rfq_id, expected: plan.reservation_token, actual: lockValue }));
      }

      const journal = await this.safeQuery<{ id: string }>(
        "reservation",
        "reservation_journal_lookup",
        `SELECT id::text
           FROM exposure_journal
          WHERE source = 'pre-exec-reserve'
            AND payload->>'reservationToken' = $1
          LIMIT 1`,
        [plan.reservation_token],
      );
      if (journal.rowCount === 0) {
        discrepancies.push(this.discrepancy("reservation", "MISSING_RESERVATION_JOURNAL", "critical", plan.id, "Reservation token is missing pre-exec reserve journal entry.", { rfqId: plan.rfq_id, reservationToken: plan.reservation_token }));
      }
    }

    const staleLocks = await this.scanKeys("reservation", "reservation_lock_scan", "risk:lock:exec:*", batchSize);
    for (const key of staleLocks) {
      const rfqId = key.slice("risk:lock:exec:".length);
      const plan = await this.safeQuery<{ id: string; reservation_token: string | null }>(
        "reservation",
        "reservation_plan_lookup",
        `SELECT id::text, reservation_token
           FROM routing_plans
          WHERE rfq_id = $1
            AND reservation_token IS NOT NULL
          LIMIT 1`,
        [rfqId],
      );
      if (plan.rowCount === 0) {
        discrepancies.push(this.discrepancy("reservation", "STALE_RESERVATION_LOCK", "warning", key, "Redis reservation lock exists without a matching routing plan reservation token.", { rfqId }));
      }
    }

    return this.emitDiscrepancies(discrepancies);
  }

  private async reconcileRedisIndexes(options: {
    batchSize: number;
    dryRun: boolean;
    autoFix: boolean;
  }): Promise<ReconciliationV2Discrepancy[]> {
    const discrepancies: ReconciliationV2Discrepancy[] = [];
    discrepancies.push(...(await this.reconcileInternalCross(options)).map((item) => ({ ...item, domain: "redis_indexes" as const })));
    discrepancies.push(...(await this.reconcileNettingPhase2A(options)).map((item) => ({ ...item, domain: "redis_indexes" as const })));
    discrepancies.push(...(await this.reconcileClearingPhase2B(options)).map((item) => ({ ...item, domain: "redis_indexes" as const })));
    return discrepancies;
  }

  private async reconcileResolutionRisk(batchSize: number): Promise<ReconciliationV2Discrepancy[]> {
    const discrepancies: ReconciliationV2Discrepancy[] = [];
    const events = await this.collectPagedRows<ResolutionRiskEventRow>({
      domain: "resolution_risk",
      operation: "resolution_risk_events_page",
      batchSize,
      fetchPage: async (cursor) =>
        (
          await this.safeQuery<ResolutionRiskEventRow>(
            "resolution_risk",
            "resolution_risk_events_page",
            `SELECT DISTINCT canonical_event_id::text AS canonical_event_id
               FROM resolution_profiles
              WHERE ($1::text IS NULL OR canonical_event_id::text > $1)
              ORDER BY canonical_event_id::text ASC
              LIMIT $2`,
            [cursor, batchSize],
          )
        ).rows,
      cursorOf: (row) => row.canonical_event_id,
    });

    for (const row of events) {
      const inspection = await this.safeCanonicalInspection(row.canonical_event_id);
      if (!inspection.freshness.isComplete) {
        discrepancies.push(this.discrepancy("resolution_risk", "RESOLUTION_RISK_INCOMPLETE", "warning", row.canonical_event_id, "Resolution-risk assessment set is incomplete for canonical event.", { freshness: inspection.freshness }));
      }
      if (inspection.freshness.isStale) {
        discrepancies.push(this.discrepancy("resolution_risk", "RESOLUTION_RISK_STALE", "warning", row.canonical_event_id, "Resolution-risk assessment set is stale for canonical event.", { freshness: inspection.freshness }));
      }
      if (inspection.freshness.hasMixedVersions) {
        discrepancies.push(this.discrepancy("resolution_risk", "RESOLUTION_RISK_MIXED_VERSIONS", "critical", row.canonical_event_id, "Resolution-risk assessment set contains mixed scoring versions.", { scoringVersion: inspection.scoringVersion }));
      }
    }

    return this.emitDiscrepancies(discrepancies);
  }

  private async loadResidualComboLegRows(
    domain: "netting_phase2a" | "clearing_phase2b",
    batchSize: number,
  ): Promise<ComboResidualLegRow[]> {
    const rows: ComboResidualLegRow[] = [];
    let cursor: string | null = null;

    while (true) {
      const comboPage: ResidualComboPageRow[] = (
        await this.safeQuery<ResidualComboPageRow>(
          domain,
          "residual_combo_page",
          `SELECT cr.id::text AS combo_id
             FROM combo_rfqs cr
            WHERE ($1::text IS NULL OR cr.id::text > $1)
              AND EXISTS (
                SELECT 1
                  FROM combo_legs cl
                 WHERE cl.combo_rfq_id = cr.id
                   AND cl.remaining_size > 0
              )
            ORDER BY cr.id::text ASC
            LIMIT $2`,
          [cursor, batchSize],
        )
      ).rows;

      if (comboPage.length === 0) {
        return rows;
      }

      const comboIds = comboPage.map((row) => row.combo_id);
      const pageRows = await this.safeQuery<ComboResidualLegRow>(
        domain,
        "residual_combo_leg_details",
        `SELECT cr.id::text AS combo_id,
                cr.user_id::text,
                cr.state,
                cl.id::text AS leg_id,
                cl.canonical_market_id::text,
                cl.canonical_outcome_id::text,
                cl.side,
                cl.remaining_size::text,
                cl.price_hint::text,
                cl.metadata
           FROM combo_rfqs cr
           JOIN combo_legs cl ON cl.combo_rfq_id = cr.id
          WHERE cr.id::text = ANY($1::text[])
            AND cl.remaining_size > 0
          ORDER BY cr.id::text ASC, cl.id::text ASC`,
        [comboIds],
      );
      rows.push(...pageRows.rows);

      cursor = comboPage[comboPage.length - 1]!.combo_id;
      await this.renewRunLock(domain, `residual_combo_page:${cursor}`);
      if (comboPage.length < batchSize) {
        return rows;
      }
    }
  }

  private groupResidualCombos(rows: readonly ComboResidualLegRow[]): Array<{ id: string; legs: ComboResidualLegRow[] }> {
    const grouped = new Map<string, ComboResidualLegRow[]>();
    for (const row of rows) {
      const existing = grouped.get(row.combo_id) ?? [];
      existing.push(row);
      grouped.set(row.combo_id, existing);
    }
    return [...grouped.entries()].map(([id, legs]) => ({ id, legs }));
  }

  private async loadPhase2BResidualEntities(batchSize: number): Promise<Phase2BResidualEntity[]> {
    const rows = await this.loadResidualComboLegRows("clearing_phase2b", batchSize);
    const grouped = new Map<string, ComboResidualLegRow[]>();
    for (const row of rows) {
      const existing = grouped.get(row.combo_id) ?? [];
      existing.push(row);
      grouped.set(row.combo_id, existing);
    }

    const entities: Phase2BResidualEntity[] = [];
    for (const [comboId, legs] of grouped) {
      const first = legs[0];
      if (!first) {
        continue;
      }
      try {
        const entityLegs: ResidualVectorLeg[] = legs.map((leg) => {
          const baseLeg: ResidualVectorLeg = {
            id: leg.leg_id,
            canonicalMarketId: leg.canonical_market_id,
            canonicalOutcomeId: leg.canonical_outcome_id,
            side: leg.side,
            remainingSize: leg.remaining_size,
          };

          if (leg.metadata) {
            return { ...baseLeg, metadata: leg.metadata };
          }

          return baseLeg;
        });

        const entity: ResidualVectorEntity = {
          entityId: comboId,
          userId: first.user_id,
          legs: entityLegs,
        };
        const built = this.residualVectorBuilder.build(entity);
        entities.push({ bucketId: built.compatibilityBucket, entity });
      } catch {
        // Missing bucket metadata should surface elsewhere; skip rebuild candidate here.
      }
    }

    return entities;
  }

  private async safeQuery<T extends QueryResultRow>(
    domain: ReconciliationV2InfraDomain,
    operation: string,
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    try {
      return await this.pool.query<T>(sql, params as unknown[] | undefined);
    } catch (error) {
      throw this.infraError(domain, operation, error);
    }
  }

  private async safeSet(
    domain: ReconciliationV2InfraDomain,
    operation: string,
    key: string,
    value: string,
    mode: "EX" | "PX",
    duration: number,
    condition?: "NX",
  ): Promise<"OK" | null> {
    try {
      return await this.redis.set(key, value, mode, duration, condition);
    } catch (error) {
      throw this.infraError(domain, operation, error);
    }
  }

  private async safeGet(domain: ReconciliationV2InfraDomain, operation: string, key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      throw this.infraError(domain, operation, error);
    }
  }

  private async safeEval(
    domain: ReconciliationV2InfraDomain,
    operation: string,
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<unknown> {
    try {
      return await this.redis.eval(script, numKeys, ...args);
    } catch (error) {
      throw this.infraError(domain, operation, error);
    }
  }

  private async safeSmembers(
    domain: ReconciliationV2InfraDomain,
    operation: string,
    key: string,
  ): Promise<string[]> {
    if (typeof this.redis.smembers !== "function") {
      throw this.infraError(domain, operation, new Error("redis_smembers_unavailable"));
    }

    try {
      return await this.redis.smembers(key);
    } catch (error) {
      throw this.infraError(domain, operation, error);
    }
  }

  private async safeScan(
    domain: ReconciliationV2InfraDomain,
    operation: string,
    cursor: string,
    pattern: string,
    count: number,
  ): Promise<[string, string[]]> {
    const scanRedis = this.redis as RedisClient & {
      scan?: (nextCursor: string, option: "MATCH", matchPattern: string, countOption: "COUNT", batchSize: number) => Promise<[string, string[]]>;
    };
    if (typeof scanRedis.scan !== "function") {
      throw this.infraError(domain, operation, new Error("redis_scan_unavailable"));
    }

    try {
      return await scanRedis.scan(cursor, "MATCH", pattern, "COUNT", count);
    } catch (error) {
      throw this.infraError(domain, operation, error);
    }
  }

  private async safeOrderSnapshot(domain: ReconciliationV2InfraDomain, orderId: string): Promise<{ raw: unknown | null }> {
    try {
      return await this.orderBook.getOrderSnapshot(orderId);
    } catch (error) {
      throw this.infraError(domain, "order_book_snapshot", error);
    }
  }

  private async safePhase2BEntitySnapshot(domain: ReconciliationV2InfraDomain, entityId: string): Promise<unknown | null> {
    try {
      return await this.phase2bCandidateRegistry.getEntitySnapshot(entityId);
    } catch (error) {
      throw this.infraError(domain, "phase2b_entity_snapshot", error);
    }
  }

  private async safeCanonicalInspection(canonicalEventId: string): Promise<{
    freshness: { isComplete: boolean; isStale: boolean; hasMixedVersions: boolean };
    scoringVersion: string;
  }> {
    try {
      return await this.resolutionRiskAdminService.getCanonicalInspection(canonicalEventId);
    } catch (error) {
      throw this.infraError("resolution_risk", "canonical_inspection", error);
    }
  }

  private async scanKeys(
    domain: ReconciliationV2InfraDomain,
    operation: string,
    pattern: string,
    batchSize: number,
  ): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await this.safeScan(domain, operation, cursor, pattern, batchSize);
      cursor = nextCursor;
      keys.push(...batch);
      await this.renewRunLock(domain, `${operation}:${cursor}`);
    } while (cursor !== "0");

    return keys;
  }

  private infraError(
    domain: ReconciliationV2InfraDomain,
    operation: string,
    error: unknown,
  ): ReconciliationV2InfraError {
    if (error instanceof ReconciliationV2InfraError) {
      return error;
    }

    const activeRun = this.requireActiveRun();
    reconciliationV2InfraErrorTotal.labels(domain, operation).inc();
    return new ReconciliationV2InfraError(domain, operation, activeRun.runId, error);
  }

  private async loadInternalOrderById(
    orderId: string,
    domain: ReconciliationV2InfraDomain,
    operation: string,
  ): Promise<InternalOrderRow | null> {
    const result = await this.safeQuery<InternalOrderRow>(
      domain,
      operation,
      `SELECT id::text, market_id::text, user_id::text, side, price::text, initial_size::text, remaining_size::text,
              status, NULL::text AS resolution_profile_id, created_at, updated_at
         FROM internal_orders
        WHERE id = $1
        LIMIT 1`,
      [orderId],
    );
    return result.rows[0] ?? null;
  }
}
