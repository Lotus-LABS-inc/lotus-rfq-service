import Decimal from "decimal.js";

import type {
  CandidateGroup,
  ClearingCompressionScore,
  ScorableResidualVector
} from "./types.js";

export interface IClearingCompressionScorer {
  score(
    group: CandidateGroup,
    participantVectors: readonly ScorableResidualVector[]
  ): ClearingCompressionScore;
}

export class ClearingCompressionScorer implements IClearingCompressionScorer {
  public score(
    group: CandidateGroup,
    participantVectors: readonly ScorableResidualVector[]
  ): ClearingCompressionScore {
    const participantSet = new Set(group.participantIds);
    if (participantSet.size !== group.participantIds.length) {
      throw new Error("duplicate_group_participants");
    }

    const byEntityId = new Map<string, ScorableResidualVector>();
    for (const vector of participantVectors) {
      if (byEntityId.has(vector.entityId)) {
        throw new Error("duplicate_participant_vector");
      }
      byEntityId.set(vector.entityId, vector);
    }

    if (participantVectors.length !== group.participantIds.length) {
      throw new Error("participant_vector_mismatch");
    }

    for (const participantId of group.participantIds) {
      if (!byEntityId.has(participantId)) {
        throw new Error("participant_vector_mismatch");
      }
    }

    for (const vector of participantVectors) {
      if (!participantSet.has(vector.entityId)) {
        throw new Error("participant_vector_mismatch");
      }
    }

    const aggregatedResidual = new Map<string, InstanceType<typeof Decimal>>();
    let preNetAbsExposure = new Decimal(0);
    let oldestParticipantAt: Date | null = null;
    const residualVectorByParticipant: Record<string, { entityId: string; vector: Record<string, string> }> = {};

    for (const participantId of group.participantIds) {
      const vector = byEntityId.get(participantId);
      if (!vector) {
        throw new Error("participant_vector_mismatch");
      }

      const createdAt = this.parseCreatedAt(vector.createdAt);
      if (oldestParticipantAt === null || createdAt.getTime() < oldestParticipantAt.getTime()) {
        oldestParticipantAt = createdAt;
      }

      residualVectorByParticipant[participantId] = {
        entityId: participantId,
        vector: { ...vector.vector }
      };

      for (const [key, rawValue] of Object.entries(vector.vector)) {
        const signed = this.parseSigned(rawValue);
        preNetAbsExposure = preNetAbsExposure.plus(signed.abs());
        aggregatedResidual.set(key, (aggregatedResidual.get(key) ?? new Decimal(0)).plus(signed));
      }
    }

    const postNetAbsResidual = [...aggregatedResidual.values()].reduce((sum, value) => {
      if (value.isZero()) {
        return sum;
      }
      return sum.plus(value.abs());
    }, new Decimal(0));

    const compressionScore = preNetAbsExposure.minus(postNetAbsResidual);

    const participantPenalty = new Decimal(Math.max(0, group.participantIds.length - 2));
    const uniqueLegPenalty = new Decimal(Math.max(0, group.uniqueLegs.length - 2));
    const fragmentedResidualPenalty = new Decimal(
      [...aggregatedResidual.values()].filter((value) => !value.isZero()).length
    );
    const rankingPenalty = participantPenalty.plus(uniqueLegPenalty).plus(fragmentedResidualPenalty);
    const finalScore = compressionScore.minus(rankingPenalty);

    if (oldestParticipantAt === null) {
      throw new Error("participant_vector_mismatch");
    }

    return {
      compressionScore: compressionScore.toString(),
      preNetAbsExposure: preNetAbsExposure.toString(),
      postNetAbsResidual: postNetAbsResidual.toString(),
      residualVectorByParticipant,
      rankingPenalty: rankingPenalty.toString(),
      finalScore: finalScore.toString(),
      tieBreak: {
        smallestResidual: postNetAbsResidual.toString(),
        oldestParticipantAt: oldestParticipantAt.toISOString(),
        participantCount: group.participantIds.length
      }
    };
  }

  private parseSigned(value: string): InstanceType<typeof Decimal> {
    try {
      const parsed = new Decimal(value);
      if (!parsed.isFinite()) {
        throw new Error("invalid_participant_vector");
      }
      return parsed;
    } catch {
      throw new Error("invalid_participant_vector");
    }
  }

  private parseCreatedAt(value: Date | string): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error("invalid_participant_created_at");
    }
    return date;
  }
}
