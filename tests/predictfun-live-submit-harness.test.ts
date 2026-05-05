import { describe, expect, it } from "vitest";
import {
  evaluatePredictFunLiveSubmitHarness,
  getPredictFunExecutionAdapterEnvStatus,
  predictFunLiveSubmitOperatorConfirmation,
  redactSensitivePredictFunHarnessArtifactValue
} from "../src/execution-system/index.js";

const liveReadyEnv = {
  PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
  PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
  PREDICT_API_KEY: "server-side-predict-key",
  PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
};

const validSignedPayload = JSON.stringify({
  signer: "0xD1059eC5F635712f6dcEAd569a41dFD7970DAffa",
  account: "0x42AfFF0c9366Eb1862b42A5758437CF26c3B76B9",
  signature: `0x${"a".repeat(130)}`,
  data: {
    order: {
      maker: "0x42AfFF0c9366Eb1862b42A5758437CF26c3B76B9",
      signer: "0x42AfFF0c9366Eb1862b42A5758437CF26c3B76B9",
      tokenId: "venue-outcome-id",
      side: 0,
      price: "0.45",
      size: "1"
    }
  }
});

const harnessEnv = {
  ...liveReadyEnv,
  PREDICT_FUN_LIVE_SUBMIT_HARNESS_ENABLED: "true",
  PREDICT_FUN_LIVE_SUBMIT_OPERATOR_CONFIRM: predictFunLiveSubmitOperatorConfirmation,
  PREDICT_FUN_LIVE_SUBMIT_VENUE_MARKET_ID: "venue-market-id",
  PREDICT_FUN_LIVE_SUBMIT_VENUE_OUTCOME_ID: "venue-outcome-id",
  PREDICT_FUN_LIVE_SUBMIT_SIDE: "buy",
  PREDICT_FUN_LIVE_SUBMIT_SIZE: "1",
  PREDICT_FUN_LIVE_SUBMIT_PRICE: "0.45",
  PREDICT_FUN_LIVE_SUBMIT_MAX_SIZE: "1",
  PREDICT_FUN_LIVE_SUBMIT_SIGNER_ADDRESS: "0xD1059eC5F635712f6dcEAd569a41dFD7970DAffa",
  PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ADDRESS: "0x42AfFF0c9366Eb1862b42A5758437CF26c3B76B9",
  PREDICT_FUN_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON: validSignedPayload
};

describe("Predict.fun live-submit harness", () => {
  it("blocks unless explicit operator gates and signed payload are present", () => {
    const status = getPredictFunExecutionAdapterEnvStatus(liveReadyEnv);
    const plan = evaluatePredictFunLiveSubmitHarness({
      env: liveReadyEnv,
      adapterStatus: status
    });

    expect(plan.allowed).toBe(false);
    expect(plan.mode).toBe("DRY_RUN_CHECKLIST");
    expect(plan.blockers).toContain("PREDICT_FUN_LIVE_SUBMIT_HARNESS_ENABLED must be true");
    expect(plan.blockers).toContain("PREDICT_FUN_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON must be valid signed Predict.fun create-order JSON from the frontend signer");
  });

  it("blocks oversized orders", () => {
    const status = getPredictFunExecutionAdapterEnvStatus(harnessEnv);
    const plan = evaluatePredictFunLiveSubmitHarness({
      env: {
        ...harnessEnv,
        PREDICT_FUN_LIVE_SUBMIT_SIZE: "2"
      },
      adapterStatus: status
    });

    expect(plan.allowed).toBe(false);
    expect(plan.blockers).toContain("PREDICT_FUN_LIVE_SUBMIT_SIZE exceeds max size 1");
  });

  it("allows a tiny operator-confirmed user-signed relay checklist", () => {
    const status = getPredictFunExecutionAdapterEnvStatus(harnessEnv);
    const plan = evaluatePredictFunLiveSubmitHarness({
      env: harnessEnv,
      adapterStatus: status
    });

    expect(plan).toMatchObject({
      allowed: true,
      mode: "LIVE_SUBMIT_READY",
      safeConfig: {
        signedPayloadConfigured: true,
        signerAddressConfigured: true,
        venueAccountAddressConfigured: true
      }
    });
  });

  it("redacts signed payloads, signatures, and API keys from artifacts", () => {
    const redacted = redactSensitivePredictFunHarnessArtifactValue({
      apiKey: "server-side-predict-key",
      preparedOrder: {
        payload: {
          signedPayload: JSON.parse(validSignedPayload),
          data: {
            signature: `0x${"b".repeat(130)}`
          }
        }
      }
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("server-side-predict-key");
    expect(serialized).not.toContain("0xD1059eC5F635712f6dcEAd569a41dFD7970DAffa");
    expect(serialized).not.toContain("bbbb");
    expect(serialized).toContain("<redacted>");
  });
});
