import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import type { RouteCandidate } from "../../src/core/sor/types.js";

const baseCandidate = (overrides?: Partial<RouteCandidate>): RouteCandidate => ({
  id: "b9157e65-649b-4e2f-9062-27d3f45d7d9d",
  leg_id: "013f5d89-0d66-4678-a57b-800c2f1fafcc",
  provider_type: "LP",
  provider_id: "lp-1",
  available_size: 100,
  quoted_price: 1.2,
  fees: {
    provider_fee: 0.02,
    protocol_fee: 0.01
  },
  latency_ms: 10,
  fill_prob: 0.9,
  ...(overrides ?? {})
});

describe("SOR CostModel", () => {
  it("scores candidate with Decimal math and expected component totals", () => {
    const model = new CostModel({
      slippageAlpha: 0.01,
      slippageBeta: 1,
      expectedRecoveryCost: 1,
      timeValueOfMoneyCost: 0.5,
      latencyPenaltyPerMs: 0.001
    });
    const candidate = baseCandidate();

    const scored = model.scoreCandidate(candidate, 10);

    // Notional = 1.2 * 10 = 12
    // Slippage ratio = 0.01 * (10 / 100)^1 = 0.001
    // Expected slippage = 12 * 0.001 = 0.012
    // Fees = 0.03
    // Effective = 12 + 0.012 + 0.03 = 12.042
    // Failure cost = (1 - 0.9) * (1 + 0.5) = 0.15
    // Latency penalty = 10 * 0.001 = 0.01
    // Total = 12.202
    expect(scored.expected_slippage.toNumber()).toBeCloseTo(0.012, 10);
    expect(scored.effective_cost.toNumber()).toBeCloseTo(12.042, 10);
    expect(scored.failure_cost.toNumber()).toBeCloseTo(0.15, 10);
    expect(scored.total_score.toNumber()).toBeCloseTo(12.202, 10);
    expect(scored.fill_prob).toBe(0.9);
  });

  it("handles tiny available_size without floating overflow or NaN", () => {
    const model = new CostModel({
      slippageAlpha: 0.01,
      slippageBeta: 1
    });
    const candidate = baseCandidate({
      available_size: 0.0000001
    });

    const scored = model.scoreCandidate(candidate, 10);

    expect(new Decimal(scored.expected_slippage).isFinite()).toBe(true);
    expect(new Decimal(scored.total_score).isFinite()).toBe(true);
    expect(scored.expected_slippage.greaterThan(0)).toBe(true);
  });

  it("applies full failure cost when fill_prob is zero", () => {
    const model = new CostModel({
      expectedRecoveryCost: 2,
      timeValueOfMoneyCost: 0.5
    });
    const candidate = baseCandidate({
      fill_prob: 0
    });

    const scored = model.scoreCandidate(candidate, 5);
    expect(scored.failure_cost.toNumber()).toBeCloseTo(2.5, 10);
    expect(scored.fill_prob).toBe(0);
  });

  it("includes provider, protocol, and gas fees in effective cost", () => {
    const model = new CostModel({
      slippageAlpha: 0.0000000001,
      slippageBeta: 1,
      expectedRecoveryCost: 0,
      timeValueOfMoneyCost: 0,
      latencyPenaltyPerMs: 0
    });
    const candidate = baseCandidate({
      quoted_price: 2,
      fees: {
        provider_fee: 0.2,
        protocol_fee: 0.1,
        gas_cost: 0.05
      },
      fill_prob: 1
    });

    const scored = model.scoreCandidate(candidate, 3);

    // Notional = 6, fees = 0.35, slippage/failure/latency = 0.
    expect(scored.expected_slippage.toNumber()).toBeCloseTo(0, 8);
    expect(scored.failure_cost.toNumber()).toBeCloseTo(0, 10);
    expect(scored.effective_cost.toNumber()).toBeCloseTo(6.35, 10);
    expect(scored.total_score.toNumber()).toBeCloseTo(6.35, 10);
  });
});
