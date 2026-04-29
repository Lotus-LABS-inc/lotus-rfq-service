import type { Pool } from "pg";
import type { ExecutionFeeSummary } from "../execution-system/types.js";
import type {
  MonetizationCaptureMode,
  MonetizationPolicy,
  MonetizationRevenueSource
} from "../execution-system/monetization-policy.js";

export type ExecutionFeeLedgerStatus =
  | "PREVIEWED"
  | "AUTHORIZED"
  | "REALIZED_SHADOW"
  | "SHADOW_ONLY"
  | "COLLECTED_BUILDER_FEE";

export class MonetizationIdempotencyConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MonetizationIdempotencyConflictError";
  }
}

export interface FeeLedgerInput {
  idempotencyKey: string;
  executionId?: string | null;
  rfqId?: string | null;
  quoteId?: string | null;
  userId: string;
  venue?: string | null;
  laneId?: string | null;
  feePolicyVersion: string;
  feeType: string;
  status: ExecutionFeeLedgerStatus;
  amount: string;
  currency: string;
  captureMode?: MonetizationCaptureMode;
  revenueSource?: MonetizationRevenueSource;
  actualBuilderFeeCollected?: string;
  shadowImprovementFee?: string;
  uncollectedImprovementOpportunity?: string;
  settlementStatus?: string | null;
  sourceEventId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface FeeAuthorizationInput {
  idempotencyKey: string;
  rfqId: string;
  quoteId: string;
  executionId?: string | null;
  userId: string;
  feePolicyVersion: string;
  feeDisclosureHash: string;
  maxLotusFee: string;
  maxPassThroughFee: string;
  currency: string;
  feeSummary: ExecutionFeeSummary;
}

export class MonetizationRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertPolicy(policy: MonetizationPolicy): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO monetization_fee_policies (
          version,
          enabled,
          mode,
          currency,
          price_improvement_share_bps,
          execution_fee_bps,
          fast_lane_fee_bps,
          ghost_fill_protection_fee_bps,
          max_total_fee_bps,
          capture_mode,
          config
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (version) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          mode = EXCLUDED.mode,
          currency = EXCLUDED.currency,
          price_improvement_share_bps = EXCLUDED.price_improvement_share_bps,
          execution_fee_bps = EXCLUDED.execution_fee_bps,
          fast_lane_fee_bps = EXCLUDED.fast_lane_fee_bps,
          ghost_fill_protection_fee_bps = EXCLUDED.ghost_fill_protection_fee_bps,
          max_total_fee_bps = EXCLUDED.max_total_fee_bps,
          capture_mode = EXCLUDED.capture_mode,
          config = EXCLUDED.config,
          updated_at = now()
       RETURNING id`,
      [
        policy.policyVersion,
        policy.captureMode !== "DISABLED",
        policy.mode,
        policy.currency,
        policy.priceImprovementShareBps,
        policy.executionFeeBps,
        policy.fastLaneFeeBps,
        policy.ghostFillProtectionFeeBps,
        policy.maxTotalFeeBps,
        policy.captureMode,
        JSON.stringify(policy)
      ]
    );
    return result.rows[0]!.id;
  }

  public async createAuthorization(input: FeeAuthorizationInput): Promise<string> {
    const existing = await this.pool.query<{ id: string; max_lotus_fee: string }>(
      `SELECT id, max_lotus_fee
         FROM execution_fee_authorizations
        WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    if (existing.rows[0]) {
      if (!sameNumericAmount(existing.rows[0].max_lotus_fee, input.maxLotusFee)) {
        throw new MonetizationIdempotencyConflictError("Fee authorization idempotency key reused with a different max Lotus fee.");
      }
      return existing.rows[0].id;
    }

    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO execution_fee_authorizations (
          idempotency_key,
          rfq_id,
          quote_id,
          execution_id,
          user_id,
          fee_policy_version,
          fee_disclosure_hash,
          max_lotus_fee,
          max_pass_through_fee,
          currency,
          fee_summary
       ) VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8::numeric, $9::numeric, $10, $11::jsonb)
       RETURNING id`,
      [
        input.idempotencyKey,
        input.rfqId,
        input.quoteId,
        input.executionId ?? null,
        input.userId,
        input.feePolicyVersion,
        input.feeDisclosureHash,
        input.maxLotusFee,
        input.maxPassThroughFee,
        input.currency,
        JSON.stringify(input.feeSummary)
      ]
    );
    return result.rows[0]!.id;
  }

  public async createLedgerEntry(input: FeeLedgerInput): Promise<string> {
    const existing = await this.pool.query<{ id: string; amount: string }>(
      `SELECT id, amount
         FROM execution_fee_ledger
        WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    if (existing.rows[0]) {
      if (!sameNumericAmount(existing.rows[0].amount, input.amount)) {
        throw new MonetizationIdempotencyConflictError("Fee ledger idempotency key reused with a different amount.");
      }
      return existing.rows[0].id;
    }

    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO execution_fee_ledger (
          idempotency_key,
          execution_id,
          rfq_id,
          quote_id,
          user_id,
          venue,
          lane_id,
          fee_policy_version,
          fee_type,
          status,
          amount,
          currency,
          capture_mode,
          revenue_source,
          actual_builder_fee_collected,
          shadow_improvement_fee,
          uncollected_improvement_opportunity,
          settlement_status,
          source_event_id,
          metadata
       ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12, $13, $14, $15::numeric, $16::numeric, $17::numeric, $18, $19, $20::jsonb)
       RETURNING id`,
      [
        input.idempotencyKey,
        input.executionId ?? null,
        input.rfqId ?? null,
        input.quoteId ?? null,
        input.userId,
        input.venue ?? null,
        input.laneId ?? null,
        input.feePolicyVersion,
        input.feeType,
        input.status,
        input.amount,
        input.currency,
        input.captureMode ?? null,
        input.revenueSource ?? null,
        input.actualBuilderFeeCollected ?? "0",
        input.shadowImprovementFee ?? "0",
        input.uncollectedImprovementOpportunity ?? "0",
        input.settlementStatus ?? null,
        input.sourceEventId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return result.rows[0]!.id;
  }

  public async listPolicies(limit = 50): Promise<MonetizationPolicyRow[]> {
    const result = await this.pool.query<MonetizationPolicyRow>(
      `SELECT
          id,
          version,
          enabled,
          mode,
          currency,
          price_improvement_share_bps,
          execution_fee_bps,
          fast_lane_fee_bps,
          ghost_fill_protection_fee_bps,
          max_total_fee_bps,
          capture_mode,
          config,
          created_at,
          updated_at
         FROM monetization_fee_policies
        ORDER BY updated_at DESC
        LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  public async listLedgerEntries(filter: MonetizationLedgerFilter = {}): Promise<MonetizationLedgerRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const addCondition = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };
    if (filter.status) addCondition("status = ?", filter.status);
    if (filter.venue) addCondition("upper(venue) = upper(?)", filter.venue);
    if (filter.revenueSource) addCondition("revenue_source = ?", filter.revenueSource);
    if (filter.captureMode) addCondition("capture_mode = ?", filter.captureMode);
    if (filter.policyVersion) addCondition("fee_policy_version = ?", filter.policyVersion);
    values.push(filter.limit ?? 100);
    const result = await this.pool.query<MonetizationLedgerRow>(
      `SELECT
          id,
          idempotency_key,
          execution_id,
          rfq_id,
          quote_id,
          user_id,
          venue,
          lane_id,
          fee_policy_version,
          fee_type,
          status,
          amount,
          currency,
          capture_mode,
          revenue_source,
          actual_builder_fee_collected,
          shadow_improvement_fee,
          uncollected_improvement_opportunity,
          settlement_status,
          source_event_id,
          metadata,
          created_at
         FROM execution_fee_ledger
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY created_at DESC
        LIMIT $${values.length}`,
      values
    );
    return result.rows;
  }

  public async getSummary(): Promise<MonetizationSummaryRow[]> {
    const result = await this.pool.query<MonetizationSummaryRow>(
      `SELECT
          COALESCE(venue, 'UNKNOWN') AS venue,
          COALESCE(lane_id, 'UNKNOWN') AS lane,
          COALESCE(capture_mode, 'UNKNOWN') AS capture_mode,
          COALESCE(revenue_source, 'UNKNOWN') AS revenue_source,
          fee_policy_version AS policy_version,
          currency,
          COUNT(*)::int AS row_count,
          COALESCE(SUM(actual_builder_fee_collected), 0)::text AS actual_builder_fees_collected,
          COALESCE(SUM(shadow_improvement_fee), 0)::text AS shadow_improvement_fees,
          COALESCE(SUM(uncollected_improvement_opportunity), 0)::text AS uncollected_improvement_opportunity,
          COALESCE(SUM(amount), 0)::text AS ledger_amount
         FROM execution_fee_ledger
        GROUP BY venue, lane_id, capture_mode, revenue_source, fee_policy_version, currency
        ORDER BY fee_policy_version DESC, venue ASC, lane ASC`
    );
    return result.rows;
  }
}

export interface MonetizationLedgerFilter {
  status?: string;
  venue?: string;
  revenueSource?: string;
  captureMode?: string;
  policyVersion?: string;
  limit?: number;
}

export interface MonetizationPolicyRow {
  id: string;
  version: string;
  enabled: boolean;
  mode: string;
  currency: string;
  price_improvement_share_bps: number;
  execution_fee_bps: number;
  fast_lane_fee_bps: number;
  ghost_fill_protection_fee_bps: number;
  max_total_fee_bps: number;
  capture_mode: string;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface MonetizationLedgerRow {
  id: string;
  idempotency_key: string;
  execution_id: string | null;
  rfq_id: string | null;
  quote_id: string | null;
  user_id: string;
  venue: string | null;
  lane_id: string | null;
  fee_policy_version: string;
  fee_type: string;
  status: string;
  amount: string;
  currency: string;
  capture_mode: string | null;
  revenue_source: string | null;
  actual_builder_fee_collected: string;
  shadow_improvement_fee: string;
  uncollected_improvement_opportunity: string;
  settlement_status: string | null;
  source_event_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface MonetizationSummaryRow {
  venue: string;
  lane: string;
  capture_mode: string;
  revenue_source: string;
  policy_version: string;
  currency: string;
  row_count: number;
  actual_builder_fees_collected: string;
  shadow_improvement_fees: string;
  uncollected_improvement_opportunity: string;
  ledger_amount: string;
}

const sameNumericAmount = (left: string, right: string): boolean =>
  Number.isFinite(Number(left)) &&
  Number.isFinite(Number(right)) &&
  Number(left) === Number(right);
