import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";

import type { IResidualVectorBuilder } from "./residual-vector-builder.js";
import type { IPhase2BCandidateRegistry } from "./phase2b-candidate-registry.js";
import type { IOverlapGraphBuilder } from "./overlap-graph-builder.js";
import type { ICandidateGroupEnumerator } from "./candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "./clearing-compression-scorer.js";
import type { IMultiPartyExposureAggregator } from "./multi-party-exposure-aggregator.js";
import type { ResourceLocker } from "./resource-locker.js";
import type {
  CandidateGroup,
  CandidateGroupEnumeratorConfig,
  ClearingMatchSignature,
  ClearingRoundExecutionResult,
  ClearingRoundPlan,
  MultiPartyExposureAggregationLeg,
  ResidualVectorEntity,
  ScorableResidualVector
} from "./types.js";
import { withSpan } from "../../observability/tracing.js";

type DecimalValue = InstanceType<typeof Decimal>;

interface AuthoritativeComboLegRow {
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

interface AuthoritativeComboRow {
  id: string;
  user_id: string;
  state: string;
  created_at: Date;
  legs: AuthoritativeComboLegRow[];
}

interface ParticipantState {
  combo: AuthoritativeComboRow;
  vector: ScorableResidualVector;
}

interface ParticipantAllocation {
  entityId: string;
  userId: string;
  createdAt: Date;
  originalVector: Record<string, string>;
  matchedVector: Record<string, string>;
  residualVector: Record<string, string>;
  combo: AuthoritativeComboRow;
}

interface LegUpdate {
  legId: string;
  entityId: string;
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  clearedSize: string;
  priceHint: string;
}

interface GroupedExposureBucket {
  userId: string;
  marketId: string;
  side: "buy" | "sell";
  perLeg: Array<{
    entityId: string;
    legId: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    price: string;
    size: string;
    maxLossDelta: string;
    maxGainDelta: string;
  }>;
}

interface AggregatedExposureLeg {
  participantId: string;
  userId: string;
  legId: string;
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  price: string;
  matchedSize: string;
  maxLossDelta: string;
  maxGainDelta: string;
}

const DEFAULT_ENUMERATOR_CONFIG: CandidateGroupEnumeratorConfig = {
  maxParticipants: 4,
  maxUniqueLegs: 6,
  stpMode: "CANCEL_NEWEST"
};

export interface IMultiPartyClearingExecutor {
  execute(roundPlan: ClearingRoundPlan): Promise<ClearingRoundExecutionResult>;
}

export class MultiPartyClearingExecutor implements IMultiPartyClearingExecutor {
  public constructor(
    private readonly pool: Pool,
    private readonly residualVectorBuilder: IResidualVectorBuilder,
    private readonly candidateRegistry: IPhase2BCandidateRegistry,
    private readonly overlapGraphBuilder: IOverlapGraphBuilder,
    private readonly candidateGroupEnumerator: ICandidateGroupEnumerator,
    private readonly clearingCompressionScorer: IClearingCompressionScorer,
    private readonly multiPartyExposureAggregator: IMultiPartyExposureAggregator,
    private readonly resourceLocker: ResourceLocker,
    private readonly logger: Logger
  ) {}

  public async execute(roundPlan: ClearingRoundPlan): Promise<ClearingRoundExecutionResult> {
    this.validateRoundPlan(roundPlan);
    const expectedSignatures = this.buildMatchSignatures(
      roundPlan.compatibilityBucket,
      roundPlan.selectedGroup,
      roundPlan.score
    );

    const participantLockOrder = [...roundPlan.participantLockOrder].sort((left, right) => left.localeCompare(right));

    return withSpan(
      "combo.multi_party_clearing.execute",
      {
        compatibility_bucket: roundPlan.compatibilityBucket,
        participant_count: participantLockOrder.length,
        unique_leg_count: roundPlan.selectedGroup.uniqueLegs.length
      },
      async () => {
        const lockHandle = await this.resourceLocker.acquireLocks(
          participantLockOrder.map((participantId) => this.resourceLocker.comboLockId(participantId))
        );

        try {
          try {
            const participants = await this.loadParticipants(participantLockOrder);
            const validatedPlan = this.revalidateRoundPlan(roundPlan, participants);
            const signatures = this.buildMatchSignatures(
              validatedPlan.compatibilityBucket,
              validatedPlan.selectedGroup,
              validatedPlan.score
            );
            const allocations = this.allocateParticipantResiduals(
              validatedPlan.selectedGroup,
              participants,
              validatedPlan.residuals
            );
            const result = await this.executeTransaction(
              validatedPlan.compatibilityBucket,
              participantLockOrder,
              allocations,
              validatedPlan,
              signatures
            );

            await this.refreshRegistryFromAuthoritativeState(participantLockOrder, validatedPlan.compatibilityBucket);
            return result;
          } catch (error) {
            const replayResult = await this.tryResolveReplayFromExistingRound(
              roundPlan,
              participantLockOrder,
              expectedSignatures
            );
            if (replayResult !== null) {
              return replayResult;
            }
            throw error;
          }
        } finally {
          await this.resourceLocker.releaseLocks(lockHandle);
        }
      }
    );
  }

  private async tryResolveReplayFromExistingRound(
    roundPlan: ClearingRoundPlan,
    participantLockOrder: readonly string[],
    signatures: ClearingMatchSignature
  ): Promise<ClearingRoundExecutionResult | null> {
    try {
      const existingRoundId = await this.loadExistingRoundId(
        signatures.participantSetHash,
        signatures.matchSignatureHash
      );

      return {
        replayed: true,
        applied: false,
        clearingRoundId: existingRoundId,
        compatibilityBucket: roundPlan.compatibilityBucket,
        residuals: roundPlan.residuals,
        participantLockOrder,
        updatedParticipantIds: [],
        participants: [],
        eventCount: 0,
        ...signatures
      };
    } catch {
      return null;
    }
  }

  private validateRoundPlan(roundPlan: ClearingRoundPlan): void {
    if (roundPlan.compatibilityBucket.trim().length === 0) {
      throw new Error("compatibility_bucket_required");
    }

    const participantIds = roundPlan.selectedGroup.participantIds;
    if (participantIds.length < 2) {
      throw new Error("invalid_round_plan_participants");
    }

    const uniqueParticipantIds = new Set(participantIds);
    if (uniqueParticipantIds.size !== participantIds.length) {
      throw new Error("duplicate_round_plan_participants");
    }

    const expectedLockOrder = [...participantIds].sort((left, right) => left.localeCompare(right));
    if (!this.sameStringArray(expectedLockOrder, roundPlan.participantLockOrder)) {
      throw new Error("participant_lock_order_mismatch");
    }
  }

  private async loadParticipants(participantIds: readonly string[]): Promise<ParticipantState[]> {
    const client = await this.pool.connect();

    try {
      return await this.loadParticipantsWithClient(client, participantIds);
    } finally {
      client.release();
    }
  }

  private async loadParticipantsWithClient(
    client: PoolClient,
    participantIds: readonly string[],
    options: { forUpdate?: boolean } = {}
  ): Promise<ParticipantState[]> {
    return await Promise.all(participantIds.map(async (participantId) => {
      const combo = await this.loadCombo(client, participantId, options);
      if (combo === null) {
        throw new Error(`missing_clearing_participant:${participantId}`);
      }

      if (!this.isClearableState(combo.state)) {
        throw new Error(`invalid_clearing_participant_state:${participantId}:${combo.state}`);
      }

      const vector = this.residualVectorBuilder.build(this.toResidualVectorEntity(combo));
      if (vector.legCount <= 0) {
        throw new Error(`no_residual_legs:${participantId}`);
      }

      return {
        combo,
        vector: {
          ...vector,
          createdAt: combo.created_at
        }
      };
    }));
  }

  private async loadCombo(
    client: PoolClient,
    comboId: string,
    options: { forUpdate?: boolean } = {}
  ): Promise<AuthoritativeComboRow | null> {
    const comboResult = await client.query<{
      id: string;
      user_id: string;
      state: string;
      created_at: Date;
    }>(
      `SELECT id, user_id, state, created_at
         FROM combo_rfqs
        WHERE id = $1
        LIMIT 1
        ${options.forUpdate ? "FOR UPDATE" : ""}`,
      [comboId]
    );

    const combo = comboResult.rows[0];
    if (!combo) {
      return null;
    }

    const legResult = await client.query<AuthoritativeComboLegRow>(
      `SELECT id,
              combo_rfq_id,
              canonical_market_id::text,
              canonical_outcome_id::text,
              side,
              size::text,
              remaining_size::text,
              price_hint::text,
              metadata
         FROM combo_legs
        WHERE combo_rfq_id = $1
        ORDER BY id ASC
        ${options.forUpdate ? "FOR UPDATE" : ""}`,
      [comboId]
    );

    return {
      id: combo.id,
      user_id: combo.user_id,
      state: combo.state,
      created_at: combo.created_at,
      legs: legResult.rows
    };
  }

  private toResidualVectorEntity(combo: AuthoritativeComboRow): ResidualVectorEntity {
    return {
      entityId: combo.id,
      userId: combo.user_id,
      legs: combo.legs.map((leg) => ({
        id: leg.id,
        canonicalMarketId: leg.canonical_market_id,
        canonicalOutcomeId: leg.canonical_outcome_id,
        side: leg.side,
        remainingSize: leg.remaining_size,
        ...(leg.metadata ? { metadata: leg.metadata } : {})
      }))
    };
  }

  private revalidateRoundPlan(
    roundPlan: ClearingRoundPlan,
    participants: readonly ParticipantState[]
  ): {
    compatibilityBucket: string;
    selectedGroup: CandidateGroup;
    score: ReturnType<IClearingCompressionScorer["score"]>;
    residuals: readonly { key: string; signedResidual: string }[];
  } {
    const buckets = new Set(participants.map((participant) => participant.vector.compatibilityBucket));
    if (buckets.size !== 1 || !buckets.has(roundPlan.compatibilityBucket)) {
      throw new Error("compatibility_bucket_mismatch");
    }

    const graph = this.overlapGraphBuilder.build(participants.map((participant) => participant.vector));
    const groups = this.candidateGroupEnumerator.enumerate(graph, DEFAULT_ENUMERATOR_CONFIG);
    if (groups.length === 0) {
      throw new Error("round_plan_invalidated");
    }

    const scored = groups.map((group) => ({
      group,
      score: this.clearingCompressionScorer.score(
        group,
        participants
          .filter((participant) => group.participantIds.includes(participant.combo.id))
          .map((participant) => participant.vector)
      )
    }));

    scored.sort((left, right) =>
      this.compareScores(left.score, right.score, left.group.participantIds, right.group.participantIds)
    );

    const selected = scored[0];
    if (!selected) {
      throw new Error("round_plan_invalidated");
    }

    if (!this.sameStringArray(selected.group.participantIds, roundPlan.selectedGroup.participantIds)) {
      throw new Error("round_plan_invalidated");
    }
    if (!this.sameStringArray(selected.group.uniqueLegs, roundPlan.selectedGroup.uniqueLegs)) {
      throw new Error("round_plan_invalidated");
    }
    if (!this.sameResiduals(selected.group.residualAfterNetting, roundPlan.residuals)) {
      throw new Error("round_plan_invalidated");
    }

    return {
      compatibilityBucket: roundPlan.compatibilityBucket,
      selectedGroup: selected.group,
      score: selected.score,
      residuals: selected.group.residualAfterNetting
    };
  }

  private allocateParticipantResiduals(
    group: CandidateGroup,
    participants: readonly ParticipantState[],
    groupResiduals: readonly { key: string; signedResidual: string }[]
  ): ParticipantAllocation[] {
    const residualByKey = new Map(groupResiduals.map((residual) => [residual.key, new Decimal(residual.signedResidual)]));
    const byId = new Map(participants.map((participant) => [participant.combo.id, participant] as const));
    const allocations = new Map<string, ParticipantAllocation>();

    for (const participantId of group.participantIds) {
      const participant = byId.get(participantId);
      if (!participant) {
        throw new Error("participant_vector_mismatch");
      }

      allocations.set(participantId, {
        entityId: participantId,
        userId: participant.combo.user_id,
        createdAt: participant.combo.created_at,
        originalVector: { ...participant.vector.vector },
        matchedVector: {},
        residualVector: {},
        combo: participant.combo
      });
    }

    for (const key of [...new Set(group.uniqueLegs)].sort((left, right) => left.localeCompare(right))) {
      const contributors = group.participantIds
        .map((participantId) => allocations.get(participantId))
        .filter((participant): participant is ParticipantAllocation => participant !== undefined)
        .map((participant) => ({
          participant,
          original: new Decimal(participant.originalVector[key] ?? "0")
        }))
        .filter(({ original }) => !original.isZero())
        .sort((left, right) => {
          const createdAtDiff = left.participant.createdAt.getTime() - right.participant.createdAt.getTime();
          if (createdAtDiff !== 0) {
            return createdAtDiff;
          }

          return left.participant.entityId.localeCompare(right.participant.entityId);
        });

      const groupResidual = residualByKey.get(key) ?? new Decimal(0);
      if (!contributors.length) {
        if (!groupResidual.isZero()) {
          throw new Error("invalid_clearing_residual_signature");
        }
        continue;
      }

      if (groupResidual.isZero()) {
        for (const { participant, original } of contributors) {
          participant.matchedVector[key] = original.toString();
        }
        continue;
      }

      const residualSign = groupResidual.gt(0) ? 1 : -1;
      let residualToAssign = groupResidual.abs();

      for (const { participant, original } of contributors) {
        const originalSign = original.gt(0) ? 1 : -1;
        if (originalSign !== residualSign) {
          participant.matchedVector[key] = original.toString();
          continue;
        }

        const keepAmount = Decimal.min(original.abs(), residualToAssign);
        if (!keepAmount.isZero()) {
          participant.residualVector[key] = (originalSign > 0 ? keepAmount : keepAmount.negated()).toString();
        }

        const matchedAmount = original.abs().minus(keepAmount);
        if (!matchedAmount.isZero()) {
          participant.matchedVector[key] = (originalSign > 0 ? matchedAmount : matchedAmount.negated()).toString();
        }

        residualToAssign = residualToAssign.minus(keepAmount);
      }

      if (!residualToAssign.isZero()) {
        throw new Error("invalid_clearing_residual_signature");
      }
    }

    return [...allocations.values()];
  }

  private buildMatchSignatures(
    compatibilityBucket: string,
    selectedGroup: CandidateGroup,
    score: ReturnType<IClearingCompressionScorer["score"]>
  ): ClearingMatchSignature {
    const participantSetHash = createHash("sha256")
      .update([...selectedGroup.participantIds].sort((left, right) => left.localeCompare(right)).join("|"))
      .digest("hex");

    const matchSignatureHash = createHash("sha256")
      .update(
        JSON.stringify({
          compatibilityBucket,
          participantIds: [...selectedGroup.participantIds].sort((left, right) => left.localeCompare(right)),
          uniqueLegs: [...selectedGroup.uniqueLegs].sort((left, right) => left.localeCompare(right)),
          residuals: [...selectedGroup.residualAfterNetting].sort((left, right) => left.key.localeCompare(right.key)),
          finalScore: score.finalScore,
          postNetAbsResidual: score.postNetAbsResidual
        })
      )
      .digest("hex");

    return {
      participantSetHash,
      matchSignatureHash
    };
  }

  private async executeTransaction(
    compatibilityBucket: string,
    participantLockOrder: readonly string[],
    allocations: readonly ParticipantAllocation[],
    validatedPlan: {
      selectedGroup: CandidateGroup;
      score: ReturnType<IClearingCompressionScorer["score"]>;
      residuals: readonly { key: string; signedResidual: string }[];
    },
    signatures: ClearingMatchSignature
  ): Promise<ClearingRoundExecutionResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const lockedParticipants = await this.loadParticipantsWithClient(client, participantLockOrder, { forUpdate: true });
      const lockedValidatedPlan = this.revalidateRoundPlan(
        {
          compatibilityBucket,
          selectedGroup: validatedPlan.selectedGroup,
          score: validatedPlan.score,
          residuals: validatedPlan.residuals,
          participantLockOrder
        },
        lockedParticipants
      );
      const lockedAllocations = this.allocateParticipantResiduals(
        lockedValidatedPlan.selectedGroup,
        lockedParticipants,
        lockedValidatedPlan.residuals
      );
      const lockedSignatures = this.buildMatchSignatures(
        compatibilityBucket,
        lockedValidatedPlan.selectedGroup,
        lockedValidatedPlan.score
      );

      if (
        lockedSignatures.participantSetHash !== signatures.participantSetHash ||
        lockedSignatures.matchSignatureHash !== signatures.matchSignatureHash
      ) {
        throw new Error("round_plan_invalidated");
      }

      const roundResult = await client.query<{ id: string }>(
        `INSERT INTO clearing_rounds
          (compatibility_bucket, state, participant_count, unique_leg_count, compression_score, participant_set_hash, match_signature_hash)
         VALUES ($1, 'MATCHED', $2, $3, $4, $5, $6)
         ON CONFLICT (participant_set_hash, match_signature_hash) DO NOTHING
         RETURNING id`,
        [
          compatibilityBucket,
          lockedValidatedPlan.selectedGroup.participantIds.length,
          lockedValidatedPlan.selectedGroup.uniqueLegs.length,
          lockedValidatedPlan.score.finalScore,
          signatures.participantSetHash,
          signatures.matchSignatureHash
        ]
      );

      const clearingRoundId = roundResult.rows[0]?.id;
      if (!clearingRoundId) {
        await client.query("ROLLBACK");
        const existingRoundId = await this.loadExistingRoundId(signatures.participantSetHash, signatures.matchSignatureHash);
        return {
          replayed: true,
          applied: false,
          clearingRoundId: existingRoundId,
          compatibilityBucket,
          residuals: lockedValidatedPlan.residuals,
          participantLockOrder,
          updatedParticipantIds: [],
          participants: [],
          eventCount: 0,
          ...signatures
        };
      }

      const exposureIdempotencyRegistered = await this.registerExposureIdempotency(client, signatures.matchSignatureHash);
      if (!exposureIdempotencyRegistered) {
        await client.query("ROLLBACK");
        const existingRoundId = await this.loadExistingRoundId(signatures.participantSetHash, signatures.matchSignatureHash)
          .catch(() => clearingRoundId);
        return {
          replayed: true,
          applied: false,
          clearingRoundId: existingRoundId,
          compatibilityBucket,
          residuals: validatedPlan.residuals,
          participantLockOrder,
          updatedParticipantIds: [],
          participants: [],
          eventCount: 0,
          ...signatures
        };
      }

      const participantRows = await this.insertRoundParticipants(client, clearingRoundId, lockedAllocations);
      const legUpdates = await this.insertRoundLegMatchesAndUpdateLegs(client, clearingRoundId, participantRows, lockedAllocations);
      await this.updateComboStates(client, lockedAllocations);
      await this.applyExposureMutations(client, clearingRoundId, legUpdates, signatures, lockedAllocations);
      await this.insertClearingEvent(client, clearingRoundId, signatures, lockedValidatedPlan, lockedAllocations);

      await client.query("COMMIT");

      return {
        replayed: false,
        applied: true,
        clearingRoundId,
        compatibilityBucket,
        residuals: lockedValidatedPlan.residuals,
        participantLockOrder,
        updatedParticipantIds: participantLockOrder,
        participants: lockedAllocations.map((allocation) => ({
          entityId: allocation.entityId,
          userId: allocation.userId,
          state: this.deriveResidualStateFromVector(allocation.residualVector),
          originalRemaining: { ...allocation.originalVector },
          matchedRemaining: { ...allocation.matchedVector },
          residualRemaining: { ...allocation.residualVector }
        })),
        eventCount: 1,
        ...signatures
      };
    } catch (error) {
      await this.safeRollback(client);
      this.logger.error({ err: error }, "Multi-party clearing transaction failed.");
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadExistingRoundId(participantSetHash: string, matchSignatureHash: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM clearing_rounds
        WHERE participant_set_hash = $1
          AND match_signature_hash = $2
        LIMIT 1`,
      [participantSetHash, matchSignatureHash]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("existing_clearing_round_not_found");
    }

    return row.id;
  }

  private async registerExposureIdempotency(client: PoolClient, matchSignatureHash: string): Promise<boolean> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO exposure_idempotency (id)
       VALUES ($1)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [this.hashToUuid(matchSignatureHash)]
    );

    return result.rows.length === 1;
  }

  private async insertRoundParticipants(
    client: PoolClient,
    clearingRoundId: string,
    allocations: readonly ParticipantAllocation[]
  ): Promise<Map<string, string>> {
    const participantRows = new Map<string, string>();

    for (const allocation of allocations) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO clearing_round_participants
          (clearing_round_id, combo_or_order_id, participant_user_id, role, original_remaining, matched_remaining)
         VALUES ($1, $2, $3, 'MATCHED', $4::jsonb, $5::jsonb)
         RETURNING id`,
        [
          clearingRoundId,
          allocation.entityId,
          allocation.userId,
          JSON.stringify(allocation.originalVector),
          JSON.stringify(allocation.matchedVector)
        ]
      );

      const rowId = result.rows[0]?.id;
      if (!rowId) {
        throw new Error("failed_to_insert_clearing_participant");
      }

      participantRows.set(allocation.entityId, rowId);
    }

    return participantRows;
  }

  private async insertRoundLegMatchesAndUpdateLegs(
    client: PoolClient,
    clearingRoundId: string,
    participantRows: ReadonlyMap<string, string>,
    allocations: readonly ParticipantAllocation[]
  ): Promise<LegUpdate[]> {
    const legUpdates: LegUpdate[] = [];

    for (const allocation of allocations) {
      const participantRowId = participantRows.get(allocation.entityId);
      if (!participantRowId) {
        throw new Error("missing_clearing_participant_row");
      }

      const matchedKeys = Object.keys(allocation.matchedVector).sort((left, right) => left.localeCompare(right));
      for (const key of matchedKeys) {
        const matchedSigned = new Decimal(allocation.matchedVector[key] ?? "0");
        if (matchedSigned.isZero()) {
          continue;
        }

        const [marketId, outcomeId] = key.split(":");
        if (!marketId || !outcomeId) {
          throw new Error("invalid_clearing_leg_key");
        }

        await client.query(
          `INSERT INTO clearing_round_leg_matches
            (clearing_round_id, market_id, outcome_id, participant_id, signed_matched_size, price)
           VALUES ($1, $2, $3, $4, $5, NULL)`,
          [clearingRoundId, marketId, outcomeId, participantRowId, matchedSigned.toString()]
        );

        legUpdates.push(...this.allocateMatchedSizeToLegs(allocation.combo, key, matchedSigned));
      }
    }

    for (const update of legUpdates) {
      await client.query(
        `UPDATE combo_legs
            SET remaining_size = remaining_size - $1::numeric
          WHERE id = $2`,
        [update.clearedSize, update.legId]
      );
    }

    return legUpdates;
  }

  private allocateMatchedSizeToLegs(
    combo: AuthoritativeComboRow,
    key: string,
    matchedSigned: DecimalValue
  ): LegUpdate[] {
    const [marketId, outcomeId] = key.split(":");
    if (!marketId || !outcomeId) {
      throw new Error("invalid_clearing_leg_key");
    }

    const side = matchedSigned.gt(0) ? "buy" : "sell";
    const legs = combo.legs
      .filter((leg) =>
        leg.canonical_market_id === marketId &&
        leg.canonical_outcome_id === outcomeId &&
        leg.side === side
      )
      .sort((left, right) => left.id.localeCompare(right.id));

    if (legs.length === 0) {
      throw new Error("missing_clearing_leg_allocation");
    }

    let remainingToAllocate = matchedSigned.abs();
    const updates: LegUpdate[] = [];

    for (const leg of legs) {
      const legRemaining = new Decimal(leg.remaining_size);
      const cleared = Decimal.min(legRemaining, remainingToAllocate);
      if (cleared.gt(0)) {
        if (leg.price_hint === null) {
          throw new Error("missing_clearing_leg_price_hint");
        }

        updates.push({
          legId: leg.id,
          entityId: combo.id,
          marketId,
          outcomeId,
          side,
          clearedSize: cleared.toString(),
          priceHint: leg.price_hint
        });
        remainingToAllocate = remainingToAllocate.minus(cleared);
      }

      if (remainingToAllocate.isZero()) {
        break;
      }
    }

    if (!remainingToAllocate.isZero()) {
      throw new Error("unallocated_clearing_size");
    }

    return updates;
  }

  private async updateComboStates(client: PoolClient, allocations: readonly ParticipantAllocation[]): Promise<void> {
    for (const allocation of allocations) {
      await client.query(
        `UPDATE combo_rfqs
            SET state = $1
          WHERE id = $2`,
        [this.deriveResidualStateFromVector(allocation.residualVector), allocation.entityId]
      );
    }
  }

  private async applyExposureMutations(
    client: PoolClient,
    clearingRoundId: string,
    legUpdates: readonly LegUpdate[],
    signatures: ClearingMatchSignature,
    allocations: readonly ParticipantAllocation[]
  ): Promise<void> {
    const userByEntity = new Map(allocations.map((allocation) => [allocation.entityId, allocation.userId] as const));
    const matchedLegAllocations: MultiPartyExposureAggregationLeg[] = legUpdates.map((update) => {
      const userId = userByEntity.get(update.entityId);
      if (!userId) {
        throw new Error("missing_clearing_participant_user");
      }

      return {
        participantId: update.entityId,
        userId,
        legId: update.legId,
        marketId: update.marketId,
        outcomeId: update.outcomeId,
        side: update.side,
        price: update.priceHint,
        matchedSize: update.clearedSize
      };
    });

    const aggregated = this.multiPartyExposureAggregator.aggregate({
      matchedLegAllocations
    });
    const buckets = new Map<string, GroupedExposureBucket>();

    for (const participantDelta of aggregated.participantExposureDeltas) {
      for (const perLegDelta of participantDelta.perLegDeltas) {
        const enrichedPerLeg: AggregatedExposureLeg = {
          participantId: participantDelta.participantId,
          userId: participantDelta.userId,
          legId: perLegDelta.legId,
          marketId: perLegDelta.marketId,
          outcomeId: perLegDelta.outcomeId,
          side: perLegDelta.side,
          price: perLegDelta.price,
          matchedSize: perLegDelta.matchedSize,
          maxLossDelta: perLegDelta.maxLossDelta,
          maxGainDelta: perLegDelta.maxGainDelta
        };
        const bucketKey = `${participantDelta.userId}:${perLegDelta.marketId}:${perLegDelta.side}`;
        const existing = buckets.get(bucketKey);

        if (existing) {
          existing.perLeg.push({
            entityId: enrichedPerLeg.participantId,
            legId: enrichedPerLeg.legId,
            marketId: enrichedPerLeg.marketId,
            outcomeId: enrichedPerLeg.outcomeId,
            side: enrichedPerLeg.side,
            price: enrichedPerLeg.price,
            size: enrichedPerLeg.matchedSize,
            maxLossDelta: enrichedPerLeg.maxLossDelta,
            maxGainDelta: enrichedPerLeg.maxGainDelta
          });
          continue;
        }

        buckets.set(bucketKey, {
          userId: participantDelta.userId,
          marketId: perLegDelta.marketId,
          side: perLegDelta.side,
          perLeg: [{
            entityId: enrichedPerLeg.participantId,
            legId: enrichedPerLeg.legId,
            marketId: enrichedPerLeg.marketId,
            outcomeId: enrichedPerLeg.outcomeId,
            side: enrichedPerLeg.side,
            price: enrichedPerLeg.price,
            size: enrichedPerLeg.matchedSize,
            maxLossDelta: enrichedPerLeg.maxLossDelta,
            maxGainDelta: enrichedPerLeg.maxGainDelta
          }]
        });
      }
    }

    for (const bucket of buckets.values()) {
      const grossDelta = bucket.perLeg.reduce((sum, leg) => sum.plus(leg.maxLossDelta), new Decimal(0));
      const groupedMaxGainDelta = bucket.perLeg.reduce((sum, leg) => sum.plus(leg.maxGainDelta), new Decimal(0));
      const netDelta = bucket.perLeg.reduce(
        (sum, leg) => sum.plus(new Decimal(leg.maxGainDelta).minus(new Decimal(leg.maxLossDelta))),
        new Decimal(0)
      );

      const existingExposure = await client.query<{ id: string; gross_notional: string; net_notional: string }>(
        `SELECT id, gross_notional::text, net_notional::text
           FROM exposure
          WHERE user_id = $1
            AND canonical_market_id = $2
            AND side = $3
          FOR UPDATE`,
        [bucket.userId, bucket.marketId, bucket.side]
      );

      const current = existingExposure.rows[0];
      const previousGross = current ? new Decimal(current.gross_notional) : new Decimal(0);
      const previousNet = current ? new Decimal(current.net_notional) : new Decimal(0);
      const newGross = previousGross.plus(grossDelta);
      const newNet = previousNet.plus(netDelta);

      let exposureId = current?.id;
      if (!exposureId) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [bucket.userId, bucket.marketId, bucket.side, newGross.toString(), newNet.toString()]
        );
        exposureId = inserted.rows[0]?.id;
      } else {
        await client.query(
          `UPDATE exposure
              SET gross_notional = $1,
                  net_notional = $2,
                  last_updated = NOW(),
                  version = version + 1
            WHERE id = $3`,
          [newGross.toString(), newNet.toString(), exposureId]
        );
      }

      if (!exposureId) {
        throw new Error("failed_to_upsert_clearing_exposure");
      }

      await client.query(
        `INSERT INTO exposure_journal
          (exposure_id, change, prev_gross, prev_net, new_gross, new_net, source, reference_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          exposureId,
          netDelta.toString(),
          previousGross.toString(),
          previousNet.toString(),
          newGross.toString(),
          newNet.toString(),
          "combo-multi-party-clearing",
          clearingRoundId,
          JSON.stringify({
            clearingRoundId,
            participantSetHash: signatures.participantSetHash,
            matchSignatureHash: signatures.matchSignatureHash,
            marketId: bucket.marketId,
            side: bucket.side,
            groupedMaxLossDelta: grossDelta.toString(),
            groupedMaxGainDelta: groupedMaxGainDelta.toString(),
            perLeg: bucket.perLeg
          })
        ]
      );
    }
  }

  private async insertClearingEvent(
    client: PoolClient,
    clearingRoundId: string,
    signatures: ClearingMatchSignature,
    validatedPlan: {
      selectedGroup: CandidateGroup;
      score: ReturnType<IClearingCompressionScorer["score"]>;
      residuals: readonly { key: string; signedResidual: string }[];
    },
    allocations: readonly ParticipantAllocation[]
  ): Promise<void> {
    await client.query(
      `INSERT INTO clearing_round_events (clearing_round_id, event_type, payload)
       VALUES ($1, 'CLEARING_APPLIED', $2::jsonb)`,
      [
        clearingRoundId,
        JSON.stringify({
          clearingRoundId,
          participantSetHash: signatures.participantSetHash,
          matchSignatureHash: signatures.matchSignatureHash,
          participantIds: validatedPlan.selectedGroup.participantIds,
          uniqueLegs: validatedPlan.selectedGroup.uniqueLegs,
          residuals: validatedPlan.residuals,
          finalScore: validatedPlan.score.finalScore,
          participants: allocations.map((allocation) => ({
            entityId: allocation.entityId,
            userId: allocation.userId,
            matchedRemaining: allocation.matchedVector,
            residualRemaining: allocation.residualVector
          }))
        })
      ]
    );
  }

  private async refreshRegistryFromAuthoritativeState(
    participantIds: readonly string[],
    compatibilityBucket: string
  ): Promise<void> {
    for (const participantId of participantIds) {
      const client = await this.pool.connect();
      try {
        await this.candidateRegistry.unregisterEntity(participantId, compatibilityBucket);
        const combo = await this.loadCombo(client, participantId);
        if (combo === null) {
          continue;
        }

        if (!this.isClearableState(combo.state)) {
          continue;
        }

        const vector = this.residualVectorBuilder.build(this.toResidualVectorEntity(combo));
        if (Object.keys(vector.vector).length > 0) {
          await this.candidateRegistry.registerEntity(vector);
        }
      } catch (error) {
        this.logger.error({ err: error, participantId }, "Failed to refresh Phase 2B clearing registry after commit.");
      } finally {
        client.release();
      }
    }
  }

  private deriveResidualStateFromVector(residualVector: Record<string, string>): "EXECUTED" | "PARTIALLY_EXECUTED" {
    return Object.values(residualVector).some((value) => !new Decimal(value).isZero())
      ? "PARTIALLY_EXECUTED"
      : "EXECUTED";
  }

  private compareScores(
    left: ReturnType<IClearingCompressionScorer["score"]>,
    right: ReturnType<IClearingCompressionScorer["score"]>,
    leftParticipants: readonly string[],
    rightParticipants: readonly string[]
  ): number {
    const finalScoreDiff = new Decimal(right.finalScore).cmp(left.finalScore);
    if (finalScoreDiff !== 0) {
      return finalScoreDiff;
    }

    const residualDiff = new Decimal(left.postNetAbsResidual).cmp(right.postNetAbsResidual);
    if (residualDiff !== 0) {
      return residualDiff;
    }

    const oldestLeft = new Date(left.tieBreak.oldestParticipantAt).getTime();
    const oldestRight = new Date(right.tieBreak.oldestParticipantAt).getTime();
    if (oldestLeft !== oldestRight) {
      return oldestLeft - oldestRight;
    }

    if (left.tieBreak.participantCount !== right.tieBreak.participantCount) {
      return left.tieBreak.participantCount - right.tieBreak.participantCount;
    }

    return leftParticipants.join("|").localeCompare(rightParticipants.join("|"));
  }

  private sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private sameResiduals(
    left: readonly { key: string; signedResidual: string }[],
    right: readonly { key: string; signedResidual: string }[]
  ): boolean {
    return left.length === right.length && left.every((residual, index) =>
      residual.key === right[index]?.key && residual.signedResidual === right[index]?.signedResidual
    );
  }

  private isClearableState(state: string): boolean {
    return state === "OPEN" || state === "ACCEPTED" || state === "PARTIALLY_EXECUTED";
  }

  private hashToUuid(hash: string): string {
    const normalized = hash.replace(/-/g, "").slice(0, 32).padEnd(32, "0");
    return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
  }

  private async safeRollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch (error) {
      this.logger.warn({ err: error }, "Rollback failed during multi-party clearing.");
    }
  }
}
