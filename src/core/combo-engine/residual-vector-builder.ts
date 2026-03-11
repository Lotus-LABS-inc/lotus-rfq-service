import Decimal from "decimal.js";

import type {
  ResidualVector,
  ResidualVectorEntity,
  ResidualVectorLeg
} from "./types.js";

type BucketFieldName =
  | "resolutionUniverse"
  | "expiryClass"
  | "settlementModel"
  | "resolutionRuleClass";

interface ResidualBucketMetadata {
  resolutionUniverse: string;
  expiryClass: string;
  settlementModel: string;
  resolutionRuleClass: string;
}

export interface IResidualVectorBuilder {
  build(entity: ResidualVectorEntity): ResidualVector;
}

export class ResidualVectorBuilder implements IResidualVectorBuilder {
  public build(entity: ResidualVectorEntity): ResidualVector {
    const residualLegs = entity.legs
      .map((leg) => ({ leg, remaining: this.parseRemainingSize(leg) }))
      .filter(({ remaining }) => remaining.gt(0));

    if (residualLegs.length === 0) {
      throw new Error("no_residual_legs");
    }

    const bucketMetadata = this.resolveBucketMetadata(residualLegs.map(({ leg }) => leg));
    const vectorTotals = new Map<string, InstanceType<typeof Decimal>>();
    let grossAbsSize = new Decimal(0);

    for (const { leg, remaining } of residualLegs) {
      const key = `${leg.canonicalMarketId}:${leg.canonicalOutcomeId}`;
      const signedSize = leg.side === "buy" ? remaining : remaining.negated();
      vectorTotals.set(key, (vectorTotals.get(key) ?? new Decimal(0)).plus(signedSize));
      grossAbsSize = grossAbsSize.plus(remaining.abs());
    }

    const vector = Object.fromEntries(
      [...vectorTotals.entries()].map(([key, value]) => [key, value.toString()])
    );

    return {
      entityId: entity.entityId,
      userId: entity.userId,
      compatibilityBucket: this.buildBucket(bucketMetadata),
      vector,
      legCount: residualLegs.length,
      grossAbsSize: grossAbsSize.toString()
    };
  }

  private parseRemainingSize(leg: ResidualVectorLeg): InstanceType<typeof Decimal> {
    let remaining: InstanceType<typeof Decimal>;
    try {
      remaining = new Decimal(leg.remainingSize);
    } catch {
      throw new Error("invalid_remaining_size");
    }

    if (!remaining.isFinite()) {
      throw new Error("invalid_remaining_size");
    }

    if (remaining.lt(0)) {
      throw new Error("negative_residual_size");
    }

    return remaining;
  }

  private resolveBucketMetadata(legs: readonly ResidualVectorLeg[]): ResidualBucketMetadata {
    const first = this.readBucketMetadata(legs[0]!);

    for (const leg of legs.slice(1)) {
      const current = this.readBucketMetadata(leg);
      if (
        current.resolutionUniverse !== first.resolutionUniverse ||
        current.expiryClass !== first.expiryClass ||
        current.settlementModel !== first.settlementModel ||
        current.resolutionRuleClass !== first.resolutionRuleClass
      ) {
        throw new Error("bucket_mismatch");
      }
    }

    return first;
  }

  private readBucketMetadata(leg: ResidualVectorLeg): ResidualBucketMetadata {
    const metadata = leg.metadata;
    const fields: BucketFieldName[] = [
      "resolutionUniverse",
      "expiryClass",
      "settlementModel",
      "resolutionRuleClass"
    ];

    if (!metadata) {
      throw new Error("missing_bucket_metadata");
    }

    const resolutionUniverse = metadata.resolutionUniverse;
    const expiryClass = metadata.expiryClass;
    const settlementModel = metadata.settlementModel;
    const resolutionRuleClass = metadata.resolutionRuleClass;

    if (
      typeof resolutionUniverse !== "string" ||
      resolutionUniverse.length === 0 ||
      typeof expiryClass !== "string" ||
      expiryClass.length === 0 ||
      typeof settlementModel !== "string" ||
      settlementModel.length === 0 ||
      typeof resolutionRuleClass !== "string" ||
      resolutionRuleClass.length === 0
    ) {
      throw new Error("missing_bucket_metadata");
    }

    return {
      resolutionUniverse,
      expiryClass,
      settlementModel,
      resolutionRuleClass
    };
  }

  private buildBucket(metadata: ResidualBucketMetadata): string {
    return [
      metadata.resolutionUniverse,
      metadata.expiryClass,
      metadata.settlementModel,
      metadata.resolutionRuleClass
    ].join("|");
  }
}
