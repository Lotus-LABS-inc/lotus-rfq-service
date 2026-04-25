import {
  buildPolymarketExecutionAdapterV2ConfigFromEnv,
  PolymarketExecutionAdapterV2,
  type PolymarketExecutionAdapterV2EnvStatus
} from "./polymarket-execution-adapter-v2.js";
import type { ExecutionLegV0 } from "./types.js";

export const polymarketLiveSubmitOperatorConfirmation =
  "I_UNDERSTAND_THIS_PLACES_A_REAL_POLYMARKET_ORDER";

export interface PolymarketLiveSubmitHarnessInput {
  env: NodeJS.ProcessEnv;
  adapterStatus: PolymarketExecutionAdapterV2EnvStatus;
}

export interface PolymarketLiveSubmitHarnessPlan {
  enabled: boolean;
  allowed: boolean;
  mode: "BLOCKED" | "DRY_RUN_CHECKLIST" | "LIVE_SUBMIT_READY";
  blockers: string[];
  warnings: string[];
  safeConfig: {
    clobHost: string | null;
    chainId: string | null;
    side: "buy" | "sell" | null;
    size: string | null;
    price: number | null;
    venueMarketIdConfigured: boolean;
    venueOutcomeIdConfigured: boolean;
    maxSize: string;
    mainnetRequiresExtraAck: boolean;
  };
}

const nonEmpty = (value: string | undefined): boolean =>
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

export const evaluatePolymarketLiveSubmitHarness = (
  input: PolymarketLiveSubmitHarnessInput
): PolymarketLiveSubmitHarnessPlan => {
  const { env, adapterStatus } = input;
  const enabled = env.POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED === "true";
  const blockers: string[] = [];
  const warnings: string[] = [];
  const chainId = env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID ?? null;
  const clobHost = env.POLYMARKET_CLOB_HOST ?? env.POLY_CLOB_HOST ?? null;
  const side = asSide(env.POLYMARKET_LIVE_SUBMIT_SIDE);
  const size = parsePositiveNumber(env.POLYMARKET_LIVE_SUBMIT_SIZE);
  const maxSize = parsePositiveNumber(env.POLYMARKET_LIVE_SUBMIT_MAX_SIZE) ?? 1;
  const price = parsePositiveNumber(env.POLYMARKET_LIVE_SUBMIT_PRICE);
  const mainnetRequiresExtraAck = chainId === "137";

  if (!enabled) blockers.push("POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED must be true");
  if (!adapterStatus.featureFlagSelected) blockers.push("POLYMARKET_EXECUTION_MODE must be v2");
  if (!adapterStatus.liveExecutionEnabled) blockers.push("POLYMARKET_LIVE_EXECUTION_ENABLED must be true");
  if (adapterStatus.readinessState !== "LIVE_READY") {
    blockers.push(`Polymarket adapter must be LIVE_READY; current state is ${adapterStatus.readinessState}`);
  }
  if (env.POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM !== polymarketLiveSubmitOperatorConfirmation) {
    blockers.push("POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM is missing or incorrect");
  }
  if (mainnetRequiresExtraAck && env.POLYMARKET_LIVE_SUBMIT_MAINNET_ACK !== "true") {
    blockers.push("POLYMARKET_LIVE_SUBMIT_MAINNET_ACK must be true for Polygon mainnet");
  }
  if (!nonEmpty(env.POLYMARKET_LIVE_SUBMIT_VENUE_MARKET_ID)) {
    blockers.push("POLYMARKET_LIVE_SUBMIT_VENUE_MARKET_ID is required");
  }
  if (!nonEmpty(env.POLYMARKET_LIVE_SUBMIT_VENUE_OUTCOME_ID)) {
    blockers.push("POLYMARKET_LIVE_SUBMIT_VENUE_OUTCOME_ID is required");
  }
  if (!side) blockers.push("POLYMARKET_LIVE_SUBMIT_SIDE must be buy or sell");
  if (!size) blockers.push("POLYMARKET_LIVE_SUBMIT_SIZE must be a positive number");
  if (size && size > maxSize) {
    blockers.push(`POLYMARKET_LIVE_SUBMIT_SIZE exceeds max size ${maxSize}`);
  }
  if (!price || price <= 0 || price >= 1) {
    blockers.push("POLYMARKET_LIVE_SUBMIT_PRICE must be greater than 0 and less than 1");
  }

  if (!enabled) {
    warnings.push("Harness is disabled; this run is a checklist only and cannot submit.");
  }
  if (mainnetRequiresExtraAck) {
    warnings.push("Polygon mainnet detected; use the smallest possible operator-approved order.");
  }

  return {
    enabled,
    allowed: blockers.length === 0,
    mode: blockers.length === 0 ? "LIVE_SUBMIT_READY" : enabled ? "BLOCKED" : "DRY_RUN_CHECKLIST",
    blockers,
    warnings,
    safeConfig: {
      clobHost,
      chainId,
      side,
      size: size === null ? null : String(size),
      price,
      venueMarketIdConfigured: nonEmpty(env.POLYMARKET_LIVE_SUBMIT_VENUE_MARKET_ID),
      venueOutcomeIdConfigured: nonEmpty(env.POLYMARKET_LIVE_SUBMIT_VENUE_OUTCOME_ID),
      maxSize: String(maxSize),
      mainnetRequiresExtraAck
    }
  };
};

export const buildPolymarketLiveSubmitHarnessLeg = (env: NodeJS.ProcessEnv): ExecutionLegV0 => ({
  executionLegId: env.POLYMARKET_LIVE_SUBMIT_EXECUTION_LEG_ID ?? `polymarket-live-harness-${Date.now()}`,
  parentExecutionId: env.POLYMARKET_LIVE_SUBMIT_EXECUTION_ID ?? `polymarket-live-harness-parent-${Date.now()}`,
  venue: "POLYMARKET",
  venueMarketId: env.POLYMARKET_LIVE_SUBMIT_VENUE_MARKET_ID!,
  venueOutcomeId: env.POLYMARKET_LIVE_SUBMIT_VENUE_OUTCOME_ID!,
  side: asSide(env.POLYMARKET_LIVE_SUBMIT_SIDE)!,
  size: env.POLYMARKET_LIVE_SUBMIT_SIZE!,
  price: Number(env.POLYMARKET_LIVE_SUBMIT_PRICE),
  status: "CREATED",
  settlementStatus: "SETTLEMENT_PENDING"
});

export const runPolymarketLiveSubmitHarness = async (
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  plan: PolymarketLiveSubmitHarnessPlan;
  submitted: boolean;
  preparedOrder?: unknown;
  submitResult?: unknown;
  error?: { code: string; message: string; status?: number };
}> => {
  const config = buildPolymarketExecutionAdapterV2ConfigFromEnv(env);
  const adapter = new PolymarketExecutionAdapterV2(config);
  const plan = evaluatePolymarketLiveSubmitHarness({ env, adapterStatus: adapter.status() });
  if (!plan.allowed) {
    return { plan, submitted: false };
  }
  const preparedOrder = await adapter.prepareOrder(buildPolymarketLiveSubmitHarnessLeg(env));
  const safePreparedOrder = {
    venue: preparedOrder.venue,
    clientOrderId: preparedOrder.clientOrderId,
    payload: {
      venueMarketId: preparedOrder.payload.venueMarketId,
      venueOutcomeId: preparedOrder.payload.venueOutcomeId,
      side: preparedOrder.payload.side,
      size: preparedOrder.payload.size,
      price: preparedOrder.payload.price,
      metadata: preparedOrder.payload.metadata
    }
  };
  const submitResult = await adapter.submitOrder(preparedOrder).catch((error: unknown) => {
    const normalized = adapter.normalizeVenueError(error);
    const status = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
    return {
      __failed: true as const,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(status !== undefined ? { status } : {})
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
  return {
    plan,
    submitted: true,
    preparedOrder: safePreparedOrder,
    submitResult
  };
};
