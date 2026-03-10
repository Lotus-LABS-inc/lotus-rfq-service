import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CanonicalRFQInputSchema,
  LiquiditySource,
  RouteCandidateSchema,
  SelectedQuoteInputSchema,
  type CanonicalRFQInput,
  type IRouteScout,
  type RouteCandidate,
  type SORAcceptancePolicy,
  type SelectedQuoteInput
} from "./types.js";
import { withSpan } from "../../observability/tracing.js";

const RFQLegSchema = z.object({
  leg_id: z.string().uuid(),
  canonical_market_id: z.string(),
  canonical_outcome_id: z.string().optional(),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive()
});

const RouteScoutInputSchema = z.object({
  rfq: CanonicalRFQInputSchema,
  selectedQuote: SelectedQuoteInputSchema,
  policy: z.enum(["ALL_OR_NONE", "PARTIAL_ALLOWED", "BEST_EFFORT"]),
  options: z
    .object({
      forceRefresh: z.boolean().optional()
    })
    .optional()
});

const RouteCandidateArraySchema = z.array(RouteCandidateSchema);

interface WholeComboQuote {
  quoteId: string;
  providerId: string;
  providerType?: "LP";
  availableSize: number;
  quotedPrice: number;
  fees?: Readonly<Record<string, number>>;
  latencyMs?: number;
  fillProb?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

interface PerLegQuote {
  quoteId: string;
  providerId: string;
  providerType?: "LP";
  legId: string;
  availableSize: number;
  quotedPrice: number;
  fees?: Readonly<Record<string, number>>;
  latencyMs?: number;
  fillProb?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

interface InternalCrossingHint {
  hintId: string;
  providerId: string;
  availableSize: number;
  quotedPrice: number;
  fees?: Readonly<Record<string, number>>;
  latencyMs?: number;
  fillProb?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

interface CanonicalOrderbookSnapshot {
  snapshotId?: string;
  availableSize: number;
  quotedPrice: number;
  fees?: Readonly<Record<string, number>>;
  latencyMs?: number;
  fillProb?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

interface RouteScoutRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", duration: number): Promise<"OK" | null>;
}

interface RouteScoutLPSource {
  getWholeComboQuotes(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<readonly WholeComboQuote[]>;
  getPerLegQuotes(
    rfq: CanonicalRFQInput,
    legId: string
  ): Promise<readonly PerLegQuote[]>;
}

interface RouteScoutCanonicalClient {
  getOrderbookSnapshot(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string;
    side: "buy" | "sell";
    quantity: number;
  }): Promise<CanonicalOrderbookSnapshot | null>;
}

interface RouteScoutInternalCrossingSource {
  getCrossingHints(input: {
    rfq: CanonicalRFQInput;
    leg: z.infer<typeof RFQLegSchema>;
    selectedQuote: SelectedQuoteInput;
  }): Promise<readonly InternalCrossingHint[]>;
}

export interface RouteScoutDependencies {
  redis: RouteScoutRedisClient;
  lpSource: RouteScoutLPSource;
  canonicalClient: RouteScoutCanonicalClient;
  internalCrossingSource?: RouteScoutInternalCrossingSource;
  cacheTtlMs?: number;
}

export class RouteScout implements IRouteScout {
  private readonly cacheTtlMs: number;

  public constructor(private readonly deps: RouteScoutDependencies) {
    this.cacheTtlMs = this.clampCacheTtlMs(deps.cacheTtlMs ?? 500);
  }

  public async discoverCandidates(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy,
    options?: { forceRefresh?: boolean }
  ): Promise<readonly RouteCandidate[]> {
    return withSpan(
      "sor.route_scout",
      {
        rfq_id: rfq.rfqId,
        acceptance_policy: policy,
        state: "SCOUTING"
      },
      async () => {
        const parsed = RouteScoutInputSchema.parse({
          rfq,
          selectedQuote,
          policy,
          options
        });

        const forceRefresh = parsed.options?.forceRefresh ?? false;
        const cacheKey = this.cacheKey(parsed.rfq.rfqId, parsed.selectedQuote.quoteId, parsed.policy);

        if (!forceRefresh) {
          const cached = await this.deps.redis.get(cacheKey);
          if (cached) {
            return RouteCandidateArraySchema.parse(JSON.parse(cached));
          }
        }

        const legs = this.extractLegs(parsed.rfq);
        const wholeComboQuotes = await this.deps.lpSource.getWholeComboQuotes(
          parsed.rfq,
          parsed.selectedQuote,
          parsed.policy
        );

        const result: RouteCandidate[] = [];
        for (const leg of legs) {
          const perLegQuotes = await this.deps.lpSource.getPerLegQuotes(parsed.rfq, leg.leg_id);
          const orderbookSnapshot = await this.deps.canonicalClient.getOrderbookSnapshot({
            canonicalMarketId: leg.canonical_market_id,
            ...(leg.canonical_outcome_id ? { canonicalOutcomeId: leg.canonical_outcome_id } : {}),
            side: leg.side,
            quantity: leg.quantity
          });

          const internalHints = this.deps.internalCrossingSource
            ? await this.deps.internalCrossingSource.getCrossingHints({
                rfq: parsed.rfq,
                leg,
                selectedQuote: parsed.selectedQuote
              })
            : [];

          for (const quote of wholeComboQuotes) {
            const wholeComboInputBase = {
              providerType: "LP" as const,
              providerId: quote.providerId,
              availableSize: quote.availableSize,
              quotedPrice: quote.quotedPrice,
              metadata: {
                source: "whole_combo_lp",
                quoteId: quote.quoteId,
                ...(quote.metadata ?? {})
              }
            };
            const wholeComboInput = {
              ...wholeComboInputBase,
              ...(quote.fees ? { fees: quote.fees } : {}),
              ...(typeof quote.latencyMs === "number" ? { latencyMs: quote.latencyMs } : {}),
              ...(typeof quote.fillProb === "number" ? { fillProb: quote.fillProb } : {})
            };
            result.push(this.normalizeCandidate(leg.leg_id, wholeComboInput));
          }

          for (const quote of perLegQuotes) {
            const perLegInputBase = {
              providerType: "LP" as const,
              providerId: quote.providerId,
              availableSize: quote.availableSize,
              quotedPrice: quote.quotedPrice,
              metadata: {
                source: "per_leg_lp",
                quoteId: quote.quoteId,
                legId: quote.legId,
                ...(quote.metadata ?? {})
              }
            };
            const perLegInput = {
              ...perLegInputBase,
              ...(quote.fees ? { fees: quote.fees } : {}),
              ...(typeof quote.latencyMs === "number" ? { latencyMs: quote.latencyMs } : {}),
              ...(typeof quote.fillProb === "number" ? { fillProb: quote.fillProb } : {})
            };
            result.push(this.normalizeCandidate(leg.leg_id, perLegInput));
          }

          if (orderbookSnapshot) {
            const orderbookInputBase = {
              providerType: "VENUE" as const,
              providerId: "canonical-orderbook",
              availableSize: orderbookSnapshot.availableSize,
              quotedPrice: orderbookSnapshot.quotedPrice,
              metadata: {
                source: "canonical_orderbook",
                ...(orderbookSnapshot.snapshotId ? { snapshotId: orderbookSnapshot.snapshotId } : {}),
                ...(orderbookSnapshot.metadata ?? {})
              }
            };
            const orderbookInput = {
              ...orderbookInputBase,
              ...(orderbookSnapshot.fees ? { fees: orderbookSnapshot.fees } : {}),
              ...(typeof orderbookSnapshot.latencyMs === "number"
                ? { latencyMs: orderbookSnapshot.latencyMs }
                : {}),
              ...(typeof orderbookSnapshot.fillProb === "number"
                ? { fillProb: orderbookSnapshot.fillProb }
                : {})
            };
            result.push(this.normalizeCandidate(leg.leg_id, orderbookInput));
          }

          for (const hint of internalHints) {
            const internalInputBase = {
              providerType: LiquiditySource.INTERNAL_CROSS,
              providerId: hint.providerId,
              availableSize: hint.availableSize,
              quotedPrice: hint.quotedPrice,
              metadata: {
                source: "internal_crossing",
                hintId: hint.hintId,
                ...(hint.metadata ?? {})
              }
            };
            const internalInput = {
              ...internalInputBase,
              ...(hint.fees ? { fees: hint.fees } : {}),
              ...(typeof hint.latencyMs === "number" ? { latencyMs: hint.latencyMs } : {}),
              ...(typeof hint.fillProb === "number" ? { fillProb: hint.fillProb } : {})
            };
            result.push(this.normalizeCandidate(leg.leg_id, internalInput));
          }
        }

        const normalized = RouteCandidateArraySchema.parse(result);
        await this.deps.redis.set(cacheKey, JSON.stringify(normalized), "PX", this.cacheTtlMs);
        return normalized;
      }
    );
  }

  private normalizeCandidate(
    legId: string,
    input: {
      providerType: import("./types.js").LiquiditySourceValue;
      providerId: string;
      availableSize: number;
      quotedPrice: number;
      fees?: Readonly<Record<string, number>>;
      latencyMs?: number;
      fillProb?: number;
      metadata?: Readonly<Record<string, unknown>>;
    }
  ): RouteCandidate {
    return {
      id: randomUUID(),
      leg_id: legId,
      provider_type: input.providerType,
      provider_id: input.providerId,
      available_size: input.availableSize,
      quoted_price: input.quotedPrice,
      fees: { ...(input.fees ?? {}) },
      latency_ms: Math.max(0, Math.trunc(input.latencyMs ?? 0)),
      fill_prob: this.clampProbability(input.fillProb ?? 0.5),
      ...(input.metadata ? { metadata: { ...input.metadata } } : {})
    };
  }

  private extractLegs(rfq: CanonicalRFQInput): ReadonlyArray<z.infer<typeof RFQLegSchema>> {
    const metadataLegs = rfq.metadata?.legs;
    if (Array.isArray(metadataLegs)) {
      const parsed = z.array(RFQLegSchema).safeParse(metadataLegs);
      if (parsed.success && parsed.data.length > 0) {
        return parsed.data;
      }
    }

    return [
      {
        leg_id: randomUUID(),
        canonical_market_id: rfq.canonicalMarketId,
        ...(rfq.canonicalOutcomeId ? { canonical_outcome_id: rfq.canonicalOutcomeId } : {}),
        side: rfq.side,
        quantity: Number(rfq.quantity)
      }
    ];
  }

  private cacheKey(rfqId: string, quoteId: string, policy: SORAcceptancePolicy): string {
    return `sor:candidates:${rfqId}:${quoteId}:${policy}`;
  }

  private clampCacheTtlMs(ttlMs: number): number {
    return Math.max(250, Math.min(1000, Math.trunc(ttlMs)));
  }

  private clampProbability(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
