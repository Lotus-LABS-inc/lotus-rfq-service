import { z, type ZodType } from "zod"

export class MyriadSchemaParseError extends Error {
  public readonly issues: z.ZodIssue[]

  public constructor(message: string, issues: z.ZodIssue[]) {
    super(message)
    this.name = "MyriadSchemaParseError"
    this.issues = issues
  }
}

export const MyriadDocsTodo = Object.freeze({
  questionsPersistence:
    "Persisted storage is intentionally left outside this extraction module. Emit normalized records and raw payloads for the caller to store.",
  historicalPriceEndpoint:
    "Myriad documents price_charts inside GET /markets/:id outcomes. No standalone historical candles endpoint is implemented here.",
  cliWriteCommandsOutOfScope:
    "The official CLI supports trading and claims. This module only wraps read-only market discovery commands."
})

const numericSchema = z.number().finite()
const isoDateSchema = z.string().datetime({ offset: true }).or(z.string().datetime())
const unixSecondsSchema = z.number().int().nonnegative()

const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean()
})

const tokenSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative()
}).passthrough()

const outcomeSummarySchema = z.object({
  id: z.union([z.string(), z.number().int()]),
  title: z.string(),
  price: numericSchema.optional(),
  closingPrice: numericSchema.nullable().optional(),
  priceChange24h: numericSchema.optional(),
  shares: numericSchema.optional(),
  sharesHeld: numericSchema.optional(),
  holders: numericSchema.optional(),
  imageUrl: z.string().nullable().optional()
}).passthrough()

const priceChartPointSchema = z.object({
  timestamp: z.union([unixSecondsSchema, isoDateSchema]),
  price: numericSchema
}).passthrough()

const livePriceChartPointSchema = z.object({
  timestamp: z.union([unixSecondsSchema, isoDateSchema]),
  value: numericSchema,
  date: isoDateSchema.optional()
}).passthrough().transform((point) => ({
  timestamp: point.timestamp,
  price: point.value
}))

const livePriceChartSeriesSchema = z.object({
  timeframe: z.enum(["24h", "7d", "30d", "all"]),
  prices: z.array(livePriceChartPointSchema),
  change_percent: numericSchema.optional()
}).passthrough()

const detailedOutcomeSchema = outcomeSummarySchema.extend({
  price_charts: z.array(livePriceChartSeriesSchema).optional()
}).passthrough()

const baseMarketSchema = z.object({
  id: z.union([z.string(), z.number().int()]),
  networkId: z.number().int(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  publishedAt: isoDateSchema.optional(),
  expiresAt: isoDateSchema.optional(),
  resolvesAt: isoDateSchema.nullable().optional(),
  fees: z.record(z.string(), z.unknown()).optional(),
  state: z.string(),
  voided: z.boolean().optional(),
  resolvedOutcomeId: z.union([z.string(), z.number().int()]).nullable().optional(),
  topics: z.array(z.string()).default([]),
  resolutionSource: z.string().nullable().optional(),
  resolutionTitle: z.string().nullable().optional(),
  token: tokenSchema.optional(),
  imageUrl: z.string().nullable().optional(),
  bannerImageUrl: z.string().nullable().optional(),
  ogImageUrl: z.string().nullable().optional(),
  liquidity: numericSchema.optional(),
  liquidityPrice: numericSchema.optional(),
  volume: numericSchema.optional(),
  volume24h: numericSchema.optional(),
  users: numericSchema.optional(),
  shares: numericSchema.optional(),
  featured: z.boolean().optional(),
  featuredAt: isoDateSchema.nullable().optional(),
  inPlay: z.boolean().optional(),
  inPlayStartsAt: isoDateSchema.nullable().optional(),
  perpetual: z.boolean().optional(),
  moneyline: z.boolean().optional(),
  topHolders: z.array(z.unknown()).optional(),
  outcomes: z.array(outcomeSummarySchema)
}).passthrough()

const questionMarketSchema = z.object({
  id: z.union([z.string(), z.number().int()]),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  state: z.string(),
  networkId: z.number().int(),
  liquidity: numericSchema.optional(),
  volume: numericSchema.optional(),
  volume24h: numericSchema.optional(),
  imageUrl: z.string().nullable().optional(),
  expiresAt: isoDateSchema.optional(),
  topics: z.array(z.string()).default([]),
  outcomes: z.array(outcomeSummarySchema)
}).passthrough()

const questionSchema = z.object({
  id: z.union([z.string(), z.number().int()]),
  title: z.string(),
  expiresAt: isoDateSchema.optional(),
  marketCount: z.number().int().nonnegative(),
  markets: z.array(questionMarketSchema)
}).passthrough()

const questionsListResponseSchema = z.object({
  data: z.array(questionSchema),
  pagination: paginationSchema.optional(),
  meta: paginationSchema.extend({
    totalMarkets: z.number().int().nonnegative().optional()
  }).optional()
}).passthrough().transform((payload) => ({
  data: payload.data,
  pagination: payload.pagination ?? payload.meta ?? {
    page: 1,
    limit: payload.data.length,
    total: payload.data.length,
    totalPages: payload.data.length > 0 ? 1 : 0,
    hasNext: false,
    hasPrev: false
  }
}))

const questionDetailResponseSchema = questionSchema

const marketsListResponseSchema = z.object({
  data: z.array(baseMarketSchema),
  pagination: paginationSchema
}).passthrough()

const marketDetailResponseSchema = baseMarketSchema.extend({
  outcomes: z.array(detailedOutcomeSchema)
}).passthrough()

const marketEventSchema = z.object({
  user: z.string(),
  action: z.enum([
    "buy",
    "sell",
    "add_liquidity",
    "remove_liquidity",
    "claim_winnings",
    "claim_liquidity",
    "claim_fees",
    "claim_voided"
  ]),
  marketTitle: z.string(),
  marketSlug: z.string(),
  marketId: z.union([z.string(), z.number().int()]),
  networkId: z.number().int(),
  outcomeTitle: z.string().nullable().optional(),
  outcomeId: z.union([z.string(), z.number().int()]).nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  shares: numericSchema,
  value: numericSchema,
  timestamp: unixSecondsSchema,
  blockNumber: z.number().int().nonnegative(),
  token: z.string()
}).passthrough()

const marketEventsResponseSchema = z.object({
  data: z.array(marketEventSchema),
  pagination: paginationSchema
}).passthrough()

const parseWithSchema = <T>(schema: ZodType<T>, payload: unknown, context: string): T => {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new MyriadSchemaParseError(`Myriad ${context} payload validation failed.`, parsed.error.issues)
  }
  return parsed.data
}

export const parseMyriadQuestionsListResponse = (payload: unknown) =>
  parseWithSchema(questionsListResponseSchema, payload, "questions list")

export const parseMyriadQuestionDetailResponse = (payload: unknown) =>
  parseWithSchema(questionDetailResponseSchema, payload, "question detail")

export const parseMyriadMarketsListResponse = (payload: unknown) =>
  parseWithSchema(marketsListResponseSchema, payload, "markets list")

export const parseMyriadMarketDetailResponse = (payload: unknown) =>
  parseWithSchema(marketDetailResponseSchema, payload, "market detail")

export const parseMyriadMarketEventsResponse = (payload: unknown) =>
  parseWithSchema(marketEventsResponseSchema, payload, "market events")

type QuestionsListResponse = ReturnType<typeof parseMyriadQuestionsListResponse>
type MarketsListResponse = ReturnType<typeof parseMyriadMarketsListResponse>
type MarketEventsResponse = ReturnType<typeof parseMyriadMarketEventsResponse>

export type MyriadPagination = QuestionsListResponse["pagination"]
export type MyriadQuestion = QuestionsListResponse["data"][number]
export type MyriadQuestionMarket = MyriadQuestion["markets"][number]
export type MyriadMarketSummary = MarketsListResponse["data"][number]
export type MyriadMarketDetail = ReturnType<typeof parseMyriadMarketDetailResponse>
export type MyriadOutcome = MyriadMarketDetail["outcomes"][number]
export type MyriadPriceChartSeries = Readonly<{
  timeframe: "24h" | "7d" | "30d" | "all";
  points: readonly z.infer<typeof priceChartPointSchema>[];
}>
export type MyriadMarketEvent = MarketEventsResponse["data"][number]
export type LotusNormalizedMarketCategory = "SPORTS" | "CRYPTO" | "POLITICS" | "CULTURE" | "TECH" | "WEATHER" | "OTHER"

export interface MyriadPhase4Candidate {
  question: MyriadQuestion | null;
  marketSummary: MyriadMarketSummary;
  marketDetail: MyriadMarketDetail;
  outcomes: readonly MyriadOutcome[];
  priceCharts: readonly MyriadPriceChartSeries[];
  events: readonly MyriadMarketEvent[];
  lotusCategory: LotusNormalizedMarketCategory;
  simulationReadiness: {
    hasQuestionGrouping: boolean;
    hasResolutionMetadata: boolean;
    hasOutcomeMetadata: boolean;
    hasUsablePriceHistory: boolean;
    hasUsableEventHistory: boolean;
    likelyGoodForReplay: boolean;
    likelyGoodForCanaryShadowTesting: boolean;
  };
  raw: {
    question: Record<string, unknown> | null;
    marketSummary: Record<string, unknown>;
    marketDetail: Record<string, unknown>;
    events: readonly Record<string, unknown>[];
  };
}
