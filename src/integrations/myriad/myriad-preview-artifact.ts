import { z } from "zod"

import type { MyriadPreviewCategory } from "./myriad-topic-normalizer.js"

const previewCategorySchema = z.enum(["SPORTS", "CRYPTO", "POLITICS", "CULTURE", "TECH", "WEATHER", "OTHER", "ESPORTS"])
const isoDateSchema = z.string().datetime({ offset: true }).or(z.string().datetime())

export interface MyriadPreviewCandidate {
  key: string;
  previewCategory: MyriadPreviewCategory;
  lotusCategory: Exclude<MyriadPreviewCategory, "ESPORTS"> | "OTHER";
  shortlistSets: readonly ("highLiquidity" | "categoryBalanced" | "recentlyResolved")[];
  question: {
    id: string;
    title: string;
    marketCount: number;
    expiresAt: string | null;
  } | null;
  market: {
    id: string;
    networkId: number;
    slug: string;
    title: string;
    state: string;
    publishedAt: string | null;
    expiresAt: string | null;
    resolvesAt: string | null;
    topics: readonly string[];
    resolutionSource: string | null;
    resolutionTitle: string | null;
    liquidity: number | null;
    volume: number | null;
    volume24h: number | null;
    users: number | null;
    voided: boolean;
    featured: boolean;
    inPlay: boolean;
    perpetual: boolean;
    moneyline: boolean;
    outcomeCount: number;
    outcomes: readonly {
      id: string;
      title: string;
      price: number | null;
    }[];
  };
  priceHistory: {
    seriesCount: number;
    timeframes: readonly string[];
    pointCount: number;
  };
  eventHistory: {
    eventCount: number;
    firstTimestamp: number | null;
    lastTimestamp: number | null;
  };
  simulationReadiness: {
    hasQuestionGrouping: boolean;
    hasResolutionMetadata: boolean;
    hasOutcomeMetadata: boolean;
    hasUsablePriceHistory: boolean;
    hasUsableEventHistory: boolean;
    likelyGoodForReplay: boolean;
    likelyGoodForCanaryShadowTesting: boolean;
  };
}

export interface MyriadPhase4PreviewArtifact {
  version: "myriad-phase4-preview-v1";
  generatedAt: string;
  source: {
    baseUrl: string;
    marketLookbackDays: number;
    perCategoryCandidateLimit: number;
  };
  candidates: readonly MyriadPreviewCandidate[];
}

const previewCandidateSchema: z.ZodType<MyriadPreviewCandidate> = z.object({
  key: z.string().min(1),
  previewCategory: previewCategorySchema,
  lotusCategory: z.enum(["SPORTS", "CRYPTO", "POLITICS", "CULTURE", "TECH", "WEATHER", "OTHER"]),
  shortlistSets: z.array(z.enum(["highLiquidity", "categoryBalanced", "recentlyResolved"])),
  question: z.object({
    id: z.string(),
    title: z.string(),
    marketCount: z.number().int().nonnegative(),
    expiresAt: isoDateSchema.nullable()
  }).nullable(),
  market: z.object({
    id: z.string(),
    networkId: z.number().int(),
    slug: z.string(),
    title: z.string(),
    state: z.string(),
    publishedAt: isoDateSchema.nullable(),
    expiresAt: isoDateSchema.nullable(),
    resolvesAt: isoDateSchema.nullable(),
    topics: z.array(z.string()),
    resolutionSource: z.string().nullable(),
    resolutionTitle: z.string().nullable(),
    liquidity: z.number().finite().nullable(),
    volume: z.number().finite().nullable(),
    volume24h: z.number().finite().nullable(),
    users: z.number().finite().nullable(),
    voided: z.boolean(),
    featured: z.boolean(),
    inPlay: z.boolean(),
    perpetual: z.boolean(),
    moneyline: z.boolean(),
    outcomeCount: z.number().int().nonnegative(),
    outcomes: z.array(z.object({
      id: z.string(),
      title: z.string(),
      price: z.number().finite().nullable()
    }))
  }),
  priceHistory: z.object({
    seriesCount: z.number().int().nonnegative(),
    timeframes: z.array(z.string()),
    pointCount: z.number().int().nonnegative()
  }),
  eventHistory: z.object({
    eventCount: z.number().int().nonnegative(),
    firstTimestamp: z.number().int().nonnegative().nullable(),
    lastTimestamp: z.number().int().nonnegative().nullable()
  }),
  simulationReadiness: z.object({
    hasQuestionGrouping: z.boolean(),
    hasResolutionMetadata: z.boolean(),
    hasOutcomeMetadata: z.boolean(),
    hasUsablePriceHistory: z.boolean(),
    hasUsableEventHistory: z.boolean(),
    likelyGoodForReplay: z.boolean(),
    likelyGoodForCanaryShadowTesting: z.boolean()
  })
})

export const myriadPhase4PreviewArtifactSchema: z.ZodType<MyriadPhase4PreviewArtifact> = z.object({
  version: z.literal("myriad-phase4-preview-v1"),
  generatedAt: isoDateSchema,
  source: z.object({
    baseUrl: z.string().url(),
    marketLookbackDays: z.number().int().positive(),
    perCategoryCandidateLimit: z.number().int().positive()
  }),
  candidates: z.array(previewCandidateSchema)
})
