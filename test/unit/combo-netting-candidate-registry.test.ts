import { beforeEach, describe, expect, it } from "vitest";

import { ComboNettingCandidateRegistry } from "../../src/core/combo-engine/combo-netting-candidate-registry.js";

class InMemoryRedisSetClient {
  private readonly sets = new Map<string, Set<string>>();

  public async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.getOrCreateSet(key);
    let added = 0;

    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }

    return added;
  }

  public async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) {
      return 0;
    }

    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }

    if (set.size === 0) {
      this.sets.delete(key);
    }

    return removed;
  }

  public async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? [...set] : [];
  }

  public async sinter(...keys: string[]): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }

    const firstKey = keys[0];
    if (firstKey === undefined) {
      return [];
    }

    const base = this.sets.get(firstKey);
    if (!base) {
      return [];
    }

    return [...base].filter((value) =>
      keys.slice(1).every((key) => this.sets.get(key)?.has(value) ?? false)
    );
  }

  public async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.sets.delete(key)) {
        removed += 1;
      }
    }

    return removed;
  }

  private getOrCreateSet(key: string): Set<string> {
    const existing = this.sets.get(key);
    if (existing) {
      return existing;
    }

    const created = new Set<string>();
    this.sets.set(key, created);
    return created;
  }
}

describe("ComboNettingCandidateRegistry", () => {
  let redis: InMemoryRedisSetClient;
  let registry: ComboNettingCandidateRegistry;

  beforeEach(() => {
    redis = new InMemoryRedisSetClient();
    registry = new ComboNettingCandidateRegistry(redis);
  });

  it("registers combo legs into expected Redis set keys", async () => {
    const result = await registry.registerComboCandidate({
      id: "combo-a",
      legs: [
        { id: "leg-1", marketId: "m1", outcomeId: "o1", side: "buy" },
        { id: "leg-2", marketId: "m2", outcomeId: "o2", side: "sell" }
      ]
    });

    expect(result).toEqual({
      comboId: "combo-a",
      registeredKeys: [
        "combo_net:leg:m1:o1:buy",
        "combo_net:leg:m2:o2:sell"
      ]
    });

    await expect(redis.smembers("combo_net:leg:m1:o1:buy")).resolves.toEqual(["combo-a"]);
    await expect(redis.smembers("combo_net:leg:m2:o2:sell")).resolves.toEqual(["combo-a"]);
    await expect(redis.smembers("combo_net:combo:combo-a:legs")).resolves.toEqual([
      "combo_net:leg:m1:o1:buy",
      "combo_net:leg:m2:o2:sell"
    ]);
  });

  it("keeps duplicate registration idempotent", async () => {
    const combo = {
      id: "combo-a",
      legs: [
        { id: "leg-1", marketId: "m1", outcomeId: "o1", side: "buy" },
        { id: "leg-2", marketId: "m1", outcomeId: "o1", side: "buy" }
      ] as const
    };

    await registry.registerComboCandidate(combo);
    const result = await registry.registerComboCandidate(combo);

    expect(result.registeredKeys).toEqual(["combo_net:leg:m1:o1:buy"]);
    await expect(redis.smembers("combo_net:leg:m1:o1:buy")).resolves.toEqual(["combo-a"]);
    await expect(redis.smembers("combo_net:combo:combo-a:legs")).resolves.toEqual([
      "combo_net:leg:m1:o1:buy"
    ]);
  });

  it("unregisters combo from all stored keys without scanning", async () => {
    await registry.registerComboCandidate({
      id: "combo-a",
      legs: [
        { id: "leg-1", marketId: "m1", outcomeId: "o1", side: "buy" },
        { id: "leg-2", marketId: "m2", outcomeId: "o2", side: "sell" }
      ]
    });

    const result = await registry.unregisterComboCandidate("combo-a");

    expect(result).toEqual({
      comboId: "combo-a",
      removedFromKeys: [
        "combo_net:leg:m1:o1:buy",
        "combo_net:leg:m2:o2:sell"
      ],
      removed: true
    });
    await expect(redis.smembers("combo_net:leg:m1:o1:buy")).resolves.toEqual([]);
    await expect(redis.smembers("combo_net:leg:m2:o2:sell")).resolves.toEqual([]);
    await expect(redis.smembers("combo_net:combo:combo-a:legs")).resolves.toEqual([]);
  });

  it("finds opposite compatible combos for incoming buy legs", async () => {
    await registry.registerComboCandidate({
      id: "combo-sell",
      legs: [{ id: "leg-1", marketId: "m1", outcomeId: "o1", side: "sell" }]
    });
    await registry.registerComboCandidate({
      id: "combo-buy",
      legs: [{ id: "leg-2", marketId: "m1", outcomeId: "o1", side: "buy" }]
    });

    const result = await registry.findCandidateCombos({
      id: "incoming",
      legs: [{ id: "incoming-leg", marketId: "m1", outcomeId: "o1", side: "buy" }]
    });

    expect(result).toEqual(["combo-sell"]);
  });

  it("finds opposite compatible combos for incoming sell legs", async () => {
    await registry.registerComboCandidate({
      id: "combo-buy",
      legs: [{ id: "leg-1", marketId: "m2", outcomeId: "o2", side: "buy" }]
    });

    const result = await registry.findCandidateCombos({
      id: "incoming",
      legs: [{ id: "incoming-leg", marketId: "m2", outcomeId: "o2", side: "sell" }]
    });

    expect(result).toEqual(["combo-buy"]);
  });

  it("returns unique combo ids across overlapping incoming legs and excludes self", async () => {
    await registry.registerComboCandidate({
      id: "combo-a",
      legs: [
        { id: "leg-1", marketId: "m1", outcomeId: "o1", side: "sell" },
        { id: "leg-2", marketId: "m2", outcomeId: "o2", side: "buy" }
      ]
    });
    await registry.registerComboCandidate({
      id: "combo-b",
      legs: [{ id: "leg-3", marketId: "m1", outcomeId: "o1", side: "sell" }]
    });
    await registry.registerComboCandidate({
      id: "incoming",
      legs: [{ id: "leg-4", marketId: "m2", outcomeId: "o2", side: "sell" }]
    });

    const result = await registry.findCandidateCombos({
      id: "incoming",
      legs: [
        { id: "incoming-leg-1", marketId: "m1", outcomeId: "o1", side: "buy" },
        { id: "incoming-leg-2", marketId: "m2", outcomeId: "o2", side: "sell" }
      ]
    });

    expect([...result].sort()).toEqual(["combo-a", "combo-b"]);
  });

  it("returns empty list when no opposite-compatible legs exist", async () => {
    await registry.registerComboCandidate({
      id: "combo-a",
      legs: [{ id: "leg-1", marketId: "m1", outcomeId: "o1", side: "buy" }]
    });

    const result = await registry.findCandidateCombos({
      id: "incoming",
      legs: [{ id: "incoming-leg", marketId: "m3", outcomeId: "o3", side: "buy" }]
    });

    expect(result).toEqual([]);
  });
});
