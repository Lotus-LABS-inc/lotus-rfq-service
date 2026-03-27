import { z, type ZodType } from "zod"

export class LimitlessSchemaParseError extends Error {
  public readonly issues: z.ZodIssue[]

  public constructor(message: string, issues: z.ZodIssue[]) {
    super(message)
    this.name = "LimitlessSchemaParseError"
    this.issues = issues
  }
}

export const LimitlessDocsTodo = Object.freeze({
  authSigningMessage: "/auth/signing-message",
  authLogin: "/auth/login",
  authVerifyAuth: "/auth/verify-auth",
  authLogout: "/auth/logout",
  websocketMarketsNamespace:
    "The docs overview references a `/markets` WebSocket namespace. Keep WebSocket integration out of this adapter until the event contract is implemented separately.",
  tradingApiOutOfScope:
    "Trading and order routes remain out of scope for the historical adapter.",
  portfolioTradesResponseShape:
    "The OpenAPI only documents `/portfolio/trades` as `type: object` with additionalProperties. Keep normalization narrow and isolated until the exact trade list shape is required."
})

const finiteNumberSchema = z.number().finite()
const numericValueSchema = z.union([z.string(), finiteNumberSchema])
const timestampSchema = z.union([z.number().int(), z.string().min(1)])

const nullableStringSchema = z.string().nullable().optional()
const nullableNumericValueSchema = z.union([numericValueSchema, z.null()]).optional()

const venueSchema = z
  .object({
    exchange: nullableStringSchema,
    adapter: nullableStringSchema
  })
  .passthrough()

const marketDetailCommonSchema = z
  .object({
    address: nullableStringSchema,
    conditionId: nullableStringSchema,
    title: z.string(),
    slug: nullableStringSchema,
    status: nullableStringSchema,
    tradeType: nullableStringSchema,
    marketType: nullableStringSchema,
    volume: nullableNumericValueSchema,
    openInterest: nullableNumericValueSchema,
    liquidity: nullableNumericValueSchema,
    venue: venueSchema.optional()
  })
  .passthrough()

const historicalPricePointSchema = z
  .object({
    price: numericValueSchema,
    timestamp: timestampSchema
  })
  .passthrough()

const historicalPriceSeriesSchema = z
  .object({
    title: z.string(),
    prices: z.array(historicalPricePointSchema)
  })
  .passthrough()

const documentedMarketEventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    timestamp: timestampSchema,
    data: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough()

const historicalTradeEventSchema = z
  .object({
    createdAt: timestampSchema,
    txHash: z.string().optional(),
    price: numericValueSchema.optional()
  })
  .passthrough()
  .transform((event) => ({
    id: event.txHash ?? `${event.createdAt}`,
    type: "TRADE",
    timestamp: event.createdAt,
    data: event
  }))

const marketEventSchema = z.union([documentedMarketEventSchema, historicalTradeEventSchema])

const marketEventsResponseSchema = z
  .object({
    events: z.array(marketEventSchema)
  })
  .passthrough()

const historyMarketSchema = z
  .object({
    id: z.number().int().optional(),
    slug: z.string(),
    title: z.string(),
    condition_id: z.string().optional(),
    deadline: z.string().optional()
  })
  .passthrough()

const portfolioHistoryEntrySchema = z
  .object({
    blockTimestamp: z.number().int(),
    collateralAmount: z.string(),
    market: historyMarketSchema,
    outcomeTokenAmount: z.string(),
    outcomeTokenAmounts: z.array(z.string()),
    outcomeIndex: z.number().int(),
    outcomeTokenPrice: z.number().finite(),
    strategy: z.string(),
    transactionHash: z.string().optional()
  })
  .passthrough()

const portfolioHistoryResponseSchema = z
  .object({
    data: z.array(portfolioHistoryEntrySchema),
    totalCount: z.number().int()
  })
  .passthrough()

const portfolioTradesResponseSchema = z.object({}).passthrough()

const parseWithSchema = <T>(schema: ZodType<T>, payload: unknown, context: string): T => {
  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    throw new LimitlessSchemaParseError(`Limitless ${context} payload validation failed.`, parsed.error.issues)
  }

  return parsed.data
}

export const parseLimitlessMarketDetailResponse = (payload: unknown) =>
  parseWithSchema(marketDetailCommonSchema, payload, "market detail")

export const parseLimitlessHistoricalPriceResponse = (payload: unknown) =>
  Array.isArray(payload)
    ? parseWithSchema(z.array(historicalPriceSeriesSchema), payload, "historical price")
    : [parseWithSchema(historicalPriceSeriesSchema, payload, "historical price")]

export const parseLimitlessMarketEventsResponse = (payload: unknown) =>
  parseWithSchema(marketEventsResponseSchema, payload, "market events")

export const parseLimitlessPortfolioHistoryResponse = (payload: unknown) =>
  parseWithSchema(portfolioHistoryResponseSchema, payload, "portfolio history")

export const parseLimitlessPortfolioTradesResponse = (payload: unknown) =>
  parseWithSchema(portfolioTradesResponseSchema, payload, "portfolio trades")
