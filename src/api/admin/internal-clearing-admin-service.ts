import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Logger } from "pino";
import type { Pool } from "pg";

import type { RedisClient } from "../../db/redis.js";
import { ResidualVectorBuilder } from "../../core/combo-engine/residual-vector-builder.js";
import type { ResidualVectorEntity, ResidualVectorLeg } from "../../core/combo-engine/types.js";

interface ClearingRoundRow {
  id: string;
  compatibility_bucket: string;
  state: string;
  participant_count: number;
  unique_leg_count: number;
  compression_score: string;
  participant_set_hash: string;
  match_signature_hash: string;
  created_at: Date;
}

interface ClearingRoundParticipantRow {
  id: string;
  clearing_round_id: string;
  combo_or_order_id: string;
  participant_user_id: string;
  role: string;
  original_remaining: Record<string, unknown>;
  matched_remaining: Record<string, unknown>;
  created_at: Date;
}

interface ClearingRoundLegMatchRow {
  id: string;
  clearing_round_id: string;
  market_id: string;
  outcome_id: string;
  participant_id: string;
  signed_matched_size: string;
  price: string | null;
  created_at: Date;
}

interface ClearingRoundEventRow {
  id: string;
  clearing_round_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

interface ComboRFQRow {
  id: string;
  user_id: string;
  acceptance_policy: string;
  state: string;
  expires_at: Date;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

interface ComboLegRow {
  id: string;
  combo_rfq_id: string;
  canonical_market_id: string;
  canonical_outcome_id: string;
  side: "buy" | "sell";
  size: string;
  remaining_size: string;
  price_hint: string | null;
  metadata: Record<string, unknown> | null;
}

interface ExposureJournalRow {
  id: number;
  exposure_id: string | null;
  change: string;
  prev_gross: string | null;
  prev_net: string | null;
  new_gross: string | null;
  new_net: string | null;
  source: string;
  reference_id: string | null;
  created_at: Date;
  payload: Record<string, unknown> | null;
}

interface ResidualRedisStatus {
  compatibility_bucket: string | null;
  expected_present: boolean;
  snapshot_present: boolean;
  bucket_present: boolean;
}

interface ClearingEntitySnapshot extends ComboRFQRow {
  legs: ComboLegRow[];
}

export interface InternalClearingRoundInspection {
  round: ClearingRoundRow;
  participants: Array<ClearingRoundParticipantRow & { entity: ClearingEntitySnapshot }>;
  matched_legs: ClearingRoundLegMatchRow[];
  exposure_journal_references: ExposureJournalRow[];
  residual_states: Array<{
    participant_id: string;
    entity_id: string;
    user_id: string;
    state: string;
    total_remaining_size: string;
    legs: ComboLegRow[];
    redis_bucket_status: ResidualRedisStatus;
  }>;
}

export interface InternalClearingEntityInspection {
  entity: ClearingEntitySnapshot;
  residual_state: {
    total_remaining_size: string;
    redis_bucket_status: ResidualRedisStatus;
  };
  participation_history: Array<{
    participant: ClearingRoundParticipantRow;
    round: ClearingRoundRow;
  }>;
}

export interface InternalClearingReconcileInput {
  roundId: string;
  requestedBy: string;
  dryRun: boolean;
  correlationId?: string;
}

export interface InternalClearingForceFailInput {
  roundId: string;
  requestedBy: string;
  reason: string;
  correlationId?: string;
}

export interface InternalClearingReconcileReport {
  round_id: string;
  dry_run: boolean;
  discrepancies: Array<{
    code: string;
    severity: "warning" | "critical";
    message: string;
    details?: Record<string, unknown>;
  }>;
  admin_event_id: string;
}

export class InternalClearingRoundNotFoundError extends Error {
  public constructor(roundId: string) {
    super(`Internal clearing round ${roundId} not found.`);
    this.name = "InternalClearingRoundNotFoundError";
  }
}

export class InternalClearingEntityNotFoundError extends Error {
  public constructor(entityId: string) {
    super(`Internal clearing entity ${entityId} not found.`);
    this.name = "InternalClearingEntityNotFoundError";
  }
}

export class InternalClearingAmbiguityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InternalClearingAmbiguityError";
  }
}

export interface InternalClearingAdminServiceDeps {
  pool: Pool;
  redis: RedisClient;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export class InternalClearingAdminService {
  private readonly residualVectorBuilder = new ResidualVectorBuilder();

  public constructor(private readonly deps: InternalClearingAdminServiceDeps) {}

  public async getRoundInspection(roundId: string): Promise<InternalClearingRoundInspection> {
    const round = await this.loadRound(roundId);
    const [participants, matchedLegs, events, journals] = await Promise.all([
      this.loadRoundParticipants(roundId),
      this.loadRoundLegMatches(roundId),
      this.loadRoundEvents(roundId),
      this.loadExposureJournalByRound(roundId)
    ]);

    if (participants.length === 0) {
      throw new InternalClearingAmbiguityError(`Clearing round ${roundId} has no participants.`);
    }

    const participantEntities = await Promise.all(
      participants.map(async (participant) => ({
        ...participant,
        entity: await this.loadEntity(participant.combo_or_order_id)
      }))
    );

    const participantById = new Map(participants.map((participant) => [participant.id, participant]));
    for (const match of matchedLegs) {
      if (!participantById.has(match.participant_id)) {
        throw new InternalClearingAmbiguityError(
          `Clearing round ${roundId} has leg match ${match.id} referencing missing participant ${match.participant_id}.`
        );
      }
    }

    if (!events.some((event) => event.event_type === "CLEARING_APPLIED")) {
      throw new InternalClearingAmbiguityError(`Clearing round ${roundId} is missing CLEARING_APPLIED event history.`);
    }

    const residualStates = await Promise.all(
      participantEntities.map(async ({ id, entity }) => ({
        participant_id: id,
        entity_id: entity.id,
        user_id: entity.user_id,
        state: entity.state,
        total_remaining_size: this.sumRemaining(entity.legs),
        legs: entity.legs,
        redis_bucket_status: await this.inspectRedisBucketStatus(entity)
      }))
    );

    return {
      round,
      participants: participantEntities,
      matched_legs: matchedLegs,
      exposure_journal_references: journals,
      residual_states: residualStates
    };
  }

  public async getEntityInspection(entityId: string): Promise<InternalClearingEntityInspection> {
    const entity = await this.loadEntity(entityId);
    const participants = await this.loadEntityRoundParticipants(entityId);
    const rounds = participants.length > 0 ? await this.loadRoundsByIds(participants.map((participant) => participant.clearing_round_id)) : [];
    const roundById = new Map(rounds.map((round) => [round.id, round]));
    const redisBucketStatus = await this.inspectRedisBucketStatus(entity);

    const participationHistory = participants.map((participant) => {
      const round = roundById.get(participant.clearing_round_id);
      if (!round) {
        throw new InternalClearingAmbiguityError(
          `Entity ${entityId} has participation row ${participant.id} without a linked clearing round.`
        );
      }
      return { participant, round };
    });

    return {
      entity,
      residual_state: {
        total_remaining_size: this.sumRemaining(entity.legs),
        redis_bucket_status: redisBucketStatus
      },
      participation_history: participationHistory
    };
  }

  public async reconcileRound(input: InternalClearingReconcileInput): Promise<InternalClearingReconcileReport> {
    const round = await this.loadRound(input.roundId);
    const [participants, matchedLegs, events, journals] = await Promise.all([
      this.loadRoundParticipants(round.id),
      this.loadRoundLegMatches(round.id),
      this.loadRoundEvents(round.id),
      this.loadExposureJournalByRound(round.id)
    ]);

    const discrepancies: InternalClearingReconcileReport["discrepancies"] = [];
    const participantEntities = new Map<string, ClearingEntitySnapshot>();

    for (const participant of participants) {
      try {
        participantEntities.set(participant.id, await this.loadEntity(participant.combo_or_order_id));
      } catch (error) {
        if (error instanceof InternalClearingEntityNotFoundError) {
          discrepancies.push({
            code: "PARTICIPANT_REFERENCE_MISSING",
            severity: "critical",
            message: "A clearing participant references an entity that no longer exists.",
            details: {
              participant_id: participant.id,
              combo_or_order_id: participant.combo_or_order_id
            }
          });
          continue;
        }
        throw error;
      }
    }

    if (!events.some((event) => event.event_type === "CLEARING_APPLIED")) {
      discrepancies.push({
        code: "ROUND_EVENT_MISSING",
        severity: "critical",
        message: "Clearing round is missing CLEARING_APPLIED event."
      });
    }

    const expectedUsers = new Set(participants.map((participant) => participant.participant_user_id));
    const journalUsers = new Set<string>();
    for (const journal of journals) {
      const userId = typeof journal.payload?.userId === "string" ? journal.payload.userId : null;
      if (userId) {
        journalUsers.add(userId);
      }
    }

    for (const userId of expectedUsers) {
      if (!journalUsers.has(userId)) {
        discrepancies.push({
          code: "EXPOSURE_JOURNAL_INCOMPLETE",
          severity: "critical",
          message: "Exposure journal rows are missing for at least one participant user.",
          details: { user_id: userId }
        });
      }
    }

    for (const participant of participants) {
      const entity = participantEntities.get(participant.id);
      if (!entity) {
        continue;
      }

      this.pushEntityStateMismatch(discrepancies, participant, entity);
      const redisStatus = await this.inspectRedisBucketStatus(entity);
      if (redisStatus.expected_present !== redisStatus.bucket_present || redisStatus.expected_present !== redisStatus.snapshot_present) {
        discrepancies.push({
          code: "REDIS_BUCKET_MISMATCH",
          severity: "warning",
          message: "Redis bucket or entity snapshot does not match authoritative residual state.",
          details: {
            participant_id: participant.id,
            entity_id: entity.id,
            expected_present: redisStatus.expected_present,
            bucket_present: redisStatus.bucket_present,
            snapshot_present: redisStatus.snapshot_present,
            compatibility_bucket: redisStatus.compatibility_bucket
          }
        });
      }
    }

    for (const match of matchedLegs) {
      const participant = participants.find((candidate) => candidate.id === match.participant_id);
      const entity = participant ? participantEntities.get(participant.id) : null;
      if (!participant || !entity) {
        discrepancies.push({
          code: "LEG_MATCH_REFERENCE_MISSING",
          severity: "critical",
          message: "Clearing leg match references a participant or entity that is missing.",
          details: {
            leg_match_id: match.id,
            participant_id: match.participant_id
          }
        });
        continue;
      }

      const key = `${match.market_id}:${match.outcome_id}`;
      const originalRemaining = this.readSignedRemaining(participant.original_remaining, key);
      if (originalRemaining === null) {
        discrepancies.push({
          code: "LEG_MATCH_REFERENCE_MISSING",
          severity: "critical",
          message: "Clearing leg match key is missing from participant original remaining snapshot.",
          details: {
            leg_match_id: match.id,
            participant_id: match.participant_id,
            key
          }
        });
        continue;
      }

      const matchedAbs = this.absDecimal(match.signed_matched_size, "signed_matched_size");
      if (matchedAbs.greaterThan(originalRemaining.abs())) {
        discrepancies.push({
          code: "MATCH_SIZE_EXCEEDS_RESIDUAL",
          severity: "critical",
          message: "Clearing leg match exceeds participant residual contribution.",
          details: {
            leg_match_id: match.id,
            participant_id: match.participant_id,
            matched_size: match.signed_matched_size,
            original_remaining: originalRemaining.toString()
          }
        });
      }

      const hasLeg = entity.legs.some(
        (leg) => leg.canonical_market_id === match.market_id && leg.canonical_outcome_id === match.outcome_id
      );
      if (!hasLeg) {
        discrepancies.push({
          code: "LEG_MATCH_REFERENCE_MISSING",
          severity: "critical",
          message: "Clearing leg match no longer aligns with the participant entity leg set.",
          details: {
            leg_match_id: match.id,
            participant_id: match.participant_id,
            market_id: match.market_id,
            outcome_id: match.outcome_id
          }
        });
      }
    }

    const correlationId = input.correlationId ?? randomUUID();
    const adminEventId = await this.insertAdminEvent({
      entityType: "ROUND",
      entityId: round.id,
      action: "RECONCILE",
      requestedBy: input.requestedBy,
      correlationId,
      payload: {
        dry_run: input.dryRun,
        discrepancy_count: discrepancies.length
      }
    });

    return {
      round_id: round.id,
      dry_run: input.dryRun,
      discrepancies,
      admin_event_id: adminEventId
    };
  }

  public async createForceFailTask(input: InternalClearingForceFailInput): Promise<{
    task_id: string;
    round_id: string;
    correlation_id: string;
    status: string;
    admin_event_id: string;
  }> {
    const round = await this.loadRound(input.roundId);
    const correlationId = input.correlationId ?? randomUUID();
    const taskId = randomUUID();

    await this.deps.pool.query(
      `INSERT INTO internal_clearing_unwind_tasks
        (id, clearing_round_id, requested_by, reason, correlation_id, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [taskId, round.id, input.requestedBy, input.reason, correlationId, "PENDING", JSON.stringify({ phase: "PHASE_2B" })]
    );

    const adminEventId = await this.insertAdminEvent({
      entityType: "ROUND",
      entityId: round.id,
      action: "FORCE_FAIL_REQUESTED",
      requestedBy: input.requestedBy,
      correlationId,
      payload: {
        task_id: taskId,
        reason: input.reason
      }
    });

    this.deps.logger.warn(
      {
        roundId: round.id,
        taskId,
        correlationId,
        requestedBy: input.requestedBy
      },
      "Admin created internal clearing force-fail task."
    );

    return {
      task_id: taskId,
      round_id: round.id,
      correlation_id: correlationId,
      status: "PENDING",
      admin_event_id: adminEventId
    };
  }

  private async loadRound(roundId: string): Promise<ClearingRoundRow> {
    const result = await this.deps.pool.query<ClearingRoundRow>(
      `SELECT id, compatibility_bucket, state, participant_count, unique_leg_count,
              compression_score::text, participant_set_hash, match_signature_hash, created_at
       FROM clearing_rounds
       WHERE id = $1
       LIMIT 1`,
      [roundId]
    );
    const round = result.rows[0];
    if (!round) {
      throw new InternalClearingRoundNotFoundError(roundId);
    }
    return round;
  }

  private async loadRoundsByIds(roundIds: readonly string[]): Promise<ClearingRoundRow[]> {
    if (roundIds.length === 0) {
      return [];
    }
    const result = await this.deps.pool.query<ClearingRoundRow>(
      `SELECT id, compatibility_bucket, state, participant_count, unique_leg_count,
              compression_score::text, participant_set_hash, match_signature_hash, created_at
       FROM clearing_rounds
       WHERE id = ANY($1::uuid[])
       ORDER BY created_at DESC, id DESC`,
      [roundIds]
    );
    return result.rows;
  }

  private async loadRoundParticipants(roundId: string): Promise<ClearingRoundParticipantRow[]> {
    const result = await this.deps.pool.query<ClearingRoundParticipantRow>(
      `SELECT id, clearing_round_id, combo_or_order_id, participant_user_id, role,
              original_remaining, matched_remaining, created_at
       FROM clearing_round_participants
       WHERE clearing_round_id = $1
       ORDER BY created_at ASC, id ASC`,
      [roundId]
    );
    return result.rows;
  }

  private async loadRoundLegMatches(roundId: string): Promise<ClearingRoundLegMatchRow[]> {
    const result = await this.deps.pool.query<ClearingRoundLegMatchRow>(
      `SELECT id, clearing_round_id, market_id, outcome_id, participant_id,
              signed_matched_size::text, price::text, created_at
       FROM clearing_round_leg_matches
       WHERE clearing_round_id = $1
       ORDER BY created_at ASC, id ASC`,
      [roundId]
    );
    return result.rows;
  }

  private async loadRoundEvents(roundId: string): Promise<ClearingRoundEventRow[]> {
    const result = await this.deps.pool.query<ClearingRoundEventRow>(
      `SELECT id, clearing_round_id, event_type, payload, created_at
       FROM clearing_round_events
       WHERE clearing_round_id = $1
       ORDER BY created_at ASC, id ASC`,
      [roundId]
    );
    return result.rows;
  }

  private async loadExposureJournalByRound(roundId: string): Promise<ExposureJournalRow[]> {
    const result = await this.deps.pool.query<ExposureJournalRow>(
      `SELECT id, exposure_id::text, change::text, prev_gross::text, prev_net::text,
              new_gross::text, new_net::text, source, reference_id::text, created_at, payload
       FROM exposure_journal
       WHERE reference_id::text = $1
         AND source = 'combo-multi-party-clearing'
       ORDER BY created_at ASC, id ASC`,
      [roundId]
    );
    return result.rows;
  }

  private async loadEntity(entityId: string): Promise<ClearingEntitySnapshot> {
    const comboResult = await this.deps.pool.query<ComboRFQRow>(
      `SELECT id, user_id, acceptance_policy, state, expires_at, metadata, created_at
       FROM combo_rfqs
       WHERE id = $1
       LIMIT 1`,
      [entityId]
    );
    const combo = comboResult.rows[0];
    if (!combo) {
      throw new InternalClearingEntityNotFoundError(entityId);
    }

    const legsResult = await this.deps.pool.query<ComboLegRow>(
      `SELECT id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side,
              size::text, remaining_size::text, price_hint::text, metadata
       FROM combo_legs
       WHERE combo_rfq_id = $1
       ORDER BY id ASC`,
      [entityId]
    );

    if (legsResult.rows.length === 0) {
      throw new InternalClearingAmbiguityError(`Clearing entity ${entityId} has no persisted combo legs.`);
    }

    return {
      ...combo,
      legs: legsResult.rows
    };
  }

  private async loadEntityRoundParticipants(entityId: string): Promise<ClearingRoundParticipantRow[]> {
    const result = await this.deps.pool.query<ClearingRoundParticipantRow>(
      `SELECT id, clearing_round_id, combo_or_order_id, participant_user_id, role,
              original_remaining, matched_remaining, created_at
       FROM clearing_round_participants
       WHERE combo_or_order_id = $1
       ORDER BY created_at DESC, id DESC`,
      [entityId]
    );
    return result.rows;
  }

  private async inspectRedisBucketStatus(entity: ClearingEntitySnapshot): Promise<ResidualRedisStatus> {
    const residualEntity = this.toResidualVectorEntity(entity);
    try {
      const vector = this.residualVectorBuilder.build(residualEntity);
      const bucketKey = `clearing:bucket:${vector.compatibilityBucket}`;
      const snapshotKey = `clearing:entity:${entity.id}`;
      const [bucketMembers, snapshot] = await Promise.all([
        this.deps.redis.zrange ? this.deps.redis.zrange(bucketKey, 0, -1) : Promise.resolve<string[]>([]),
        this.deps.redis.get(snapshotKey)
      ]);
      return {
        compatibility_bucket: vector.compatibilityBucket,
        expected_present: true,
        snapshot_present: snapshot !== null,
        bucket_present: bucketMembers.includes(entity.id)
      };
    } catch (error) {
      if (error instanceof Error && error.message === "no_residual_legs") {
        const snapshot = await this.deps.redis.get(`clearing:entity:${entity.id}`);
        return {
          compatibility_bucket: null,
          expected_present: false,
          snapshot_present: snapshot !== null,
          bucket_present: false
        };
      }
      if (error instanceof Error && (error.message === "missing_bucket_metadata" || error.message === "bucket_mismatch")) {
        throw new InternalClearingAmbiguityError(
          `Unable to derive residual bucket state for entity ${entity.id}: ${error.message}.`
        );
      }
      throw error;
    }
  }

  private pushEntityStateMismatch(
    discrepancies: InternalClearingReconcileReport["discrepancies"],
    participant: ClearingRoundParticipantRow,
    entity: ClearingEntitySnapshot
  ): void {
    const hasResidual = entity.legs.some((leg) => new Decimal(leg.remaining_size).greaterThan(0));
    const mismatch =
      (entity.state === "EXECUTED" && hasResidual) ||
      (entity.state === "PARTIALLY_EXECUTED" && !hasResidual);

    if (mismatch) {
      discrepancies.push({
        code: "ENTITY_STATE_RESIDUAL_MISMATCH",
        severity: "critical",
        message: "Entity state does not match authoritative residual leg state.",
        details: {
          participant_id: participant.id,
          entity_id: entity.id,
          state: entity.state,
          total_remaining_size: this.sumRemaining(entity.legs)
        }
      });
    }
  }

  private toResidualVectorEntity(entity: ClearingEntitySnapshot): ResidualVectorEntity {
    return {
      entityId: entity.id,
      userId: entity.user_id,
      legs: entity.legs.map<ResidualVectorLeg>((leg) => {
        const baseLeg: ResidualVectorLeg = {
          id: leg.id,
          canonicalMarketId: leg.canonical_market_id,
          canonicalOutcomeId: leg.canonical_outcome_id,
          side: leg.side,
          remainingSize: leg.remaining_size
        };

        if (leg.metadata) {
          return {
            ...baseLeg,
            metadata: leg.metadata
          };
        }

        return baseLeg;
      })
    };
  }

  private sumRemaining(legs: readonly ComboLegRow[]): string {
    return legs.reduce((sum, leg) => sum.plus(leg.remaining_size), new Decimal(0)).toString();
  }

  private readSignedRemaining(source: Record<string, unknown>, key: string): InstanceType<typeof Decimal> | null {
    const value = source[key];
    if (typeof value !== "string" && typeof value !== "number") {
      return null;
    }
    try {
      const decimal = new Decimal(value);
      return decimal.isFinite() ? decimal : null;
    } catch {
      return null;
    }
  }

  private absDecimal(value: string, field: string): InstanceType<typeof Decimal> {
    try {
      const decimal = new Decimal(value);
      if (!decimal.isFinite()) {
        throw new Error("non_finite");
      }
      return decimal.abs();
    } catch {
      throw new InternalClearingAmbiguityError(`Invalid ${field} value encountered while inspecting clearing rounds.`);
    }
  }

  private async insertAdminEvent(input: {
    entityType: "ROUND" | "ENTITY";
    entityId: string;
    action: string;
    requestedBy: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const eventId = randomUUID();
    await this.deps.pool.query(
      `INSERT INTO internal_clearing_admin_events
        (id, entity_type, entity_id, action, requested_by, correlation_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        eventId,
        input.entityType,
        input.entityId,
        input.action,
        input.requestedBy,
        input.correlationId,
        JSON.stringify(input.payload)
      ]
    );
    return eventId;
  }
}
