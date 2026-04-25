import { describe, expect, it } from "vitest";
import {
  evaluatePolymarketLiveSubmitHarness,
  getPolymarketExecutionAdapterV2EnvStatus,
  polymarketLiveSubmitOperatorConfirmation
} from "../src/execution-system/index.js";

const liveReadyEnv = {
  POLYMARKET_EXECUTION_MODE: "v2",
  POLYMARKET_LIVE_EXECUTION_ENABLED: "true",
  POLYMARKET_CLOB_HOST: "https://clob.polymarket.test",
  POLYMARKET_CHAIN_ID: "80002",
  POLYMARKET_API_KEY: "server-side-key",
  POLYMARKET_API_SECRET: "server-side-secret",
  POLYMARKET_API_PASSPHRASE: "server-side-passphrase",
  POLYMARKET_BUILDER_CODE: "lotus-builder",
  POLYMARKET_PRIVATE_KEY: "0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f",
  POLYMARKET_LIVE_SUBMIT_VENUE_MARKET_ID: "pm-market-1",
  POLYMARKET_LIVE_SUBMIT_VENUE_OUTCOME_ID: "pm-outcome-yes",
  POLYMARKET_LIVE_SUBMIT_SIDE: "buy",
  POLYMARKET_LIVE_SUBMIT_SIZE: "0.01",
  POLYMARKET_LIVE_SUBMIT_PRICE: "0.51",
  POLYMARKET_LIVE_SUBMIT_MAX_SIZE: "0.05"
};

describe("Polymarket live-submit harness guard", () => {
  it("defaults to checklist-only and blocks live submission", () => {
    const status = getPolymarketExecutionAdapterV2EnvStatus(liveReadyEnv);
    const plan = evaluatePolymarketLiveSubmitHarness({ env: liveReadyEnv, adapterStatus: status });
    expect(plan).toMatchObject({
      enabled: false,
      allowed: false,
      mode: "DRY_RUN_CHECKLIST"
    });
    expect(plan.blockers).toContain("POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED must be true");
  });

  it("requires the exact operator confirmation phrase", () => {
    const env = {
      ...liveReadyEnv,
      POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED: "true",
      POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM: "yes"
    };
    const plan = evaluatePolymarketLiveSubmitHarness({
      env,
      adapterStatus: getPolymarketExecutionAdapterV2EnvStatus(env)
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockers).toContain("POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM is missing or incorrect");
  });

  it("requires extra acknowledgement for mainnet", () => {
    const env = {
      ...liveReadyEnv,
      POLYMARKET_CHAIN_ID: "137",
      POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED: "true",
      POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM: polymarketLiveSubmitOperatorConfirmation
    };
    const plan = evaluatePolymarketLiveSubmitHarness({
      env,
      adapterStatus: getPolymarketExecutionAdapterV2EnvStatus(env)
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockers).toContain("POLYMARKET_LIVE_SUBMIT_MAINNET_ACK must be true for Polygon mainnet");
    expect(plan.safeConfig.mainnetRequiresExtraAck).toBe(true);
  });

  it("allows only tiny operator-confirmed sandbox orders through the harness gate", () => {
    const env = {
      ...liveReadyEnv,
      POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED: "true",
      POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM: polymarketLiveSubmitOperatorConfirmation
    };
    const plan = evaluatePolymarketLiveSubmitHarness({
      env,
      adapterStatus: getPolymarketExecutionAdapterV2EnvStatus(env)
    });
    expect(plan).toMatchObject({
      enabled: true,
      allowed: true,
      mode: "LIVE_SUBMIT_READY",
      blockers: []
    });
    expect(JSON.stringify(plan)).not.toContain("server-side-secret");
  });

  it("blocks order size above the operator safety cap", () => {
    const env = {
      ...liveReadyEnv,
      POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED: "true",
      POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM: polymarketLiveSubmitOperatorConfirmation,
      POLYMARKET_LIVE_SUBMIT_SIZE: "0.2"
    };
    const plan = evaluatePolymarketLiveSubmitHarness({
      env,
      adapterStatus: getPolymarketExecutionAdapterV2EnvStatus(env)
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockers).toContain("POLYMARKET_LIVE_SUBMIT_SIZE exceeds max size 0.05");
  });
});
