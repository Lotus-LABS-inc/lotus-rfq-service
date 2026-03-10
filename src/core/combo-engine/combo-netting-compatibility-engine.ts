import Decimal from "decimal.js";

export type ComboNettingCompatibilityReason =
  | "self_trade_forbidden"
  | "price_ambiguity"
  | "price_incompatible"
  | "outcome_universe_mismatch"
  | "ambiguous_leg_mapping"
  | "no_compatible_overlap"
  | "non_exact_overlap";

export interface ComboNettingCompatibilityLeg {
  id: string;
  canonicalMarketId: string;
  canonicalOutcomeId: string;
  side: "buy" | "sell";
  quantity: string;
  priceHint?: string;
}

export interface ComboNettingCompatibilityInput {
  id: string;
  userId: string;
  legs: readonly ComboNettingCompatibilityLeg[];
}

export interface ComboNettingMatchedLegPair {
  incomingLegId: string;
  candidateLegId: string;
  marketId: string;
  outcomeId: string;
  matchedSize: string;
}

export interface ComboNettingCompatibilityResult {
  compatible: boolean;
  reason?: ComboNettingCompatibilityReason;
  matchedLegPairs: readonly ComboNettingMatchedLegPair[];
  maxNettableSize: string;
}

export interface IComboNettingCompatibilityEngine {
  evaluate(
    incomingCombo: ComboNettingCompatibilityInput,
    candidateCombo: ComboNettingCompatibilityInput
  ): ComboNettingCompatibilityResult;
}

export class ComboNettingCompatibilityEngine implements IComboNettingCompatibilityEngine {
  public evaluate(
    incomingCombo: ComboNettingCompatibilityInput,
    candidateCombo: ComboNettingCompatibilityInput
  ): ComboNettingCompatibilityResult {
    this.validateCombo(incomingCombo, "incomingCombo");
    this.validateCombo(candidateCombo, "candidateCombo");

    if (incomingCombo.userId === candidateCombo.userId) {
      return this.incompatible("self_trade_forbidden");
    }

    const exactUniverseMatch = this.hasExactOutcomeUniverseMatch(incomingCombo, candidateCombo);
    const incomingUniverse = this.outcomeUniverseSet(incomingCombo);
    const candidateUniverse = this.outcomeUniverseSet(candidateCombo);

    if (!exactUniverseMatch && !this.isSubsetUniverse(candidateUniverse, incomingUniverse)) {
      return this.incompatible("outcome_universe_mismatch");
    }

    const candidateMatchesByIncoming = new Map<string, ComboNettingCompatibilityLeg[]>();
    const incomingMatchesByCandidate = new Map<string, ComboNettingCompatibilityLeg[]>();

    for (const incomingLeg of incomingCombo.legs) {
      const compatibleCandidateLegs = candidateCombo.legs.filter((candidateLeg) =>
        this.isMatchEligible(incomingLeg, candidateLeg)
      );

      if (compatibleCandidateLegs.length > 1) {
        return this.incompatible("ambiguous_leg_mapping");
      }

      if (compatibleCandidateLegs.length === 1) {
        candidateMatchesByIncoming.set(incomingLeg.id, compatibleCandidateLegs);
      }
    }

    for (const candidateLeg of candidateCombo.legs) {
      const compatibleIncomingLegs = incomingCombo.legs.filter((incomingLeg) =>
        this.isMatchEligible(incomingLeg, candidateLeg)
      );

      if (compatibleIncomingLegs.length > 1) {
        return this.incompatible("ambiguous_leg_mapping");
      }

      if (compatibleIncomingLegs.length === 1) {
        incomingMatchesByCandidate.set(candidateLeg.id, compatibleIncomingLegs);
      }
    }

    const matchedLegPairs: ComboNettingMatchedLegPair[] = [];

    for (const incomingLeg of incomingCombo.legs) {
      const candidateLegs = candidateMatchesByIncoming.get(incomingLeg.id);
      if (!candidateLegs || candidateLegs.length !== 1) {
        continue;
      }

      const candidateLeg = candidateLegs[0];
      if (candidateLeg === undefined) {
        return this.incompatible("ambiguous_leg_mapping");
      }

      const reverseIncomingLegs = incomingMatchesByCandidate.get(candidateLeg.id);

      if (!reverseIncomingLegs || reverseIncomingLegs.length !== 1) {
        return this.incompatible("ambiguous_leg_mapping");
      }

      const reverseIncomingLeg = reverseIncomingLegs[0];
      if (reverseIncomingLeg === undefined || reverseIncomingLeg.id !== incomingLeg.id) {
        return this.incompatible("ambiguous_leg_mapping");
      }

      const priceCompatibility = this.checkPriceCompatibility(incomingLeg, candidateLeg);
      if (!priceCompatibility.compatible) {
        return this.incompatible(priceCompatibility.reason);
      }

      matchedLegPairs.push({
        incomingLegId: incomingLeg.id,
        candidateLegId: candidateLeg.id,
        marketId: incomingLeg.canonicalMarketId,
        outcomeId: incomingLeg.canonicalOutcomeId,
        matchedSize: Decimal.min(
          new Decimal(incomingLeg.quantity),
          new Decimal(candidateLeg.quantity)
        ).toString()
      });
    }

    if (matchedLegPairs.length === 0) {
      return this.incompatible("no_compatible_overlap");
    }

    if (exactUniverseMatch) {
      if (
        matchedLegPairs.length !== incomingCombo.legs.length ||
        matchedLegPairs.length !== candidateCombo.legs.length
      ) {
        return this.incompatible("non_exact_overlap");
      }
    }

    const maxNettableSize = matchedLegPairs.reduce((smallest, pair) => {
      const current = new Decimal(pair.matchedSize);
      if (smallest === null || current.lessThan(smallest)) {
        return current;
      }

      return smallest;
    }, null as InstanceType<typeof Decimal> | null);

    return {
      compatible: true,
      matchedLegPairs,
      maxNettableSize: (maxNettableSize ?? new Decimal(0)).toString()
    };
  }

  private validateCombo(combo: ComboNettingCompatibilityInput, field: string): void {
    if (combo.id.trim().length === 0) {
      throw new Error(`${field}.id is required.`);
    }

    if (combo.userId.trim().length === 0) {
      throw new Error(`${field}.userId is required.`);
    }

    if (combo.legs.length === 0) {
      throw new Error(`${field}.legs must not be empty.`);
    }

    for (const leg of combo.legs) {
      if (
        leg.id.trim().length === 0 ||
        leg.canonicalMarketId.trim().length === 0 ||
        leg.canonicalOutcomeId.trim().length === 0
      ) {
        throw new Error(`${field} contains malformed leg identifiers.`);
      }

      if (leg.side !== "buy" && leg.side !== "sell") {
        throw new Error(`${field} contains invalid side.`);
      }

      this.toDecimal(leg.quantity, `${field}.quantity`);

      if (leg.priceHint !== undefined) {
        this.toDecimal(leg.priceHint, `${field}.priceHint`);
      }
    }
  }

  private isMatchEligible(
    incomingLeg: ComboNettingCompatibilityLeg,
    candidateLeg: ComboNettingCompatibilityLeg
  ): boolean {
    return (
      incomingLeg.canonicalMarketId === candidateLeg.canonicalMarketId &&
      incomingLeg.canonicalOutcomeId === candidateLeg.canonicalOutcomeId &&
      incomingLeg.side !== candidateLeg.side
    );
  }

  private checkPriceCompatibility(
    incomingLeg: ComboNettingCompatibilityLeg,
    candidateLeg: ComboNettingCompatibilityLeg
  ): { compatible: true } | { compatible: false; reason: ComboNettingCompatibilityReason } {
    if (incomingLeg.priceHint === undefined && candidateLeg.priceHint === undefined) {
      return { compatible: true };
    }

    if (incomingLeg.priceHint === undefined || candidateLeg.priceHint === undefined) {
      return { compatible: false, reason: "price_ambiguity" };
    }

    const incomingPrice = this.toDecimal(incomingLeg.priceHint, "incomingLeg.priceHint");
    const candidatePrice = this.toDecimal(candidateLeg.priceHint, "candidateLeg.priceHint");

    const isCompatible =
      incomingLeg.side === "buy"
        ? incomingPrice.greaterThanOrEqualTo(candidatePrice)
        : incomingPrice.lessThanOrEqualTo(candidatePrice);

    return isCompatible
      ? { compatible: true }
      : { compatible: false, reason: "price_incompatible" };
  }

  private hasExactOutcomeUniverseMatch(
    incomingCombo: ComboNettingCompatibilityInput,
    candidateCombo: ComboNettingCompatibilityInput
  ): boolean {
    const incomingUniverse = [...this.outcomeUniverseSet(incomingCombo)].sort();
    const candidateUniverse = [...this.outcomeUniverseSet(candidateCombo)].sort();

    if (incomingUniverse.length !== candidateUniverse.length) {
      return false;
    }

    return incomingUniverse.every((value, index) => value === candidateUniverse[index]);
  }

  private isSubsetUniverse(
    candidateUniverse: ReadonlySet<string>,
    incomingUniverse: ReadonlySet<string>
  ): boolean {
    for (const value of candidateUniverse) {
      if (!incomingUniverse.has(value)) {
        return false;
      }
    }

    return true;
  }

  private outcomeUniverseSet(combo: ComboNettingCompatibilityInput): ReadonlySet<string> {
    return new Set(combo.legs.map((leg) => `${leg.canonicalMarketId}:${leg.canonicalOutcomeId}`));
  }

  private toDecimal(value: string, field: string): InstanceType<typeof Decimal> {
    try {
      const decimal = new Decimal(value);
      if (!decimal.isFinite() || decimal.isNegative()) {
        throw new Error(`${field} must be a finite non-negative decimal.`);
      }

      return decimal;
    } catch {
      throw new Error(`${field} must be a finite non-negative decimal.`);
    }
  }

  private incompatible(reason: ComboNettingCompatibilityReason): ComboNettingCompatibilityResult {
    return {
      compatible: false,
      reason,
      matchedLegPairs: [],
      maxNettableSize: "0"
    };
  }
}
