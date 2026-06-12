import { createHash } from "node:crypto";

export const FLOW_SEGMENTATION_VERSION = "flow-segmentation-v1";

export const flowSegments = ["soft", "standard"] as const;
export type FlowSegment = (typeof flowSegments)[number];

export type RoutingPath = "UI" | "API" | "PARTNER";

export interface FlowSegmentationInput {
  canonicalMarketId: string;
  canonicalEventId: string;
  canonicalFamily?: string | null;
  category?: string | null;
  side: "buy" | "sell";
  quantity: string;
  routingPath?: RoutingPath;
  marketLiquidity?: string | number | null;
  timestamp: Date;
}

export interface FlowSegmentationDecision {
  flowSegment: FlowSegment;
  version: typeof FLOW_SEGMENTATION_VERSION;
  score: number;
  reasonCodes: readonly string[];
  inputHash: string;
}

export class RFQLaneNotPromotedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RFQLaneNotPromotedError";
  }
}

const SOFT_THRESHOLD = 50;

const positiveFamilies = new Set(["NOMINEE", "SEASON_WINNER", "ELECTION"]);
const toxicFamilies = new Set(["SAME_DAY_DIRECTIONAL", "FDV_LAUNCH"]);

const normalizeToken = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : null;
};

const inferCanonicalFamily = (input: FlowSegmentationInput): string | null => {
  const explicit = normalizeToken(input.canonicalFamily) ?? normalizeToken(input.category);
  if (explicit) return explicit;
  const market = normalizeToken(input.canonicalMarketId);
  if (!market) return null;
  for (const family of [...positiveFamilies, ...toxicFamilies]) {
    if (market.includes(family)) return family;
  }
  if (market.includes("ATH_BY_DATE")) return "ATH_BY_DATE";
  if (market.includes("FDV")) return "FDV_LAUNCH";
  return null;
};

const parsePositiveNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const stableHash = (payload: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

export class FlowSegmentationService {
  public segment(input: FlowSegmentationInput): FlowSegmentationDecision {
    if (!input.canonicalEventId.trim()) {
      throw new RFQLaneNotPromotedError("RFQ requires a promoted canonical event lane before flow segmentation.");
    }

    const routingPath = input.routingPath ?? "UI";
    const family = inferCanonicalFamily(input);
    const quantity = parsePositiveNumber(input.quantity);
    const liquidity = parsePositiveNumber(input.marketLiquidity);
    const reasonCodes: string[] = [];
    let score = 0;

    if (family && positiveFamilies.has(family)) {
      score += 40;
      reasonCodes.push(`family:${family}:+40`);
    } else if (family && toxicFamilies.has(family)) {
      score -= 30;
      reasonCodes.push(`family:${family}:-30`);
    } else {
      reasonCodes.push("family:neutral:0");
    }

    if (quantity !== null && liquidity !== null) {
      const ratio = quantity / liquidity;
      if (ratio > 0.15) {
        score += 25;
        reasonCodes.push("size:gt_15pct_liquidity:+25");
      } else if (ratio < 0.03) {
        score -= 15;
        reasonCodes.push("size:lt_3pct_liquidity:-15");
      } else {
        reasonCodes.push("size:within_liquidity_band:0");
      }
    } else {
      reasonCodes.push("size:liquidity_unknown:0");
    }

    if (routingPath === "UI") {
      score += 20;
      reasonCodes.push("routing_path:UI:+20");
    } else if (routingPath === "PARTNER") {
      score += 10;
      reasonCodes.push("routing_path:PARTNER:+10");
    } else {
      reasonCodes.push("routing_path:API:0");
    }

    const hashInput = {
      canonicalMarketId: input.canonicalMarketId,
      canonicalEventId: input.canonicalEventId,
      canonicalFamily: family,
      category: normalizeToken(input.category),
      side: input.side,
      quantity: input.quantity,
      routingPath,
      marketLiquidity: liquidity,
      timestampBucket: input.timestamp.toISOString().slice(0, 13)
    };

    return {
      flowSegment: score >= SOFT_THRESHOLD ? "soft" : "standard",
      version: FLOW_SEGMENTATION_VERSION,
      score,
      reasonCodes,
      inputHash: stableHash(hashInput)
    };
  }
}

export const readFlowSegment = (metadata: Readonly<Record<string, unknown>> | undefined): FlowSegment | null => {
  const value = metadata?.flow_segment ?? metadata?.flowSegment;
  return value === "soft" || value === "standard" ? value : null;
};

export const readFlowSegmentVersion = (
  metadata: Readonly<Record<string, unknown>> | undefined
): string | null => {
  const value = metadata?.flow_segment_version ?? metadata?.flowSegmentVersion;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

export const readFlowSegmentInputHash = (
  metadata: Readonly<Record<string, unknown>> | undefined
): string | null => {
  const value = metadata?.flow_segment_input_hash ?? metadata?.flowSegmentInputHash;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

export const readAllowedFlowSegments = (
  metadata: Readonly<Record<string, unknown>> | undefined
): readonly FlowSegment[] => {
  const raw = metadata?.flow_segments ?? metadata?.flowSegments;
  if (!Array.isArray(raw)) return ["standard"];
  const values = raw.filter((entry): entry is FlowSegment => entry === "soft" || entry === "standard");
  return values.length > 0 ? [...new Set(values)] : ["standard"];
};

export class FlowSegmentValidationError extends Error {
  public constructor(
    public readonly code: "flow_segment_invalid" | "maker_not_subscribed_to_flow_segment",
    message: string
  ) {
    super(message);
    this.name = "FlowSegmentValidationError";
  }
}

export const assertMakerCanQuoteFlowSegment = (
  flowSegment: FlowSegment,
  lpKeyMetadata: Readonly<Record<string, unknown>> | undefined
): void => {
  const allowedSegments = readAllowedFlowSegments(lpKeyMetadata);
  if (!allowedSegments.includes(flowSegment)) {
    throw new FlowSegmentValidationError(
      "maker_not_subscribed_to_flow_segment",
      `LP key is not subscribed to ${flowSegment} RFQ flow.`
    );
  }
};
