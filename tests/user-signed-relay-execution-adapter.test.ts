import { describe, expect, it } from "vitest";
import {
  buildOpinionExecutionAdapterConfigFromEnv,
  buildPredictFunExecutionAdapterConfigFromEnv,
  getOpinionExecutionAdapterEnvStatus,
  getPredictFunExecutionAdapterEnvStatus,
  OpinionExecutionAdapter,
  PredictFunExecutionAdapter,
  UserSignedRelayExecutionNotConfiguredError
} from "../src/execution-system/user-signed-relay-execution-adapter.js";
import type { ExecutionLegV0 } from "../src/execution-system/types.js";

const leg = (venue: "OPINION" | "PREDICT_FUN"): ExecutionLegV0 => ({
  executionLegId: `${venue.toLowerCase()}-execution-leg-1`,
  parentExecutionId: `${venue.toLowerCase()}-execution-1`,
  venue,
  venueMarketId: "venue-market-id",
  venueOutcomeId: "venue-outcome-id",
  side: "buy",
  size: "1",
  price: 0.45,
  status: "CREATED",
  settlementStatus: "SETTLEMENT_PENDING"
});

describe("user-signed backend relay execution adapters", () => {
  it("keeps Opinion disabled by default", () => {
    const status = getOpinionExecutionAdapterEnvStatus({
      OPINION_CLOB_BASE_URL: "https://proxy.opinion.trade:8443/openapi",
      OPINION_API_KEY: "server-side-opinion-key",
      OPINION_LIVE_EXECUTION_ENABLED: "false"
    });

    expect(status).toMatchObject({
      adapter: "OpinionExecutionAdapter",
      venue: "OPINION",
      executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
      featureFlagSelected: false,
      liveExecutionEnabled: false,
      readinessState: "NOT_CONFIGURED",
      relayImplementationStatus: "PREPARE_ONLY"
    });
  });

  it("prepares frontend-safe Opinion user signing instructions when relay mode is selected", async () => {
    const adapter = new OpinionExecutionAdapter(buildOpinionExecutionAdapterConfigFromEnv({
      OPINION_EXECUTION_MODE: "user_signed_backend_relay",
      OPINION_CLOB_BASE_URL: "https://proxy.opinion.trade:8443/openapi",
      OPINION_API_KEY: "server-side-opinion-key",
      OPINION_LIVE_EXECUTION_ENABLED: "false"
    }));

    const prepared = await adapter.prepareOrder(leg("OPINION"));

    expect(prepared.payload).toMatchObject({
      relayMode: "USER_SIGNED_BACKEND_RELAY",
      adapter: "OpinionExecutionAdapter",
      backendMayRelaySignedPayload: true,
      backendMaySign: false,
      signingRequired: true,
      venueMarketId: "venue-market-id",
      venueOutcomeId: "venue-outcome-id",
      price: 0.45,
      size: 1
    });
    const serialized = JSON.stringify(prepared);
    expect(serialized).not.toContain("server-side-opinion-key");
  });

  it("keeps Predict.fun relay prepare-only even when OAuth env is structurally ready", async () => {
    const env = {
      PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
      PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
      PREDICT_API_KEY: "server-side-predict-key",
      PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
    };
    const status = getPredictFunExecutionAdapterEnvStatus(env);
    expect(status).toMatchObject({
      adapter: "PredictFunExecutionAdapter",
      venue: "PREDICT_FUN",
      executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
      readinessState: "LIVE_READY",
      relayImplementationStatus: "PREPARE_ONLY"
    });

    const adapter = new PredictFunExecutionAdapter(buildPredictFunExecutionAdapterConfigFromEnv(env));
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    expect(prepared.payload).toMatchObject({
      relayMode: "USER_SIGNED_BACKEND_RELAY",
      adapter: "PredictFunExecutionAdapter",
      orderCreatePath: "/v1/oauth/orders/create",
      backendMayRelaySignedPayload: true,
      backendMaySign: false
    });
    await expect(adapter.submitOrder(prepared)).rejects.toBeInstanceOf(UserSignedRelayExecutionNotConfiguredError);
  });

  it("does not claim settlement verification for relay venues", async () => {
    const adapter = new PredictFunExecutionAdapter(buildPredictFunExecutionAdapterConfigFromEnv({
      PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
      PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
      PREDICT_API_KEY: "server-side-predict-key",
      PREDICT_FUN_LIVE_EXECUTION_ENABLED: "false"
    }));

    await expect(adapter.fetchSettlementState("predict-order-1")).resolves.toMatchObject({
      status: "SETTLEMENT_PENDING",
      evidence: {
        settlementEvidenceSupported: false
      }
    });
  });
});
