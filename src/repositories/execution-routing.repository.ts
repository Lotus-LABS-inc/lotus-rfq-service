import type { Pool } from "pg";
import type {
  ExecutableTradeQuote,
  ExecutionQuoteRepository,
  RejectedRouteCandidate,
  TradeSide,
  VerifiedExecutionPosition,
  VerifiedPositionRepository
} from "../execution-system/executable-routing.js";
import type {
  SignedTradeExecutionStatus,
  SignedTradeExecutionStatusRepository,
  SignedTradePositionRecorder
} from "../execution-system/signed-trade-bundle.js";
import type {
  ExecutionOrderRecord,
  ExecutionOrderRepository,
  ExecutionOrderState
} from "../execution-system/execution-order-orchestrator.js";

interface QuoteRow {
  quote_id: string;
  user_id: string;
  side: TradeSide;
  market_id: string;
  outcome_id: string;
  selected_route: ExecutableTradeQuote;
  rejected_candidates: RejectedRouteCandidate[];
  expires_at: Date;
}

interface PositionRow {
  position_id: string;
  user_id: string;
  venue: string;
  market_id: string;
  outcome_id: string;
  venue_account_address: string | null;
  verified_size: string;
  average_entry_price: string;
  sellable_size: string;
  last_settlement_evidence_id: string | null;
  status: VerifiedExecutionPosition["status"];
  metadata: Record<string, unknown>;
}

interface SignedTradeExecutionStatusRow {
  execution_id: string;
  user_id: string;
  status: SignedTradeExecutionStatus["status"];
  dry_run: boolean;
  submitted_at: Date;
  updated_at: Date;
  selected_route: ExecutableTradeQuote | null;
  watcher_metadata: SignedTradeExecutionStatus["watcherMetadata"] | null;
  submitted_legs: SignedTradeExecutionStatus["submittedLegs"];
}

interface ExecutionOrderRow {
  order_id: string;
  user_id: string;
  quote_id: string | null;
  execution_id: string | null;
  state: ExecutionOrderRecord["state"];
  side: TradeSide;
  market_id: string;
  outcome_id: string;
  amount: string;
  venue_preference: ExecutionOrderRecord["venuePreference"];
  order_policy: ExecutionOrderRecord["orderPolicy"];
  slippage_tolerance_bps: number;
  signing_mode: ExecutionOrderRecord["signingMode"];
  primary_action: ExecutionOrderRecord["primaryAction"];
  readiness_summary: Record<string, unknown>;
  venue_capability_summary: ExecutionOrderRecord["venueCapabilitySummary"];
  blockers: ExecutionOrderRecord["blockers"];
  signature_request_hash: string | null;
  last_error: string | null;
  expires_at: Date | null;
  next_poll_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListUserVerifiedPositionsInput {
  userId: string;
  marketId?: string | undefined;
  outcomeId?: string | undefined;
  venue?: string | undefined;
  limit?: number | undefined;
}

export interface ListUserExecutionStatusesInput {
  userId: string;
  status?: SignedTradeExecutionStatus["status"] | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface ListOpenUserExecutionStatusesInput {
  userId: string;
  limit: number;
  cursor?: string | undefined;
}

export class PgExecutionQuoteRepository implements ExecutionQuoteRepository {
  public constructor(private readonly pool: Pool) {}

  public async saveQuote(input: {
    quote: ExecutableTradeQuote;
    rejectedCandidates: readonly RejectedRouteCandidate[];
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO execution_route_quotes (
        quote_id,
        user_id,
        side,
        market_id,
        outcome_id,
        selected_route,
        rejected_candidates,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)
      ON CONFLICT (quote_id) DO UPDATE SET
        selected_route = EXCLUDED.selected_route,
        rejected_candidates = EXCLUDED.rejected_candidates,
        expires_at = EXCLUDED.expires_at`,
      [
        input.quote.quoteId,
        input.quote.userId,
        input.quote.side,
        input.quote.marketId,
        input.quote.outcomeId,
        JSON.stringify(input.quote),
        JSON.stringify(input.rejectedCandidates),
        input.quote.expiresAt
      ]
    );
  }

  public async findQuote(input: { userId: string; quoteId: string }): Promise<ExecutableTradeQuote | null> {
    const result = await this.pool.query<QuoteRow>(
      `SELECT * FROM execution_route_quotes
       WHERE quote_id = $1 AND user_id = $2 AND expires_at > now()`,
      [input.quoteId, input.userId]
    );
    return result.rows[0]?.selected_route ?? null;
  }
}

export class PgVerifiedPositionRepository implements VerifiedPositionRepository {
  public constructor(private readonly pool: Pool) {}

  public async listVerifiedPositions(input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    venue?: string | undefined;
  }): Promise<VerifiedExecutionPosition[]> {
    const values: unknown[] = [input.userId, input.marketId, input.outcomeId];
    const venueClause = input.venue
      ? (() => {
          values.push(input.venue.toUpperCase());
          return ` AND venue = $${values.length}`;
        })()
      : "";
    const result = await this.pool.query<PositionRow>(
      `SELECT * FROM user_execution_positions
       WHERE user_id = $1
         AND market_id = $2
         AND outcome_id = $3
         AND verified_size > 0
         AND status = 'VERIFIED'
         ${venueClause}
       ORDER BY updated_at DESC`,
      values
    );
    return result.rows.map(mapPositionRow);
  }

  public async listUserVerifiedPositions(input: ListUserVerifiedPositionsInput): Promise<VerifiedExecutionPosition[]> {
    const values: unknown[] = [input.userId];
    const clauses = ["user_id = $1", "verified_size > 0", "status = 'VERIFIED'"];
    if (input.marketId) {
      values.push(input.marketId);
      clauses.push(`market_id = $${values.length}`);
    }
    if (input.outcomeId) {
      values.push(input.outcomeId);
      clauses.push(`outcome_id = $${values.length}`);
    }
    if (input.venue) {
      values.push(input.venue.toUpperCase());
      clauses.push(`venue = $${values.length}`);
    }
    values.push(Math.min(Math.max(input.limit ?? 100, 1), 500));
    const result = await this.pool.query<PositionRow>(
      `SELECT * FROM user_execution_positions
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(mapPositionRow);
  }

  public async applySettlementDelta(input: {
    userId: string;
    venue: string;
    marketId: string;
    outcomeId: string;
    venueAccountAddress?: string | null;
    side: TradeSide;
    size: string;
    averagePrice: number;
    settlementEvidenceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<VerifiedExecutionPosition> {
    const signedSize = input.side === "buy" ? Number(input.size) : -Number(input.size);
    if (!Number.isFinite(signedSize) || Number(input.size) <= 0) {
      throw new Error("Position delta size must be positive.");
    }
    const result = await this.pool.query<PositionRow>(
      `INSERT INTO user_execution_positions (
        user_id,
        venue,
        market_id,
        outcome_id,
        venue_account_address,
        verified_size,
        average_entry_price,
        sellable_size,
        last_settlement_evidence_id,
        status,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5,
        GREATEST($6::numeric, 0),
        $7::numeric,
        GREATEST($6::numeric, 0),
        $8,
        'VERIFIED',
        $9::jsonb
      )
      ON CONFLICT (user_id, venue, market_id, outcome_id) DO UPDATE SET
        verified_size = GREATEST(user_execution_positions.verified_size + $6::numeric, 0),
        sellable_size = GREATEST(user_execution_positions.sellable_size + $6::numeric, 0),
        average_entry_price = CASE
          WHEN $6::numeric > 0 THEN $7::numeric
          ELSE user_execution_positions.average_entry_price
        END,
        venue_account_address = COALESCE(EXCLUDED.venue_account_address, user_execution_positions.venue_account_address),
        last_settlement_evidence_id = EXCLUDED.last_settlement_evidence_id,
        status = 'VERIFIED',
        metadata = user_execution_positions.metadata || EXCLUDED.metadata,
        updated_at = now()
      RETURNING *`,
      [
        input.userId,
        input.venue.toUpperCase(),
        input.marketId,
        input.outcomeId,
        input.venueAccountAddress ?? null,
        String(signedSize),
        String(input.averagePrice),
        input.settlementEvidenceId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return mapPositionRow(result.rows[0]!);
  }
}

export class PgSignedTradeExecutionStatusRepository implements SignedTradeExecutionStatusRepository {
  public constructor(private readonly pool: Pool) {}

  public async saveExecutionStatus(status: SignedTradeExecutionStatus): Promise<void> {
    await this.pool.query(
      `INSERT INTO signed_trade_bundle_executions (
        execution_id,
        user_id,
        status,
        dry_run,
        submitted_at,
        updated_at,
        selected_route,
        watcher_metadata,
        submitted_legs
      ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8::jsonb, $9::jsonb)
      ON CONFLICT (execution_id, user_id) DO UPDATE SET
        status = EXCLUDED.status,
        dry_run = EXCLUDED.dry_run,
        submitted_at = LEAST(signed_trade_bundle_executions.submitted_at, EXCLUDED.submitted_at),
        updated_at = EXCLUDED.updated_at,
        selected_route = COALESCE(EXCLUDED.selected_route, signed_trade_bundle_executions.selected_route),
        watcher_metadata = EXCLUDED.watcher_metadata,
        submitted_legs = EXCLUDED.submitted_legs`,
      [
        status.executionId,
        status.userId,
        status.status,
        status.dryRun,
        status.submittedAt,
        status.updatedAt,
        JSON.stringify(status.route ?? null),
        JSON.stringify(status.watcherMetadata ?? null),
        JSON.stringify(status.submittedLegs)
      ]
    );
  }

  public async findExecutionStatus(input: { userId: string; executionId: string }): Promise<SignedTradeExecutionStatus | null> {
    const result = await this.pool.query<SignedTradeExecutionStatusRow>(
      `SELECT *
       FROM signed_trade_bundle_executions
       WHERE execution_id = $1 AND user_id = $2`,
      [input.executionId, input.userId]
    );
    const row = result.rows[0];
    return row ? mapSignedTradeExecutionStatusRow(row) : null;
  }

  public async listActiveExecutionStatuses(input: {
    limit: number;
    activeWindowSeconds: number;
  }): Promise<SignedTradeExecutionStatus[]> {
    const result = await this.pool.query<SignedTradeExecutionStatusRow>(
      `SELECT *
       FROM signed_trade_bundle_executions
       WHERE dry_run = false
         AND status IN ('SUBMITTED', 'PARTIAL', 'FILLED')
         AND updated_at >= now() - ($2::int * interval '1 second')
         AND (
           watcher_metadata IS NULL
           OR watcher_metadata->>'nextCheckAfter' IS NULL
           OR (watcher_metadata->>'nextCheckAfter')::timestamptz <= now()
         )
       ORDER BY updated_at DESC
       LIMIT $1`,
      [input.limit, input.activeWindowSeconds]
    );
    return result.rows.map(mapSignedTradeExecutionStatusRow);
  }

  public async listExecutionStatusesForUser(input: ListUserExecutionStatusesInput): Promise<SignedTradeExecutionStatus[]> {
    const values: unknown[] = [input.userId];
    const clauses = ["user_id = $1"];
    if (input.status) {
      values.push(input.status);
      clauses.push(`status = $${values.length}`);
    }
    if (input.cursor) {
      values.push(input.cursor);
      clauses.push(`updated_at < $${values.length}::timestamptz`);
    }
    values.push(Math.min(Math.max(input.limit, 1), 100));
    const result = await this.pool.query<SignedTradeExecutionStatusRow>(
      `SELECT *
       FROM signed_trade_bundle_executions
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(mapSignedTradeExecutionStatusRow);
  }

  public async listOpenExecutionStatusesForUser(input: ListOpenUserExecutionStatusesInput): Promise<SignedTradeExecutionStatus[]> {
    const values: unknown[] = [input.userId];
    const clauses = [
      "user_id = $1",
      "dry_run = false",
      "status IN ('SUBMITTED', 'PARTIAL')"
    ];
    if (input.cursor) {
      values.push(input.cursor);
      clauses.push(`updated_at < $${values.length}::timestamptz`);
    }
    values.push(Math.min(Math.max(input.limit, 1), 100));
    const result = await this.pool.query<SignedTradeExecutionStatusRow>(
      `SELECT *
       FROM signed_trade_bundle_executions
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(mapSignedTradeExecutionStatusRow);
  }
}

export class PgSignedTradePositionRecorder implements SignedTradePositionRecorder {
  public constructor(private readonly pool: Pool) {}

  public async recordFilledLeg(input: Parameters<SignedTradePositionRecorder["recordFilledLeg"]>[0]): Promise<void> {
    const fillSize = positionSizeFromFill(input.fillState, input.routeLeg.size);
    const averagePrice = input.fillState.averagePrice > 0 ? input.fillState.averagePrice : input.routeLeg.price;
    if (Number(fillSize) <= 0 || !Number.isFinite(Number(fillSize))) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const nextFillSize = Number(fillSize);
      const insertedApplication = await client.query<{ fill_state: { filledSize?: string; offchainFilled?: boolean } }>(
        `INSERT INTO signed_trade_bundle_position_applications (
          execution_id,
          user_id,
          leg_index,
          venue,
          venue_order_id,
          fill_state
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (execution_id, user_id, leg_index, venue_order_id) DO NOTHING
        RETURNING fill_state`,
        [
          input.executionId,
          input.userId,
          input.legIndex,
          input.routeLeg.venue.toUpperCase(),
          input.venueOrderId,
          JSON.stringify(input.fillState)
        ]
      );
      const existingApplication = insertedApplication.rowCount && insertedApplication.rows[0]?.fill_state
        ? insertedApplication
        : await client.query<{ fill_state: { filledSize?: string; offchainFilled?: boolean } }>(
          `SELECT fill_state
           FROM signed_trade_bundle_position_applications
           WHERE execution_id = $1
             AND user_id = $2
             AND leg_index = $3
             AND venue_order_id = $4
           FOR UPDATE`,
          [
            input.executionId,
            input.userId,
            input.legIndex,
            input.venueOrderId
          ]
        );
      const insertedNewApplication = Boolean(insertedApplication.rowCount && insertedApplication.rows[0]?.fill_state);
      if (!insertedNewApplication && existingApplication.rowCount === 0) {
        await client.query("COMMIT");
        return;
      }
      const previousFillSize = insertedNewApplication
        ? 0
        : existingApplication.rowCount && existingApplication.rows[0]?.fill_state
          ? Number(positionSizeFromFill(existingApplication.rows[0].fill_state, input.routeLeg.size))
          : 0;
      const deltaFillSize = Math.max(0, nextFillSize - previousFillSize);
      if (deltaFillSize <= 0 || !Number.isFinite(deltaFillSize)) {
        await client.query("COMMIT");
        return;
      }
      if (!insertedNewApplication) {
        await client.query(
          `UPDATE signed_trade_bundle_position_applications
           SET fill_state = $5::jsonb
           WHERE execution_id = $1
             AND user_id = $2
             AND leg_index = $3
             AND venue_order_id = $4`,
          [
            input.executionId,
            input.userId,
            input.legIndex,
            input.venueOrderId,
            JSON.stringify(input.fillState)
          ]
        );
      }
      const signedSize = input.route.side === "buy" ? deltaFillSize : -deltaFillSize;
      await client.query(
        `INSERT INTO user_execution_positions (
          user_id,
          venue,
          market_id,
          outcome_id,
          venue_account_address,
          verified_size,
          average_entry_price,
          sellable_size,
          last_settlement_evidence_id,
          status,
          metadata
        ) VALUES (
          $1, $2, $3, $4, $5,
          GREATEST($6::numeric, 0),
          $7::numeric,
          GREATEST($6::numeric, 0),
          $8,
          'VERIFIED',
          $9::jsonb
        )
        ON CONFLICT (user_id, venue, market_id, outcome_id) DO UPDATE SET
          verified_size = GREATEST(user_execution_positions.verified_size + $6::numeric, 0),
          sellable_size = GREATEST(user_execution_positions.sellable_size + $6::numeric, 0),
          average_entry_price = CASE
            WHEN $6::numeric > 0 THEN $7::numeric
            ELSE user_execution_positions.average_entry_price
          END,
          last_settlement_evidence_id = EXCLUDED.last_settlement_evidence_id,
          status = 'VERIFIED',
          metadata = user_execution_positions.metadata || EXCLUDED.metadata,
          updated_at = now()`,
        [
          input.userId,
          input.routeLeg.venue.toUpperCase(),
          input.route.marketId,
          input.route.outcomeId,
          null,
          String(signedSize),
          String(averagePrice),
          input.venueOrderId,
          JSON.stringify({
            source: "signed_trade_bundle",
            executionId: input.executionId,
            legIndex: input.legIndex,
            venueOrderId: input.venueOrderId,
            ...(input.routeLeg.venueMarketId ? { venueMarketId: input.routeLeg.venueMarketId } : {}),
            ...(input.routeLeg.venueOutcomeId ? { venueOutcomeId: input.routeLeg.venueOutcomeId } : {})
          })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async reconcileFailedSell(input: NonNullable<SignedTradePositionRecorder["reconcileFailedSell"]> extends (arg: infer Arg) => Promise<void> ? Arg : never): Promise<void> {
    const liveSellableSize = Number(input.liveSellableSize);
    const hasLiveSellableSize = Number.isFinite(liveSellableSize) && liveSellableSize > 0;
    await this.pool.query(
      `UPDATE user_execution_positions
       SET sellable_size = $5::numeric,
           status = $6,
           metadata = coalesce(metadata, '{}'::jsonb) || $7::jsonb,
           updated_at = now()
       WHERE user_id = $1
         AND venue = $2
         AND market_id = $3
         AND outcome_id = $4`,
      [
        input.userId,
        input.routeLeg.venue.toUpperCase(),
        input.route.marketId,
        input.route.outcomeId,
        hasLiveSellableSize ? input.liveSellableSize : "0",
        hasLiveSellableSize ? "VERIFIED" : "RECOVERY",
        JSON.stringify({
          sellableReconciliation: {
            source: "venue_reject",
            executionId: input.executionId,
            legIndex: input.legIndex,
            venue: input.venue,
            reason: input.reason,
            ...(hasLiveSellableSize ? { liveSellableSize: input.liveSellableSize } : {})
          }
        })
      ]
    );
  }
}

export class PgExecutionOrderRepository implements ExecutionOrderRepository {
  public constructor(private readonly pool: Pool) {}

  public async saveOrder(order: ExecutionOrderRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO execution_orders_v1 (
        order_id,
        user_id,
        quote_id,
        execution_id,
        state,
        side,
        market_id,
        outcome_id,
        amount,
        venue_preference,
        order_policy,
        slippage_tolerance_bps,
        signing_mode,
        primary_action,
        readiness_summary,
        venue_capability_summary,
        blockers,
        signature_request_hash,
        last_error,
        expires_at,
        next_poll_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11, $12, $13,
        $14, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19, $20::timestamptz,
        $21::timestamptz, $22::timestamptz, $23::timestamptz
      )
      ON CONFLICT (order_id, user_id) DO UPDATE SET
        quote_id = EXCLUDED.quote_id,
        execution_id = COALESCE(EXCLUDED.execution_id, execution_orders_v1.execution_id),
        state = EXCLUDED.state,
        side = EXCLUDED.side,
        market_id = EXCLUDED.market_id,
        outcome_id = EXCLUDED.outcome_id,
        amount = EXCLUDED.amount,
        venue_preference = EXCLUDED.venue_preference,
        order_policy = EXCLUDED.order_policy,
        slippage_tolerance_bps = EXCLUDED.slippage_tolerance_bps,
        signing_mode = EXCLUDED.signing_mode,
        primary_action = EXCLUDED.primary_action,
        readiness_summary = EXCLUDED.readiness_summary,
        venue_capability_summary = EXCLUDED.venue_capability_summary,
        blockers = EXCLUDED.blockers,
        signature_request_hash = EXCLUDED.signature_request_hash,
        last_error = EXCLUDED.last_error,
        expires_at = EXCLUDED.expires_at,
        next_poll_at = EXCLUDED.next_poll_at,
        updated_at = EXCLUDED.updated_at`,
      orderValues(order)
    );
  }

  public async findOrder(input: { userId: string; orderId: string }): Promise<ExecutionOrderRecord | null> {
    const result = await this.pool.query<ExecutionOrderRow>(
      `SELECT *
       FROM execution_orders_v1
       WHERE order_id = $1 AND user_id = $2`,
      [input.orderId, input.userId]
    );
    return result.rows[0] ? mapExecutionOrderRow(result.rows[0]) : null;
  }

  public async updateOrder(input: {
    userId: string;
    orderId: string;
    patch: Partial<Omit<ExecutionOrderRecord, "orderId" | "userId" | "createdAt">>;
  }): Promise<ExecutionOrderRecord | null> {
    const current = await this.findOrder(input);
    if (!current) {
      return null;
    }
    const next: ExecutionOrderRecord = {
      ...current,
      ...input.patch,
      updatedAt: new Date().toISOString()
    };
    await this.saveOrder(next);
    return this.findOrder(input);
  }

  public async startSubmit(input: {
    userId: string;
    orderId: string;
    allowedStates: readonly ExecutionOrderState[];
  }): Promise<ExecutionOrderRecord | null> {
    const result = await this.pool.query<ExecutionOrderRow>(
      `UPDATE execution_orders_v1
       SET state = 'SUBMITTING',
           primary_action = 'NONE',
           next_poll_at = now() + interval '2 seconds',
           updated_at = now()
       WHERE order_id = $1
         AND user_id = $2
         AND state = ANY($3::text[])
       RETURNING *`,
      [input.orderId, input.userId, [...input.allowedStates]]
    );
    return result.rows[0] ? mapExecutionOrderRow(result.rows[0]) : null;
  }

  public async listRefreshableOrders(input: { limit: number }): Promise<ExecutionOrderRecord[]> {
    const result = await this.pool.query<ExecutionOrderRow>(
      `SELECT *
       FROM execution_orders_v1
       WHERE (
          state IN ('SUBMITTING', 'SUBMITTED')
          OR (
            state = 'FAILED'
            AND execution_id IS NOT NULL
            AND created_at >= now() - interval '2 minutes'
          )
        )
         AND (next_poll_at IS NULL OR next_poll_at <= now())
       ORDER BY updated_at ASC
       LIMIT $1`,
      [Math.min(Math.max(input.limit, 1), 250)]
    );
    return result.rows.map(mapExecutionOrderRow);
  }
}

const mapPositionRow = (row: PositionRow): VerifiedExecutionPosition => ({
  positionId: row.position_id,
  userId: row.user_id,
  venue: row.venue,
  marketId: row.market_id,
  outcomeId: row.outcome_id,
  venueAccountAddress: row.venue_account_address,
  verifiedSize: row.verified_size,
  averageEntryPrice: Number(row.average_entry_price),
  sellableSize: row.sellable_size,
  lastSettlementEvidenceId: row.last_settlement_evidence_id,
  status: row.status,
  metadata: row.metadata
});

const orderValues = (order: ExecutionOrderRecord): unknown[] => [
  order.orderId,
  order.userId,
  order.quoteId,
  order.executionId,
  order.state,
  order.side,
  order.marketId,
  order.outcomeId,
  order.amount,
  order.venuePreference,
  order.orderPolicy,
  order.slippageToleranceBps,
  order.signingMode,
  order.primaryAction,
  JSON.stringify(order.readinessSummary),
  JSON.stringify(order.venueCapabilitySummary),
  JSON.stringify(order.blockers),
  order.signatureRequestHash,
  order.lastError,
  order.expiresAt,
  order.nextPollAt,
  order.createdAt,
  order.updatedAt
];

const mapExecutionOrderRow = (row: ExecutionOrderRow): ExecutionOrderRecord => ({
  orderId: row.order_id,
  userId: row.user_id,
  quoteId: row.quote_id,
  executionId: row.execution_id,
  state: row.state,
  side: row.side,
  marketId: row.market_id,
  outcomeId: row.outcome_id,
  amount: row.amount,
  venuePreference: row.venue_preference,
  orderPolicy: row.order_policy ?? "FOK",
  slippageToleranceBps: row.slippage_tolerance_bps ?? 100,
  signingMode: row.signing_mode,
  primaryAction: row.primary_action,
  readinessSummary: row.readiness_summary,
  venueCapabilitySummary: row.venue_capability_summary,
  blockers: row.blockers,
  signatureRequestHash: row.signature_request_hash,
  lastError: row.last_error,
  expiresAt: row.expires_at?.toISOString() ?? null,
  nextPollAt: row.next_poll_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapSignedTradeExecutionStatusRow = (row: SignedTradeExecutionStatusRow): SignedTradeExecutionStatus => ({
  executionId: row.execution_id,
  userId: row.user_id,
  status: row.status,
  dryRun: row.dry_run,
  submittedAt: row.submitted_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  ...(row.selected_route ? { route: row.selected_route } : {}),
  ...(row.watcher_metadata ? { watcherMetadata: row.watcher_metadata } : {}),
  submittedLegs: row.submitted_legs
});

const positionSizeFromFill = (fillState: { filledSize?: string | undefined; offchainFilled?: boolean | undefined }, fallbackSize: string): string => {
  const parsed = Number(fillState.filledSize);
  if (Number.isFinite(parsed) && parsed > 0) {
    return String(fillState.filledSize);
  }
  return fillState.offchainFilled === true ? fallbackSize : "0";
};
