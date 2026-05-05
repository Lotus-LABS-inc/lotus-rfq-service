import {
  buildPredictFunExecutionAdapterConfigFromEnv,
  getPredictFunExecutionAdapterEnvStatus,
  PredictFunExecutionAdapter,
  type UserSignedRelayExecutionAdapterEnvStatus
} from "./user-signed-relay-execution-adapter.js";
import type { PredictOauthCreateOrderPayload } from "../integrations/predict/predict-oauth-order-client.js";
import type { ExecutionLegV0 } from "./types.js";

export const predictFunLiveSubmitOperatorConfirmation =
  "I_UNDERSTAND_THIS_RELAYS_A_REAL_PREDICT_FUN_USER_SIGNED_ORDER";

export interface PredictFunLiveSubmitHarnessInput {
  env: NodeJS.ProcessEnv;
  adapterStatus: UserSignedRelayExecutionAdapterEnvStatus;
}

export interface PredictFunLiveSubmitHarnessPlan {
  enabled: boolean;
  allowed: boolean;
  mode: "BLOCKED" | "DRY_RUN_CHECKLIST" | "LIVE_SUBMIT_READY";
  blockers: string[];
  warnings: string[];
  safeConfig: {
    baseUrl: string | null;
    executionMode: string;
    side: "buy" | "sell" | null;
    size: string | null;
    price: number | null;
    venueMarketIdConfigured: boolean;
    venueOutcomeIdConfigured: boolean;
    signerAddressConfigured: boolean;
    venueAccountAddressConfigured: boolean;
    signedPayloadConfigured: boolean;
    maxSize: string;
  };
}

const nonEmpty = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const asSide = (value: string | undefined): "buy" | "sell" | null => {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : null;
};

const parsePositiveNumber = (value: string | undefined): number | null => {
  if (!nonEmpty(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isEvmAddress = (value: string | undefined): boolean =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

export const evaluatePredictFunLiveSubmitHarness = (
  input: PredictFunLiveSubmitHarnessInput
): PredictFunLiveSubmitHarnessPlan => {
  const { env, adapterStatus } = input;
  const enabled = env.PREDICT_FUN_LIVE_SUBMIT_HARNESS_ENABLED === "true";
  const blockers: string[] = [];
  const warnings: string[] = [];
  const side = asSide(env.PREDICT_FUN_LIVE_SUBMIT_SIDE);
  const size = parsePositiveNumber(env.PREDICT_FUN_LIVE_SUBMIT_SIZE);
  const maxSize = parsePositiveNumber(env.PREDICT_FUN_LIVE_SUBMIT_MAX_SIZE) ?? 1;
  const price = parsePositiveNumber(env.PREDICT_FUN_LIVE_SUBMIT_PRICE);
  const signedPayload = parseSignedPayloadJson(env.PREDICT_FUN_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON);

  if (!enabled) blockers.push("PREDICT_FUN_LIVE_SUBMIT_HARNESS_ENABLED must be true");
  if (!adapterStatus.featureFlagSelected) blockers.push("PREDICT_FUN_EXECUTION_MODE must be user_signed_backend_relay");
  if (!adapterStatus.liveExecutionEnabled) blockers.push("PREDICT_FUN_LIVE_EXECUTION_ENABLED must be true");
  if (adapterStatus.readinessState !== "LIVE_READY") {
    blockers.push(`Predict.fun adapter must be LIVE_READY; current state is ${adapterStatus.readinessState}`);
  }
  if (env.PREDICT_FUN_LIVE_SUBMIT_OPERATOR_CONFIRM !== predictFunLiveSubmitOperatorConfirmation) {
    blockers.push("PREDICT_FUN_LIVE_SUBMIT_OPERATOR_CONFIRM is missing or incorrect");
  }
  if (!nonEmpty(env.PREDICT_FUN_LIVE_SUBMIT_VENUE_MARKET_ID)) {
    blockers.push("PREDICT_FUN_LIVE_SUBMIT_VENUE_MARKET_ID is required");
  }
  if (!nonEmpty(env.PREDICT_FUN_LIVE_SUBMIT_VENUE_OUTCOME_ID)) {
    blockers.push("PREDICT_FUN_LIVE_SUBMIT_VENUE_OUTCOME_ID is required");
  }
  if (!side) blockers.push("PREDICT_FUN_LIVE_SUBMIT_SIDE must be buy or sell");
  if (!size) blockers.push("PREDICT_FUN_LIVE_SUBMIT_SIZE must be a positive number");
  if (size && size > maxSize) {
    blockers.push(`PREDICT_FUN_LIVE_SUBMIT_SIZE exceeds max size ${maxSize}`);
  }
  if (!price || price <= 0 || price >= 1) {
    blockers.push("PREDICT_FUN_LIVE_SUBMIT_PRICE must be greater than 0 and less than 1");
  }
  if (!isEvmAddress(env.PREDICT_FUN_LIVE_SUBMIT_SIGNER_ADDRESS)) {
    blockers.push("PREDICT_FUN_LIVE_SUBMIT_SIGNER_ADDRESS must be an EVM address for the active Turnkey wallet");
  }
  if (!isEvmAddress(env.PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ADDRESS)) {
    blockers.push("PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ADDRESS must be the active Predict.fun account address");
  }
  if (!signedPayload) {
    blockers.push("PREDICT_FUN_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON must be valid signed Predict.fun create-order JSON from the frontend signer");
  }

  if (!enabled) {
    warnings.push("Harness is disabled; this run is a checklist only and cannot submit.");
  }
  warnings.push("Backend never signs Predict.fun orders; only relay a frontend Turnkey-signed payload.");
  warnings.push("Use the smallest possible operator-approved order; submit success is not settlement.");

  return {
    enabled,
    allowed: blockers.length === 0,
    mode: blockers.length === 0 ? "LIVE_SUBMIT_READY" : enabled ? "BLOCKED" : "DRY_RUN_CHECKLIST",
    blockers,
    warnings,
    safeConfig: {
      baseUrl: env.PREDICT_MAINNET_BASE_URL ?? null,
      executionMode: adapterStatus.featureFlagSelected ? "user_signed_backend_relay" : "disabled",
      side,
      size: size === null ? null : String(size),
      price,
      venueMarketIdConfigured: nonEmpty(env.PREDICT_FUN_LIVE_SUBMIT_VENUE_MARKET_ID),
      venueOutcomeIdConfigured: nonEmpty(env.PREDICT_FUN_LIVE_SUBMIT_VENUE_OUTCOME_ID),
      signerAddressConfigured: isEvmAddress(env.PREDICT_FUN_LIVE_SUBMIT_SIGNER_ADDRESS),
      venueAccountAddressConfigured: isEvmAddress(env.PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ADDRESS),
      signedPayloadConfigured: Boolean(signedPayload),
      maxSize: String(maxSize)
    }
  };
};

const buildPredictFunLiveSubmitHarnessLeg = (env: NodeJS.ProcessEnv): ExecutionLegV0 => ({
  executionLegId: env.PREDICT_FUN_LIVE_SUBMIT_EXECUTION_LEG_ID ?? `predictfun-live-harness-${Date.now()}`,
  parentExecutionId: env.PREDICT_FUN_LIVE_SUBMIT_EXECUTION_ID ?? `predictfun-live-harness-parent-${Date.now()}`,
  venue: "PREDICT_FUN",
  venueMarketId: env.PREDICT_FUN_LIVE_SUBMIT_VENUE_MARKET_ID!,
  venueOutcomeId: env.PREDICT_FUN_LIVE_SUBMIT_VENUE_OUTCOME_ID!,
  side: asSide(env.PREDICT_FUN_LIVE_SUBMIT_SIDE)!,
  size: env.PREDICT_FUN_LIVE_SUBMIT_SIZE!,
  price: Number(env.PREDICT_FUN_LIVE_SUBMIT_PRICE),
  status: "CREATED",
  settlementStatus: "SETTLEMENT_PENDING"
});

const parseSignedPayloadJson = (value: string | undefined): PredictOauthCreateOrderPayload | null => {
  if (!nonEmpty(value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as PredictOauthCreateOrderPayload;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

const buildRelayPreparedOrder = (
  preparedOrder: Awaited<ReturnType<PredictFunExecutionAdapter["prepareOrder"]>>,
  env: NodeJS.ProcessEnv
) => ({
  ...preparedOrder,
  payload: {
    ...preparedOrder.payload,
    expectedBinding: {
      userId: env.PREDICT_FUN_LIVE_SUBMIT_USER_ID ?? "polymarket-funding-test-user",
      signerAddress: env.PREDICT_FUN_LIVE_SUBMIT_SIGNER_ADDRESS!,
      ...(nonEmpty(env.PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ID)
        ? { venueAccountId: env.PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ID }
        : {}),
      venueAccountAddress: env.PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ADDRESS!
    },
    signedPayload: parseSignedPayloadJson(env.PREDICT_FUN_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON)!
  }
});

const sensitiveArtifactKeys = [
  /^api[-_]?key$/i,
  /^api[-_]?secret$/i,
  /^private[-_]?key$/i,
  /^auth[-_]?header$/i,
  /^authorization$/i,
  /^signature$/i,
  /^signed[-_]?payload$/i,
  /^token$/i,
  /^access[-_]?token$/i,
  /^refresh[-_]?token$/i,
  /^secret$/i
];

export const redactSensitivePredictFunHarnessArtifactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitivePredictFunHarnessArtifactValue(entry));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveArtifactKeys.some((pattern) => pattern.test(key))
        ? "<redacted>"
        : redactSensitivePredictFunHarnessArtifactValue(child)
    ])
  );
};

export const runPredictFunLiveSubmitHarness = async (
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  plan: PredictFunLiveSubmitHarnessPlan;
  submitted: boolean;
  preparedOrder?: unknown;
  submitResult?: unknown;
  fillState?: unknown;
  settlementState?: unknown;
  settlementVerified?: boolean;
  error?: { code: string; message: string };
}> => {
  const config = buildPredictFunExecutionAdapterConfigFromEnv(env);
  const adapter = new PredictFunExecutionAdapter(config);
  const plan = evaluatePredictFunLiveSubmitHarness({
    env,
    adapterStatus: getPredictFunExecutionAdapterEnvStatus(env)
  });
  if (!plan.allowed) {
    return { plan, submitted: false };
  }
  const preparedOrder = buildRelayPreparedOrder(
    await adapter.prepareOrder(buildPredictFunLiveSubmitHarnessLeg(env)),
    env
  );
  const safePreparedOrder = redactSensitivePredictFunHarnessArtifactValue(preparedOrder);
  const submitResult = await adapter.submitOrder(preparedOrder).catch((error: unknown) => {
    const normalized = adapter.normalizeVenueError(error);
    return {
      __failed: true as const,
      error: {
        code: normalized.code,
        message: normalized.message
      }
    };
  });
  if (typeof submitResult === "object" && submitResult !== null && "__failed" in submitResult) {
    return {
      plan,
      submitted: false,
      preparedOrder: safePreparedOrder,
      error: submitResult.error
    };
  }
  const submittedRecord = typeof submitResult === "object" && submitResult !== null ? submitResult as { venueOrderId?: unknown } : {};
  const venueOrderId = typeof submittedRecord.venueOrderId === "string" ? submittedRecord.venueOrderId : null;
  const fillState = venueOrderId
    ? await adapter.fetchFillState(venueOrderId).catch((error: unknown) => ({
        __failed: true,
        error: adapter.normalizeVenueError(error)
      }))
    : null;
  const settlementState = venueOrderId
    ? await adapter.fetchSettlementState(venueOrderId).catch((error: unknown) => ({
        __failed: true,
        error: adapter.normalizeVenueError(error)
      }))
    : null;
  return {
    plan,
    submitted: true,
    preparedOrder: safePreparedOrder,
    submitResult,
    fillState,
    settlementState,
    settlementVerified: Boolean(
      typeof settlementState === "object"
      && settlementState !== null
      && "status" in settlementState
      && settlementState.status === "SETTLEMENT_VERIFIED"
    )
  };
};
