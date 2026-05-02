import {
  buildLimitlessExecutionAdapterConfigFromEnv,
  getLimitlessExecutionAdapterEnvStatus,
  LimitlessExecutionAdapter,
  type LimitlessExecutionAdapterEnvStatus
} from "./limitless-execution-adapter.js";
import type { ExecutionLegV0 } from "./types.js";

export const limitlessLiveSubmitOperatorConfirmation =
  "I_UNDERSTAND_THIS_PLACES_A_REAL_LIMITLESS_ORDER";

export interface LimitlessLiveSubmitHarnessInput {
  env: NodeJS.ProcessEnv;
  adapterStatus: LimitlessExecutionAdapterEnvStatus;
}

export interface LimitlessLiveSubmitHarnessPlan {
  enabled: boolean;
  allowed: boolean;
  mode: "BLOCKED" | "DRY_RUN_CHECKLIST" | "LIVE_SUBMIT_READY";
  blockers: string[];
  warnings: string[];
  safeConfig: {
    baseUrl: string | null;
    side: "buy" | "sell" | null;
    size: string | null;
    price: number | null;
    venueMarketIdConfigured: boolean;
    venueOutcomeIdConfigured: boolean;
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

export const evaluateLimitlessLiveSubmitHarness = (
  input: LimitlessLiveSubmitHarnessInput
): LimitlessLiveSubmitHarnessPlan => {
  const { env, adapterStatus } = input;
  const enabled = env.LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED === "true";
  const blockers: string[] = [];
  const warnings: string[] = [];
  const side = asSide(env.LIMITLESS_LIVE_SUBMIT_SIDE);
  const size = parsePositiveNumber(env.LIMITLESS_LIVE_SUBMIT_SIZE);
  const maxSize = parsePositiveNumber(env.LIMITLESS_LIVE_SUBMIT_MAX_SIZE) ?? 1;
  const price = parsePositiveNumber(env.LIMITLESS_LIVE_SUBMIT_PRICE);

  if (!enabled) blockers.push("LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED must be true");
  if (!adapterStatus.featureFlagSelected) blockers.push("LIMITLESS_EXECUTION_MODE must be backend_signer");
  if (!adapterStatus.liveExecutionEnabled) blockers.push("LIMITLESS_LIVE_EXECUTION_ENABLED must be true");
  if (adapterStatus.readinessState !== "LIVE_READY") {
    blockers.push(`Limitless adapter must be LIVE_READY; current state is ${adapterStatus.readinessState}`);
  }
  if (env.LIMITLESS_LIVE_SUBMIT_OPERATOR_CONFIRM !== limitlessLiveSubmitOperatorConfirmation) {
    blockers.push("LIMITLESS_LIVE_SUBMIT_OPERATOR_CONFIRM is missing or incorrect");
  }
  if (!nonEmpty(env.LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID)) {
    blockers.push("LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID is required");
  }
  if (!nonEmpty(env.LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID)) {
    blockers.push("LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID is required");
  }
  if (!side) blockers.push("LIMITLESS_LIVE_SUBMIT_SIDE must be buy or sell");
  if (!size) blockers.push("LIMITLESS_LIVE_SUBMIT_SIZE must be a positive number");
  if (size && size > maxSize) {
    blockers.push(`LIMITLESS_LIVE_SUBMIT_SIZE exceeds max size ${maxSize}`);
  }
  if (!price || price <= 0 || price >= 1) {
    blockers.push("LIMITLESS_LIVE_SUBMIT_PRICE must be greater than 0 and less than 1");
  }

  if (!enabled) {
    warnings.push("Harness is disabled; this run is a checklist only and cannot submit.");
  }
  warnings.push("Use the smallest possible operator-approved order; Limitless settlement evidence is still separately reviewed.");

  return {
    enabled,
    allowed: blockers.length === 0,
    mode: blockers.length === 0 ? "LIVE_SUBMIT_READY" : enabled ? "BLOCKED" : "DRY_RUN_CHECKLIST",
    blockers,
    warnings,
    safeConfig: {
      baseUrl: env.LIMITLESS_BASE_URL ?? null,
      side,
      size: size === null ? null : String(size),
      price,
      venueMarketIdConfigured: nonEmpty(env.LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID),
      venueOutcomeIdConfigured: nonEmpty(env.LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID),
      maxSize: String(maxSize)
    }
  };
};

const buildLimitlessLiveSubmitHarnessLeg = (env: NodeJS.ProcessEnv): ExecutionLegV0 => ({
  executionLegId: env.LIMITLESS_LIVE_SUBMIT_EXECUTION_LEG_ID ?? `limitless-live-harness-${Date.now()}`,
  parentExecutionId: env.LIMITLESS_LIVE_SUBMIT_EXECUTION_ID ?? `limitless-live-harness-parent-${Date.now()}`,
  venue: "LIMITLESS",
  venueMarketId: env.LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID!,
  venueOutcomeId: env.LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID!,
  side: asSide(env.LIMITLESS_LIVE_SUBMIT_SIDE)!,
  size: env.LIMITLESS_LIVE_SUBMIT_SIZE!,
  price: Number(env.LIMITLESS_LIVE_SUBMIT_PRICE),
  status: "CREATED",
  settlementStatus: "SETTLEMENT_PENDING"
});

const sensitiveArtifactKeys = [
  /^api[-_]?key$/i,
  /^api[-_]?secret$/i,
  /^private[-_]?key$/i,
  /^auth[-_]?header$/i,
  /^authorization$/i,
  /^signature$/i
];

export const redactSensitiveLimitlessHarnessArtifactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveLimitlessHarnessArtifactValue(entry));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveArtifactKeys.some((pattern) => pattern.test(key))
        ? "<redacted>"
        : redactSensitiveLimitlessHarnessArtifactValue(child)
    ])
  );
};

export const runLimitlessLiveSubmitHarness = async (
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  plan: LimitlessLiveSubmitHarnessPlan;
  submitted: boolean;
  preparedOrder?: unknown;
  submitResult?: unknown;
  error?: { code: string; message: string };
}> => {
  const config = buildLimitlessExecutionAdapterConfigFromEnv(env);
  const adapter = new LimitlessExecutionAdapter(config);
  const plan = evaluateLimitlessLiveSubmitHarness({
    env,
    adapterStatus: getLimitlessExecutionAdapterEnvStatus(env)
  });
  if (!plan.allowed) {
    return { plan, submitted: false };
  }
  const preparedOrder = await adapter.prepareOrder(buildLimitlessLiveSubmitHarnessLeg(env));
  const safePreparedOrder = redactSensitiveLimitlessHarnessArtifactValue(preparedOrder);
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
  return {
    plan,
    submitted: true,
    preparedOrder: safePreparedOrder,
    submitResult
  };
};
