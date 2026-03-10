import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Logger } from "pino";
import type { Pool } from "pg";

import type { RedisClient } from "../../db/redis.js";

interface ComboNettingGroupRow {
  id: string;
  incoming_combo_id: string;
  matched_combo_id: string;
  state: string;
  matched_size: string;
  created_at: Date;
}

interface ComboNettingMatchLegRow {
  id: string;
  netting_group_id: string;
  incoming_leg_id: string;
  matched_leg_id: string;
  market_id: string;
  outcome_id: string;
  matched_size: string;
  price: string;
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

interface ComboNettingAttemptRow {
  attempt_id: string;
  incoming_combo_id: string;
  matched_combo_id: string;
  netting_group_id: string | null;
  status: string;
  created_at: Date;
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

interface ResidualLegRedisPresence {
  leg_id: string;
  market_id: string;
  outcome_id: string;
  side: "buy" | "sell";
  present: boolean;
}

export interface InternalNettingGroupInspection {
  group: ComboNettingGroupRow;
  matched_legs: ComboNettingMatchLegRow[];
  exposure_journal_references: ExposureJournalRow[];
  combo_states: {
    incoming_combo: ComboRFQRow;
    matched_combo: ComboRFQRow;
  };
  residual_state: {
    incoming_combo: {
      total_remaining_size: string;
      legs: ComboLegRow[];
      redis_candidate_presence: ResidualLegRedisPresence[];
    };
    matched_combo: {
      total_remaining_size: string;
      legs: ComboLegRow[];
      redis_candidate_presence: ResidualLegRedisPresence[];
    };
  };
}

export interface InternalNettingComboInspection {
  combo: ComboRFQRow & {
    legs: ComboLegRow[];
  };
  linked_groups: ComboNettingGroupRow[];
  netting_status: {
    total_groups: number;
    incoming_group_count: number;
    matched_group_count: number;
    total_remaining_size: string;
    redis_candidate_presence: ResidualLegRedisPresence[];
  };
}

export interface InternalNettingReconcileInput {
  groupId: string;
  requestedBy: string;
  dryRun: boolean;
  force: boolean;
  correlationId?: string;
}

export interface InternalNettingForceFailInput {
  groupId: string;
  requestedBy: string;
  reason: string;
  correlationId?: string;
}

export interface InternalNettingReconcileReport {
  group_id: string;
  dry_run: boolean;
  force: boolean;
  discrepancies: Array<{
    code: string;
    severity: "warning" | "critical";
    message: string;
    details?: Record<string, unknown>;
  }>;
  admin_event_id: string;
}

export class InternalNettingGroupNotFoundError extends Error {
  public constructor(groupId: string) {
    super(`Internal netting group ${groupId} not found.`);
    this.name = "InternalNettingGroupNotFoundError";
  }
}

export class InternalNettingComboNotFoundError extends Error {
  public constructor(comboId: string) {
    super(`Internal netting combo ${comboId} not found.`);
    this.name = "InternalNettingComboNotFoundError";
  }
}

export class InternalNettingAmbiguityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InternalNettingAmbiguityError";
  }
}

export interface InternalNettingAdminServiceDeps {
  pool: Pool;
  redis: RedisClient;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export class InternalNettingAdminService {
  public constructor(private readonly deps: InternalNettingAdminServiceDeps) {}

  public async getGroupInspection(groupId: string): Promise<InternalNettingGroupInspection> {
    const group = await this.loadGroup(groupId);
    const [matchedLegs, incomingCombo, matchedCombo, attempts, journals] = await Promise.all([
      this.loadMatchedLegs(groupId),
      this.loadCombo(group.incoming_combo_id),
      this.loadCombo(group.matched_combo_id),
      this.loadAttempts(groupId),
      this.loadExposureJournalByGroup(groupId)
    ]);

    if (matchedLegs.length === 0) {
      throw new InternalNettingAmbiguityError(`Netting group ${groupId} has no matched legs.`);
    }
    if (attempts.length === 0) {
      throw new InternalNettingAmbiguityError(`Netting group ${groupId} is missing linked attempt rows.`);
    }

    const [incomingRedis, matchedRedis] = await Promise.all([
      this.loadResidualRedisPresence(incomingCombo.legs, incomingCombo.id),
      this.loadResidualRedisPresence(matchedCombo.legs, matchedCombo.id)
    ]);

    return {
      group,
      matched_legs: matchedLegs,
      exposure_journal_references: journals,
      combo_states: {
        incoming_combo: this.toComboSnapshot(incomingCombo),
        matched_combo: this.toComboSnapshot(matchedCombo)
      },
      residual_state: {
        incoming_combo: {
          total_remaining_size: this.sumRemaining(incomingCombo.legs),
          legs: incomingCombo.legs,
          redis_candidate_presence: incomingRedis
        },
        matched_combo: {
          total_remaining_size: this.sumRemaining(matchedCombo.legs),
          legs: matchedCombo.legs,
          redis_candidate_presence: matchedRedis
        }
      }
    };
  }

  public async getComboInspection(comboId: string): Promise<InternalNettingComboInspection> {
    const combo = await this.loadCombo(comboId);
    const linkedGroups = await this.loadLinkedGroups(comboId);
    const redisCandidatePresence = await this.loadResidualRedisPresence(combo.legs, comboId);

    return {
      combo,
      linked_groups: linkedGroups,
      netting_status: {
        total_groups: linkedGroups.length,
        incoming_group_count: linkedGroups.filter((group) => group.incoming_combo_id === comboId).length,
        matched_group_count: linkedGroups.filter((group) => group.matched_combo_id === comboId).length,
        total_remaining_size: this.sumRemaining(combo.legs),
        redis_candidate_presence: redisCandidatePresence
      }
    };
  }

  public async reconcileGroup(input: InternalNettingReconcileInput): Promise<InternalNettingReconcileReport> {
    const group = await this.loadGroup(input.groupId);
    const [matchedLegs, incomingCombo, matchedCombo, attempts, journals] = await Promise.all([
      this.loadMatchedLegs(group.id),
      this.loadCombo(group.incoming_combo_id),
      this.loadCombo(group.matched_combo_id),
      this.loadAttempts(group.id),
      this.loadExposureJournalByGroup(group.id)
    ]);

    const discrepancies: InternalNettingReconcileReport["discrepancies"] = [];

    if (attempts.length === 0) {
      discrepancies.push({
        code: "ATTEMPT_LINK_MISSING",
        severity: "critical",
        message: "No combo_netting_attempts rows reference this group."
      });
    }

    if (journals.length < 2) {
      discrepancies.push({
        code: "EXPOSURE_JOURNAL_INCOMPLETE",
        severity: "critical",
        message: "Expected at least two exposure journal rows for the netting group.",
        details: { journal_count: journals.length }
      });
    }

    for (const match of matchedLegs) {
      const incomingLeg = incomingCombo.legs.find((leg) => leg.id === match.incoming_leg_id);
      const matchedLeg = matchedCombo.legs.find((leg) => leg.id === match.matched_leg_id);

      if (!incomingLeg || !matchedLeg) {
        discrepancies.push({
          code: "MATCH_LEG_REFERENCE_MISSING",
          severity: "critical",
          message: "A matched leg references a combo leg that no longer exists.",
          details: {
            match_leg_id: match.id,
            incoming_leg_id: match.incoming_leg_id,
            matched_leg_id: match.matched_leg_id
          }
        });
        continue;
      }

      if (
        incomingLeg.canonical_market_id !== match.market_id ||
        matchedLeg.canonical_market_id !== match.market_id ||
        incomingLeg.canonical_outcome_id !== match.outcome_id ||
        matchedLeg.canonical_outcome_id !== match.outcome_id
      ) {
        discrepancies.push({
          code: "MATCH_LEG_REFERENCE_MISSING",
          severity: "critical",
          message: "Matched leg market/outcome no longer aligns with linked combo legs.",
          details: { match_leg_id: match.id }
        });
      }

      if (
        new Decimal(match.matched_size).greaterThan(incomingLeg.size) ||
        new Decimal(match.matched_size).greaterThan(matchedLeg.size)
      ) {
        discrepancies.push({
          code: "MATCH_SIZE_EXCEEDS_LEG_SIZE",
          severity: "critical",
          message: "Matched size exceeds source combo leg size.",
          details: {
            match_leg_id: match.id,
            matched_size: match.matched_size,
            incoming_leg_size: incomingLeg.size,
            matched_leg_size: matchedLeg.size
          }
        });
      }
    }

    this.pushComboResidualMismatch(discrepancies, "incoming_combo", incomingCombo.state, incomingCombo.legs);
    this.pushComboResidualMismatch(discrepancies, "matched_combo", matchedCombo.state, matchedCombo.legs);

    const [incomingRedis, matchedRedis] = await Promise.all([
      this.loadResidualRedisPresence(incomingCombo.legs, incomingCombo.id),
      this.loadResidualRedisPresence(matchedCombo.legs, matchedCombo.id)
    ]);

    this.pushRedisResidualMismatch(discrepancies, "incoming_combo", incomingCombo.legs, incomingRedis);
    this.pushRedisResidualMismatch(discrepancies, "matched_combo", matchedCombo.legs, matchedRedis);

    const correlationId = input.correlationId ?? randomUUID();
    const adminEventId = await this.insertAdminEvent({
      entityType: "GROUP",
      entityId: group.id,
      action: "RECONCILE",
      requestedBy: input.requestedBy,
      correlationId,
      payload: {
        dry_run: input.dryRun,
        force: input.force,
        discrepancy_count: discrepancies.length
      }
    });

    return {
      group_id: group.id,
      dry_run: input.dryRun,
      force: input.force,
      discrepancies,
      admin_event_id: adminEventId
    };
  }

  public async createForceFailTask(input: InternalNettingForceFailInput): Promise<{
    task_id: string;
    group_id: string;
    correlation_id: string;
    status: string;
    admin_event_id: string;
  }> {
    const group = await this.loadGroup(input.groupId);
    const correlationId = input.correlationId ?? randomUUID();
    const taskId = randomUUID();

    await this.deps.pool.query(
      `INSERT INTO internal_netting_unwind_tasks
        (id, netting_group_id, requested_by, reason, correlation_id, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [taskId, group.id, input.requestedBy, input.reason, correlationId, "PENDING", JSON.stringify({ phase: "PHASE_2A" })]
    );

    const adminEventId = await this.insertAdminEvent({
      entityType: "GROUP",
      entityId: group.id,
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
        groupId: group.id,
        taskId,
        correlationId,
        requestedBy: input.requestedBy
      },
      "Admin created internal netting force-fail task."
    );

    return {
      task_id: taskId,
      group_id: group.id,
      correlation_id: correlationId,
      status: "PENDING",
      admin_event_id: adminEventId
    };
  }

  private async loadGroup(groupId: string): Promise<ComboNettingGroupRow> {
    const result = await this.deps.pool.query<ComboNettingGroupRow>(
      `SELECT id, incoming_combo_id, matched_combo_id, state, matched_size::text, created_at
       FROM combo_netting_groups
       WHERE id = $1
       LIMIT 1`,
      [groupId]
    );
    const group = result.rows[0];
    if (!group) {
      throw new InternalNettingGroupNotFoundError(groupId);
    }
    return group;
  }

  private async loadMatchedLegs(groupId: string): Promise<ComboNettingMatchLegRow[]> {
    const result = await this.deps.pool.query<ComboNettingMatchLegRow>(
      `SELECT id, netting_group_id, incoming_leg_id, matched_leg_id, market_id, outcome_id,
              matched_size::text, price::text, created_at
       FROM combo_netting_match_legs
       WHERE netting_group_id = $1
       ORDER BY created_at ASC, id ASC`,
      [groupId]
    );
    return result.rows;
  }

  private async loadCombo(comboId: string): Promise<InternalNettingComboInspection["combo"]> {
    const comboResult = await this.deps.pool.query<ComboRFQRow>(
      `SELECT id, user_id, acceptance_policy, state, expires_at, metadata, created_at
       FROM combo_rfqs
       WHERE id = $1
       LIMIT 1`,
      [comboId]
    );
    const combo = comboResult.rows[0];
    if (!combo) {
      throw new InternalNettingComboNotFoundError(comboId);
    }

    const legsResult = await this.deps.pool.query<ComboLegRow>(
      `SELECT id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side,
              size::text, remaining_size::text, price_hint::text, metadata
       FROM combo_legs
       WHERE combo_rfq_id = $1
       ORDER BY id ASC`,
      [comboId]
    );

    if (legsResult.rows.length === 0) {
      throw new InternalNettingAmbiguityError(`Combo ${comboId} has no persisted combo legs.`);
    }

    return {
      ...combo,
      legs: legsResult.rows
    };
  }

  private async loadLinkedGroups(comboId: string): Promise<ComboNettingGroupRow[]> {
    const result = await this.deps.pool.query<ComboNettingGroupRow>(
      `SELECT id, incoming_combo_id, matched_combo_id, state, matched_size::text, created_at
       FROM combo_netting_groups
       WHERE incoming_combo_id = $1 OR matched_combo_id = $1
       ORDER BY created_at DESC, id DESC`,
      [comboId]
    );
    return result.rows;
  }

  private async loadAttempts(groupId: string): Promise<ComboNettingAttemptRow[]> {
    const result = await this.deps.pool.query<ComboNettingAttemptRow>(
      `SELECT attempt_id, incoming_combo_id, matched_combo_id, netting_group_id, status, created_at
       FROM combo_netting_attempts
       WHERE netting_group_id = $1
       ORDER BY created_at ASC, attempt_id ASC`,
      [groupId]
    );
    return result.rows;
  }

  private async loadExposureJournalByGroup(groupId: string): Promise<ExposureJournalRow[]> {
    const result = await this.deps.pool.query<ExposureJournalRow>(
      `SELECT id, exposure_id::text, change::text, prev_gross::text, prev_net::text,
              new_gross::text, new_net::text, source, reference_id::text, created_at, payload
       FROM exposure_journal
       WHERE reference_id::text = $1
       ORDER BY created_at ASC, id ASC`,
      [groupId]
    );
    return result.rows;
  }

  private async loadResidualRedisPresence(
    legs: readonly ComboLegRow[],
    comboId: string
  ): Promise<ResidualLegRedisPresence[]> {
    if (!this.deps.redis.smembers) {
      throw new InternalNettingAmbiguityError("Redis client does not support combo candidate registry inspection.");
    }

    const residualLegs = legs.filter((leg) => new Decimal(leg.remaining_size).greaterThan(0));
    return Promise.all(
      residualLegs.map(async (leg) => {
        const members = await this.deps.redis.smembers!(
          `combo_net:leg:${leg.canonical_market_id}:${leg.canonical_outcome_id}:${leg.side}`
        );
        return {
          leg_id: leg.id,
          market_id: leg.canonical_market_id,
          outcome_id: leg.canonical_outcome_id,
          side: leg.side,
          present: members.includes(comboId)
        };
      })
    );
  }

  private pushComboResidualMismatch(
    discrepancies: InternalNettingReconcileReport["discrepancies"],
    comboLabel: "incoming_combo" | "matched_combo",
    comboState: string,
    legs: readonly ComboLegRow[]
  ): void {
    const hasResidual = legs.some((leg) => new Decimal(leg.remaining_size).greaterThan(0));
    const terminalMismatch =
      (comboState === "EXECUTED" && hasResidual) ||
      (comboState === "PARTIALLY_EXECUTED" && !hasResidual);

    if (terminalMismatch) {
      discrepancies.push({
        code: "COMBO_STATE_RESIDUAL_MISMATCH",
        severity: "critical",
        message: "Combo state does not match leg residual state.",
        details: {
          combo: comboLabel,
          state: comboState,
          total_remaining_size: this.sumRemaining(legs)
        }
      });
    }
  }

  private pushRedisResidualMismatch(
    discrepancies: InternalNettingReconcileReport["discrepancies"],
    comboLabel: "incoming_combo" | "matched_combo",
    legs: readonly ComboLegRow[],
    presence: readonly ResidualLegRedisPresence[]
  ): void {
    const byLegId = new Map(presence.map((entry) => [entry.leg_id, entry]));
    for (const leg of legs.filter((candidate) => new Decimal(candidate.remaining_size).greaterThan(0))) {
      const redisPresence = byLegId.get(leg.id);
      if (!redisPresence || !redisPresence.present) {
        discrepancies.push({
          code: "REDIS_RESIDUAL_MISMATCH",
          severity: "warning",
          message: "Residual combo leg is missing from the Redis candidate registry.",
          details: {
            combo: comboLabel,
            leg_id: leg.id,
            market_id: leg.canonical_market_id,
            outcome_id: leg.canonical_outcome_id,
            side: leg.side
          }
        });
      }
    }
  }

  private sumRemaining(legs: readonly ComboLegRow[]): string {
    return legs.reduce((sum, leg) => sum.plus(leg.remaining_size), new Decimal(0)).toString();
  }

  private toComboSnapshot(combo: ComboRFQRow & { legs: ComboLegRow[] }): ComboRFQRow {
    return {
      id: combo.id,
      user_id: combo.user_id,
      acceptance_policy: combo.acceptance_policy,
      state: combo.state,
      expires_at: combo.expires_at,
      metadata: combo.metadata,
      created_at: combo.created_at
    };
  }

  private async insertAdminEvent(input: {
    entityType: "GROUP" | "COMBO";
    entityId: string;
    action: string;
    requestedBy: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const eventId = randomUUID();
    await this.deps.pool.query(
      `INSERT INTO internal_netting_admin_events
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
