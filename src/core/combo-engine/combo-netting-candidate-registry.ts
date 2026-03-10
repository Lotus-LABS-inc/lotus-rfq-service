import { z } from "zod";

import type { RedisClient } from "../../db/redis.js";

const comboNettingCandidateLegSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  outcomeId: z.string().min(1),
  side: z.enum(["buy", "sell"])
});

const comboNettingCandidateComboSchema = z.object({
  id: z.string().min(1),
  legs: z.array(comboNettingCandidateLegSchema).min(1)
});

export interface ComboNettingCandidateLeg {
  id: string;
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
}

export interface ComboNettingCandidateCombo {
  id: string;
  legs: readonly ComboNettingCandidateLeg[];
}

interface ComboNettingRegistryRedisClient
  extends Pick<Required<RedisClient>, "sadd" | "srem" | "smembers" | "del"> {}

export interface RegisteredComboCandidate {
  comboId: string;
  registeredKeys: readonly string[];
}

export interface UnregisterComboCandidateResult {
  comboId: string;
  removedFromKeys: readonly string[];
  removed: boolean;
}

export interface IComboNettingCandidateRegistry {
  registerComboCandidate(combo: ComboNettingCandidateCombo): Promise<RegisteredComboCandidate>;
  unregisterComboCandidate(comboId: string): Promise<UnregisterComboCandidateResult>;
  findCandidateCombos(incomingCombo: ComboNettingCandidateCombo): Promise<readonly string[]>;
}

export class ComboNettingCandidateRegistry implements IComboNettingCandidateRegistry {
  public constructor(private readonly redis: ComboNettingRegistryRedisClient) {}

  public async registerComboCandidate(
    combo: ComboNettingCandidateCombo
  ): Promise<RegisteredComboCandidate> {
    const parsedCombo = this.parseCombo(combo);
    const legKeys = this.uniqueLegKeys(parsedCombo.legs);
    const reverseKey = this.comboLegsKey(parsedCombo.id);

    if (legKeys.length === 0) {
      throw new Error("Combo candidate must contain at least one valid leg.");
    }

    await Promise.all([
      ...legKeys.map((key) => this.redis.sadd(key, parsedCombo.id)),
      this.redis.sadd(reverseKey, ...legKeys)
    ]);

    return {
      comboId: parsedCombo.id,
      registeredKeys: legKeys
    };
  }

  public async unregisterComboCandidate(comboId: string): Promise<UnregisterComboCandidateResult> {
    if (comboId.trim().length === 0) {
      throw new Error("comboId is required.");
    }

    const reverseKey = this.comboLegsKey(comboId);
    const legKeys = await this.redis.smembers(reverseKey);

    if (legKeys.length === 0) {
      return {
        comboId,
        removedFromKeys: [],
        removed: false
      };
    }

    const removalCounts = await Promise.all([
      ...legKeys.map((key) => this.redis.srem(key, comboId)),
      this.redis.del(reverseKey)
    ]);

    const removedFromKeys = legKeys.filter((_, index) => (removalCounts[index] ?? 0) > 0);

    return {
      comboId,
      removedFromKeys,
      removed: removedFromKeys.length > 0
    };
  }

  public async findCandidateCombos(
    incomingCombo: ComboNettingCandidateCombo
  ): Promise<readonly string[]> {
    const parsedCombo = this.parseCombo(incomingCombo);
    const oppositeKeys = this.uniqueOppositeKeys(parsedCombo.legs);

    if (oppositeKeys.length === 0) {
      return [];
    }

    const memberGroups = await Promise.all(oppositeKeys.map((key) => this.redis.smembers(key)));
    const candidates = new Set<string>();

    for (const members of memberGroups) {
      for (const comboId of members) {
        if (comboId !== parsedCombo.id) {
          candidates.add(comboId);
        }
      }
    }

    return [...candidates];
  }

  public legKey(marketId: string, outcomeId: string, side: "buy" | "sell"): string {
    return `combo_net:leg:${marketId}:${outcomeId}:${side}`;
  }

  public comboLegsKey(comboId: string): string {
    return `combo_net:combo:${comboId}:legs`;
  }

  private uniqueLegKeys(legs: readonly ComboNettingCandidateLeg[]): string[] {
    return [...new Set(legs.map((leg) => this.legKey(leg.marketId, leg.outcomeId, leg.side)))];
  }

  private uniqueOppositeKeys(legs: readonly ComboNettingCandidateLeg[]): string[] {
    return [
      ...new Set(
        legs.map((leg) => this.legKey(leg.marketId, leg.outcomeId, this.oppositeSide(leg.side)))
      )
    ];
  }

  private oppositeSide(side: "buy" | "sell"): "buy" | "sell" {
    return side === "buy" ? "sell" : "buy";
  }

  private parseCombo(combo: ComboNettingCandidateCombo): ComboNettingCandidateCombo {
    const parsed = comboNettingCandidateComboSchema.parse(combo);

    return {
      id: parsed.id,
      legs: parsed.legs.map((leg) => ({
        id: leg.id,
        marketId: leg.marketId,
        outcomeId: leg.outcomeId,
        side: leg.side
      }))
    };
  }
}
