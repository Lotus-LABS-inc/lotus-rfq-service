export const monetizationModes = ["DISABLED", "SHADOW", "ENFORCED"] as const;
export type MonetizationMode = (typeof monetizationModes)[number];

export const monetizationCaptureModes = [
  "DISABLED",
  "SHADOW",
  "BUILDER_FEE_ONLY",
  "SHADOW_PLUS_BUILDER_FEE",
  "SMART_FEE_ROUTER_PLANNED"
] as const;
export type MonetizationCaptureMode = (typeof monetizationCaptureModes)[number];

export const monetizationRevenueSources = [
  "POLYMARKET_BUILDER_FEE",
  "VENUE_BUILDER_FEE",
  "SHADOW_PRICE_IMPROVEMENT",
  "MANUAL_INVOICE_PLANNED",
  "SMART_FEE_ROUTER_PLANNED"
] as const;
export type MonetizationRevenueSource = (typeof monetizationRevenueSources)[number];

export interface MonetizationPolicy {
  mode: MonetizationMode;
  policyVersion: string;
  currency: string;
  priceImprovementShareBps: number;
  shareImprovementShareBps: number;
  executionFeeBps: number;
  fastLaneFeeBps: number;
  ghostFillProtectionFeeBps: number;
  maxTotalFeeBps: number;
  captureMode: MonetizationCaptureMode;
}

const parseEnum = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  label: string
): T => {
  const normalized = `${value ?? fallback}`.trim().toUpperCase();
  if (allowed.includes(normalized as T)) {
    return normalized as T;
  }
  throw new Error(`${label} must be one of ${allowed.join(", ")}.`);
};

const parseBps = (value: string | undefined, fallback: number, label: string): number => {
  const parsed = Number.parseInt(`${value ?? fallback}`, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error(`${label} must be an integer between 0 and 10000.`);
  }
  return parsed;
};

const parseCaptureMode = (
  value: string | undefined,
  mode: MonetizationMode
): MonetizationCaptureMode => {
  const normalized = `${value ?? ""}`.trim().toUpperCase();
  if (normalized.length === 0) {
    return mode === "DISABLED" ? "DISABLED" : "SHADOW";
  }
  if (normalized === "LEDGER_ONLY") {
    return "SHADOW";
  }
  if (normalized === "INVOICE") {
    throw new Error("MONETIZATION_CAPTURE_MODE=INVOICE is not supported for private beta; use SHADOW or SHADOW_PLUS_BUILDER_FEE.");
  }
  if (normalized === "SETTLEMENT_DEDUCTION") {
    throw new Error("MONETIZATION_CAPTURE_MODE=SETTLEMENT_DEDUCTION is not supported for private beta.");
  }
  return parseEnum(normalized, monetizationCaptureModes, "DISABLED", "MONETIZATION_CAPTURE_MODE");
};

export const isBuilderFeeCaptureEnabled = (policy: Pick<MonetizationPolicy, "captureMode">): boolean =>
  policy.captureMode === "BUILDER_FEE_ONLY" || policy.captureMode === "SHADOW_PLUS_BUILDER_FEE";

export const isShadowImprovementEnabled = (policy: Pick<MonetizationPolicy, "captureMode">): boolean =>
  policy.captureMode !== "DISABLED";

export const getMonetizationPolicyFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): MonetizationPolicy => {
  const mode = parseEnum(env.MONETIZATION_MODE, monetizationModes, "DISABLED", "MONETIZATION_MODE");
  const captureMode = parseCaptureMode(env.MONETIZATION_CAPTURE_MODE, mode);
  return {
    mode: captureMode === "DISABLED" ? "DISABLED" : mode === "DISABLED" ? "SHADOW" : mode,
    policyVersion: env.MONETIZATION_POLICY_VERSION?.trim() || "lotus-fees-v1",
    currency: env.MONETIZATION_DEFAULT_CURRENCY?.trim() || "USDC",
    priceImprovementShareBps: parseBps(env.MONETIZATION_PRICE_IMPROVEMENT_SHARE_BPS, 3000, "MONETIZATION_PRICE_IMPROVEMENT_SHARE_BPS"),
    shareImprovementShareBps: parseBps(env.MONETIZATION_SHARE_IMPROVEMENT_SHARE_BPS, 4000, "MONETIZATION_SHARE_IMPROVEMENT_SHARE_BPS"),
    executionFeeBps: parseBps(env.MONETIZATION_EXECUTION_FEE_BPS, 0, "MONETIZATION_EXECUTION_FEE_BPS"),
    fastLaneFeeBps: parseBps(env.MONETIZATION_FAST_LANE_FEE_BPS, 500, "MONETIZATION_FAST_LANE_FEE_BPS"),
    ghostFillProtectionFeeBps: parseBps(env.MONETIZATION_GHOST_FILL_PROTECTION_FEE_BPS, 500, "MONETIZATION_GHOST_FILL_PROTECTION_FEE_BPS"),
    maxTotalFeeBps: parseBps(env.MONETIZATION_MAX_TOTAL_FEE_BPS, 75, "MONETIZATION_MAX_TOTAL_FEE_BPS"),
    captureMode
  };
};
