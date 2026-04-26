import type { Pool } from "pg";
import type {
  FundingAggregateState,
  FundingAuditEventType,
  FundingIntent,
  FundingLegState,
  FundingReconciliationRecord,
  FundingRouteLeg,
  FundingTarget,
  FundingVenue
} from "../core/funding/types.js";
import type { FundingRepository as FundingRepositoryContract } from "../core/funding/funding-service.js";

interface FundingIntentRow {
  id: string;
  user_id: string;
  source_chain: string;
  source_token: string;
  source_amount: string;
  source_wallet_address: string;
  status: FundingAggregateState;
  idempotency_key: string;
  aggregate_route_quote: Record<string, unknown>;
  total_estimated_fees: string;
  total_estimated_time_seconds: number | null;
  audit_event_ids: string[];
  created_at: Date;
  updated_at: Date;
}

interface FundingTargetRow {
  id: string;
  funding_intent_id: string;
  target_venue: FundingVenue;
  target_chain: string;
  target_token: string;
  target_amount: string;
  target_percentage: string | null;
  venue_capability_snapshot: Record<string, unknown>;
  status: FundingLegState;
  created_at: Date;
  updated_at: Date;
}

interface FundingRouteLegRow {
  id: string;
  funding_intent_id: string;
  funding_target_id: string;
  target_venue: FundingVenue;
  source_chain: string;
  source_token: string;
  source_amount: string;
  destination_chain: string;
  destination_token: string;
  destination_amount_estimate: string;
  route_provider: "LIFI";
  route_quote: FundingRouteLeg["routeQuote"];
  tx_hashes: string[];
  provider_status: Record<string, unknown>;
  bridge_status: string;
  destination_status: string;
  venue_credit_status: string;
  status: FundingLegState;
  error_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface FundingReconciliationRow {
  id: string;
  funding_intent_id: string;
  route_leg_id: string;
  target_venue: FundingVenue;
  destination_tx_hash: string | null;
  destination_received: boolean;
  venue_credit_confirmed: boolean;
  ready_to_trade: boolean;
  checked_at: Date;
  notes: string;
}

interface FundingAdminReadinessRow {
  funding_intent_id: string;
  user_id: string;
  target_venue: FundingVenue;
  source_chain: string;
  source_token: string;
  source_amount: string;
  target_chain: string;
  target_token: string;
  target_amount: string;
  route_leg_id: string | null;
  destination_chain: string | null;
  destination_token: string | null;
  destination_amount_estimate: string | null;
  route_provider: "LIFI" | null;
  aggregate_funding_status: FundingAggregateState;
  route_leg_status: FundingLegState | null;
  bridge_status: string | null;
  destination_status: string | null;
  venue_credit_status: string | null;
  tx_hashes: string[] | null;
  error_reason: string | null;
  destination_tx_hash: string | null;
  destination_received: boolean | null;
  venue_credit_confirmed: boolean | null;
  ready_to_trade: boolean | null;
  reconciliation_checked_at: Date | null;
  reconciliation_notes: string | null;
  audit_event_ids: string[] | null;
  created_at: Date;
  updated_at: Date;
}

export interface FundingAdminReadinessRecord {
  fundingIntentId: string;
  userId: string;
  targetVenue: FundingVenue;
  sourceChain: string;
  sourceToken: string;
  sourceAmount: string;
  targetChain: string;
  targetToken: string;
  targetAmount: string;
  routeLegId: string | null;
  destinationChain: string | null;
  destinationToken: string | null;
  destinationAmountEstimate: string | null;
  routeProvider: "LIFI" | null;
  aggregateFundingStatus: FundingAggregateState;
  routeLegStatus: FundingLegState | null;
  bridgeStatus: string | null;
  destinationStatus: string | null;
  venueCreditStatus: string | null;
  txHashes: string[];
  errorReason: string | null;
  destinationTxHash: string | null;
  destinationReceived: boolean | null;
  venueCreditConfirmed: boolean | null;
  readyToTrade: boolean | null;
  reconciliationCheckedAt: string | null;
  reconciliationNotes: string | null;
  auditEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export class FundingRepository implements FundingRepositoryContract {
  public constructor(private readonly pool: Pool) {}

  public async findIntentById(id: string): Promise<FundingIntent | null> {
    const result = await this.pool.query<FundingIntentRow>("SELECT * FROM funding_intents WHERE id = $1::uuid", [id]);
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  public async findIntentByUserAndIdempotencyKey(userId: string, idempotencyKey: string): Promise<FundingIntent | null> {
    const result = await this.pool.query<FundingIntentRow>(
      "SELECT * FROM funding_intents WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1",
      [userId, idempotencyKey]
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  public async createIntent(input: FundingIntent, targets: FundingTarget[]): Promise<FundingIntent> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<FundingIntentRow>(
        `INSERT INTO funding_intents (
          id, user_id, source_chain, source_token, source_amount, source_wallet_address, status,
          idempotency_key, aggregate_route_quote, total_estimated_fees, total_estimated_time_seconds, audit_event_ids
        ) VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb
        )
        ON CONFLICT (user_id, idempotency_key) DO UPDATE SET updated_at = funding_intents.updated_at
        RETURNING *`,
        [
          input.fundingIntentId,
          input.userId,
          input.sourceChain,
          input.sourceToken,
          input.sourceAmount,
          input.sourceWalletAddress,
          input.status,
          input.idempotencyKey,
          JSON.stringify(input.aggregateRouteQuote),
          input.totalEstimatedFees,
          input.totalEstimatedTimeSeconds,
          JSON.stringify(input.auditEventIds)
        ]
      );
      for (const target of targets) {
        await client.query(
          `INSERT INTO funding_targets (
            id, funding_intent_id, target_venue, target_chain, target_token, target_amount,
            target_percentage, venue_capability_snapshot, status
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9)
          ON CONFLICT (id) DO NOTHING`,
          [
            target.fundingTargetId,
            target.fundingIntentId,
            target.targetVenue,
            target.targetChain,
            target.targetToken,
            target.targetAmount,
            target.targetPercentage,
            JSON.stringify(target.venueCapabilitySnapshot),
            target.status
          ]
        );
      }
      await client.query("COMMIT");
      return mapIntent(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listTargets(fundingIntentId: string): Promise<FundingTarget[]> {
    const result = await this.pool.query<FundingTargetRow>(
      "SELECT * FROM funding_targets WHERE funding_intent_id = $1::uuid ORDER BY created_at ASC",
      [fundingIntentId]
    );
    return result.rows.map(mapTarget);
  }

  public async listRouteLegs(fundingIntentId: string): Promise<FundingRouteLeg[]> {
    const result = await this.pool.query<FundingRouteLegRow>(
      "SELECT * FROM funding_route_legs WHERE funding_intent_id = $1::uuid ORDER BY created_at ASC",
      [fundingIntentId]
    );
    return result.rows.map(mapRouteLeg);
  }

  public async listReconciliations(fundingIntentId: string): Promise<FundingReconciliationRecord[]> {
    const result = await this.pool.query<FundingReconciliationRow>(
      "SELECT * FROM funding_reconciliation_records WHERE funding_intent_id = $1::uuid ORDER BY checked_at DESC",
      [fundingIntentId]
    );
    return result.rows.map(mapReconciliation);
  }

  public async replaceRouteLegs(fundingIntentId: string, routeLegs: FundingRouteLeg[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM funding_route_legs WHERE funding_intent_id = $1::uuid", [fundingIntentId]);
      for (const leg of routeLegs) {
        await client.query(
          `INSERT INTO funding_route_legs (
            id, funding_intent_id, funding_target_id, target_venue, source_chain, source_token, source_amount,
            destination_chain, destination_token, destination_amount_estimate, route_provider, route_quote,
            tx_hashes, provider_status, bridge_status, destination_status, venue_credit_status, status, error_reason
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
            $13::jsonb, $14::jsonb, $15, $16, $17, $18, $19
          )`,
          [
            leg.routeLegId,
            leg.fundingIntentId,
            leg.fundingTargetId,
            leg.targetVenue,
            leg.sourceChain,
            leg.sourceToken,
            leg.sourceAmount,
            leg.destinationChain,
            leg.destinationToken,
            leg.destinationAmountEstimate,
            leg.routeProvider,
            JSON.stringify(leg.routeQuote),
            JSON.stringify(leg.txHashes),
            JSON.stringify(leg.providerStatus),
            leg.bridgeStatus,
            leg.destinationStatus,
            leg.venueCreditStatus,
            leg.status,
            leg.errorReason
          ]
        );
        await client.query("UPDATE funding_targets SET status = $1, updated_at = now() WHERE id = $2::uuid", [
          leg.status,
          leg.fundingTargetId
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateIntentStatus(fundingIntentId: string, status: FundingAggregateState, patch: Record<string, unknown> = {}): Promise<void> {
    await this.pool.query(
      `UPDATE funding_intents
          SET status = $2,
              aggregate_route_quote = COALESCE($3::jsonb, aggregate_route_quote),
              total_estimated_fees = COALESCE($4, total_estimated_fees),
              total_estimated_time_seconds = COALESCE($5, total_estimated_time_seconds),
              updated_at = now()
        WHERE id = $1::uuid`,
      [
        fundingIntentId,
        status,
        patch.aggregateRouteQuote ? JSON.stringify(patch.aggregateRouteQuote) : null,
        typeof patch.totalEstimatedFees === "string" ? patch.totalEstimatedFees : null,
        typeof patch.totalEstimatedTimeSeconds === "number" ? patch.totalEstimatedTimeSeconds : null
      ]
    );
  }

  public async updateRouteLegSubmission(input: { routeLegId: string; txHash: string; status: FundingLegState }): Promise<void> {
    await this.pool.query(
      `WITH updated_leg AS (
        UPDATE funding_route_legs
           SET tx_hashes = tx_hashes || jsonb_build_array($2::text),
               status = $3,
               bridge_status = 'PENDING',
               updated_at = now()
         WHERE id = $1::uuid
         RETURNING funding_target_id
      )
      UPDATE funding_targets
         SET status = $3,
             updated_at = now()
       WHERE id IN (SELECT funding_target_id FROM updated_leg)`,
      [input.routeLegId, input.txHash, input.status]
    );
  }

  public async updateRouteLegProviderStatus(input: {
    routeLegId: string;
    status: FundingLegState;
    bridgeStatus: string;
    destinationStatus: string;
    venueCreditStatus: string;
    providerStatus: Record<string, unknown>;
    errorReason?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `WITH updated_leg AS (
        UPDATE funding_route_legs
           SET status = $2,
               bridge_status = $3,
               destination_status = $4,
               venue_credit_status = $5,
               provider_status = $6::jsonb,
               error_reason = $7,
               updated_at = now()
         WHERE id = $1::uuid
         RETURNING funding_target_id
      )
      UPDATE funding_targets
         SET status = $2,
             updated_at = now()
       WHERE id IN (SELECT funding_target_id FROM updated_leg)`,
      [
        input.routeLegId,
        input.status,
        input.bridgeStatus,
        input.destinationStatus,
        input.venueCreditStatus,
        JSON.stringify(input.providerStatus),
        input.errorReason ?? null
      ]
    );
  }

  public async createReconciliationRecord(input: {
    fundingIntentId: string;
    routeLegId: string;
    targetVenue: FundingVenue;
    destinationTxHash?: string | null;
    destinationReceived: boolean;
    venueCreditConfirmed: boolean;
    readyToTrade: boolean;
    notes?: string;
  }): Promise<FundingReconciliationRecord> {
    const result = await this.pool.query<FundingReconciliationRow>(
      `INSERT INTO funding_reconciliation_records (
        funding_intent_id, route_leg_id, target_venue, destination_tx_hash,
        destination_received, venue_credit_confirmed, ready_to_trade, notes
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        input.fundingIntentId,
        input.routeLegId,
        input.targetVenue,
        input.destinationTxHash ?? null,
        input.destinationReceived,
        input.venueCreditConfirmed,
        input.readyToTrade,
        input.notes ?? ""
      ]
    );
    return mapReconciliation(result.rows[0]!);
  }

  public async appendAuditEvent(input: {
    fundingIntentId: string;
    routeLegId?: string | null;
    eventType: FundingAuditEventType;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO funding_audit_events (funding_intent_id, route_leg_id, event_type, payload)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)
       RETURNING id::text`,
      [
        input.fundingIntentId,
        input.routeLegId ?? null,
        input.eventType,
        JSON.stringify(input.payload)
      ]
    );
    const id = result.rows[0]!.id;
    await this.pool.query(
      `UPDATE funding_intents
          SET audit_event_ids = audit_event_ids || jsonb_build_array($2::text),
              updated_at = now()
        WHERE id = $1::uuid`,
      [input.fundingIntentId, id]
    );
    return id;
  }

  public async listAdminReadinessRows(filter: {
    fundingIntentId?: string;
    userId?: string;
    venue?: string;
    limit?: number;
  } = {}): Promise<FundingAdminReadinessRecord[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (filter.fundingIntentId) {
      values.push(filter.fundingIntentId);
      conditions.push(`fi.id = $${values.length}::uuid`);
    }
    if (filter.userId) {
      values.push(filter.userId);
      conditions.push(`fi.user_id = $${values.length}`);
    }
    if (filter.venue) {
      values.push(filter.venue.toUpperCase());
      conditions.push(`ft.target_venue = $${values.length}`);
    }
    values.push(filter.limit ?? 200);
    const limitIndex = values.length;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<FundingAdminReadinessRow>(
      `WITH latest_reconciliation AS (
         SELECT DISTINCT ON (route_leg_id)
                funding_intent_id,
                route_leg_id,
                target_venue,
                destination_tx_hash,
                destination_received,
                venue_credit_confirmed,
                ready_to_trade,
                checked_at,
                notes
           FROM funding_reconciliation_records
          ORDER BY route_leg_id, checked_at DESC
       ),
       audit_ids AS (
         SELECT funding_intent_id,
                jsonb_agg(id::text ORDER BY created_at ASC) AS audit_event_ids
           FROM funding_audit_events
          GROUP BY funding_intent_id
       )
       SELECT fi.id::text AS funding_intent_id,
              fi.user_id,
              ft.target_venue,
              fi.source_chain,
              fi.source_token,
              fi.source_amount,
              ft.target_chain,
              ft.target_token,
              ft.target_amount,
              fl.id::text AS route_leg_id,
              fl.destination_chain,
              fl.destination_token,
              fl.destination_amount_estimate,
              fl.route_provider,
              fi.status AS aggregate_funding_status,
              fl.status AS route_leg_status,
              fl.bridge_status,
              fl.destination_status,
              fl.venue_credit_status,
              fl.tx_hashes,
              fl.error_reason,
              lr.destination_tx_hash,
              lr.destination_received,
              lr.venue_credit_confirmed,
              lr.ready_to_trade,
              lr.checked_at AS reconciliation_checked_at,
              lr.notes AS reconciliation_notes,
              COALESCE(ai.audit_event_ids, fi.audit_event_ids, '[]'::jsonb) AS audit_event_ids,
              fi.created_at,
              fi.updated_at
         FROM funding_intents fi
         JOIN funding_targets ft ON ft.funding_intent_id = fi.id
         LEFT JOIN funding_route_legs fl ON fl.funding_target_id = ft.id
         LEFT JOIN latest_reconciliation lr ON lr.route_leg_id = fl.id
         LEFT JOIN audit_ids ai ON ai.funding_intent_id = fi.id
        ${whereClause}
        ORDER BY fi.created_at DESC, ft.created_at ASC, fl.created_at ASC
        LIMIT $${limitIndex}`,
      values
    );
    return result.rows.map(mapAdminReadinessRow);
  }

  public async hasReadyVenueBalance(input: { userId: string; venue: string; token: string; amount: string }): Promise<boolean> {
    const result = await this.pool.query<{ ready_amount: string }>(
      `SELECT COALESCE(SUM((ft.target_amount)::numeric), 0)::text AS ready_amount
         FROM funding_targets ft
         JOIN funding_intents fi ON fi.id = ft.funding_intent_id
         JOIN funding_reconciliation_records fr ON fr.funding_intent_id = fi.id
         JOIN funding_route_legs fl ON fl.id = fr.route_leg_id AND fl.funding_target_id = ft.id
        WHERE fi.user_id = $1
          AND ft.target_venue = $2
          AND ft.target_token = $3
          AND fr.target_venue = ft.target_venue
          AND fr.ready_to_trade = true`,
      [input.userId, input.venue, input.token]
    );
    return Number(result.rows[0]?.ready_amount ?? "0") >= Number(input.amount);
  }
}

const mapIntent = (row: FundingIntentRow): FundingIntent => ({
  fundingIntentId: row.id,
  userId: row.user_id,
  sourceChain: row.source_chain,
  sourceToken: row.source_token,
  sourceAmount: row.source_amount,
  sourceWalletAddress: row.source_wallet_address,
  status: row.status,
  idempotencyKey: row.idempotency_key,
  aggregateRouteQuote: row.aggregate_route_quote ?? {},
  totalEstimatedFees: row.total_estimated_fees,
  totalEstimatedTimeSeconds: row.total_estimated_time_seconds,
  auditEventIds: row.audit_event_ids ?? [],
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapTarget = (row: FundingTargetRow): FundingTarget => ({
  fundingTargetId: row.id,
  fundingIntentId: row.funding_intent_id,
  targetVenue: row.target_venue,
  targetChain: row.target_chain,
  targetToken: row.target_token,
  targetAmount: row.target_amount,
  targetPercentage: row.target_percentage === null ? null : Number(row.target_percentage),
  venueCapabilitySnapshot: row.venue_capability_snapshot ?? {},
  status: row.status,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapRouteLeg = (row: FundingRouteLegRow): FundingRouteLeg => ({
  routeLegId: row.id,
  fundingIntentId: row.funding_intent_id,
  fundingTargetId: row.funding_target_id,
  targetVenue: row.target_venue,
  sourceChain: row.source_chain,
  sourceToken: row.source_token,
  sourceAmount: row.source_amount,
  destinationChain: row.destination_chain,
  destinationToken: row.destination_token,
  destinationAmountEstimate: row.destination_amount_estimate,
  routeProvider: row.route_provider,
  routeQuote: row.route_quote,
  txHashes: row.tx_hashes ?? [],
  providerStatus: row.provider_status ?? {},
  bridgeStatus: row.bridge_status,
  destinationStatus: row.destination_status,
  venueCreditStatus: row.venue_credit_status,
  status: row.status,
  errorReason: row.error_reason,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapReconciliation = (row: FundingReconciliationRow): FundingReconciliationRecord => ({
  reconciliationId: row.id,
  fundingIntentId: row.funding_intent_id,
  routeLegId: row.route_leg_id,
  targetVenue: row.target_venue,
  destinationTxHash: row.destination_tx_hash,
  destinationReceived: row.destination_received,
  venueCreditConfirmed: row.venue_credit_confirmed,
  readyToTrade: row.ready_to_trade,
  checkedAt: row.checked_at.toISOString(),
  notes: row.notes
});

const mapAdminReadinessRow = (row: FundingAdminReadinessRow): FundingAdminReadinessRecord => ({
  fundingIntentId: row.funding_intent_id,
  userId: row.user_id,
  targetVenue: row.target_venue,
  sourceChain: row.source_chain,
  sourceToken: row.source_token,
  sourceAmount: row.source_amount,
  targetChain: row.target_chain,
  targetToken: row.target_token,
  targetAmount: row.target_amount,
  routeLegId: row.route_leg_id,
  destinationChain: row.destination_chain,
  destinationToken: row.destination_token,
  destinationAmountEstimate: row.destination_amount_estimate,
  routeProvider: row.route_provider,
  aggregateFundingStatus: row.aggregate_funding_status,
  routeLegStatus: row.route_leg_status,
  bridgeStatus: row.bridge_status,
  destinationStatus: row.destination_status,
  venueCreditStatus: row.venue_credit_status,
  txHashes: row.tx_hashes ?? [],
  errorReason: row.error_reason,
  destinationTxHash: row.destination_tx_hash,
  destinationReceived: row.destination_received,
  venueCreditConfirmed: row.venue_credit_confirmed,
  readyToTrade: row.ready_to_trade,
  reconciliationCheckedAt: row.reconciliation_checked_at ? row.reconciliation_checked_at.toISOString() : null,
  reconciliationNotes: row.reconciliation_notes,
  auditEventIds: row.audit_event_ids ?? [],
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});
