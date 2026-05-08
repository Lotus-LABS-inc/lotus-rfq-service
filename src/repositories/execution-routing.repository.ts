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
  SignedTradeExecutionStatusRepository
} from "../execution-system/signed-trade-bundle.js";

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
  submitted_legs: SignedTradeExecutionStatus["submittedLegs"];
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
         ${venueClause}
       ORDER BY updated_at DESC`,
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
        submitted_legs
      ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb)
      ON CONFLICT (execution_id, user_id) DO UPDATE SET
        status = EXCLUDED.status,
        dry_run = EXCLUDED.dry_run,
        submitted_at = LEAST(signed_trade_bundle_executions.submitted_at, EXCLUDED.submitted_at),
        updated_at = EXCLUDED.updated_at,
        submitted_legs = EXCLUDED.submitted_legs`,
      [
        status.executionId,
        status.userId,
        status.status,
        status.dryRun,
        status.submittedAt,
        status.updatedAt,
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

const mapSignedTradeExecutionStatusRow = (row: SignedTradeExecutionStatusRow): SignedTradeExecutionStatus => ({
  executionId: row.execution_id,
  userId: row.user_id,
  status: row.status,
  dryRun: row.dry_run,
  submittedAt: row.submitted_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  submittedLegs: row.submitted_legs
});
