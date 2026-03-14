import { z, type ZodType } from "zod"

export class PredexonSchemaParseError extends Error {
  public readonly issues: z.ZodIssue[]

  public constructor(message: string, issues: z.ZodIssue[]) {
    super(message)
    this.name = "PredexonSchemaParseError"
    this.issues = issues
  }
}

export const PredexonDocsTodo = Object.freeze({
  websocketOverview: "https://docs.predexon.com/websocket/overview",
  websocketSubscriptions: "https://docs.predexon.com/websocket/subscriptions",
  tradingApiIntroduction: "https://docs.predexon.com/trading-api/introduction",
  responseEnvelopeVariance:
    "Verify whether v2 historical endpoints always return bare payloads or sometimes wrap them in a data/results envelope."
})

const finiteNumberSchema = z.number().finite()
const numericValueSchema = z.union([z.string(), finiteNumberSchema])
const timestampSchema = z.union([z.number().int(), z.string().min(1)])

const arrayEnvelopeSchema = <T extends ZodType>(itemSchema: T) =>
  z.union([
    z.array(itemSchema),
    z.object({ data: z.array(itemSchema) }).passthrough(),
    z.object({ results: z.array(itemSchema) }).passthrough()
  ])

const objectEnvelopeSchema = <T extends ZodType>(itemSchema: T) =>
  z.union([
    itemSchema,
    z.object({ data: itemSchema }).passthrough(),
    z.object({ result: itemSchema }).passthrough()
  ])

const marketOutcomeSchema = z
  .object({
    token_id: z.string().optional(),
    label: z.string().optional(),
    price: numericValueSchema.optional()
  })
  .passthrough()

export const predexonMarketSchema = z
  .object({
    market_id: z.string().optional(),
    condition_id: z.string(),
    title: z.string(),
    market_slug: z.string().optional(),
    event_id: z.string().optional(),
    event_slug: z.string().optional(),
    token_id: z.string().optional(),
    token_ids: z.array(z.string()).optional(),
    status: z.string().optional(),
    volume: numericValueSchema.optional(),
    liquidity: numericValueSchema.optional(),
    outcomes: z.array(marketOutcomeSchema).optional()
  })
  .passthrough()

export const predexonEventSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    slug: z.string().optional(),
    category: z.string().optional(),
    status: z.string().optional(),
    start_date: timestampSchema.optional(),
    end_date: timestampSchema.optional(),
    markets: z.array(predexonMarketSchema).optional()
  })
  .passthrough()

export const predexonCandleSchema = z
  .object({
    timestamp: timestampSchema,
    open: numericValueSchema,
    high: numericValueSchema,
    low: numericValueSchema,
    close: numericValueSchema,
    volume: numericValueSchema.optional()
  })
  .passthrough()

export const predexonMarketPriceSchema = z
  .object({
    price: numericValueSchema,
    timestamp: timestampSchema
  })
  .passthrough()

const orderbookLevelSchema = z
  .object({
    price: numericValueSchema,
    size: numericValueSchema
  })
  .passthrough()

export const predexonOrderbookSnapshotSchema = z
  .object({
    token_id: z.string(),
    timestamp: timestampSchema,
    bids: z.array(orderbookLevelSchema),
    asks: z.array(orderbookLevelSchema)
  })
  .passthrough()

export const predexonTradeSchema = z
  .object({
    token_id: z.string(),
    timestamp: timestampSchema,
    price: numericValueSchema,
    amount_usd: numericValueSchema,
    side: z.string().optional()
  })
  .passthrough()

export const predexonVolumePointSchema = z
  .object({
    timestamp: timestampSchema,
    total_volume: numericValueSchema.optional(),
    buy_volume: numericValueSchema.optional(),
    sell_volume: numericValueSchema.optional(),
    volume: numericValueSchema.optional()
  })
  .passthrough()

export const predexonOpenInterestPointSchema = z
  .object({
    timestamp: timestampSchema,
    open_interest: numericValueSchema.optional(),
    value: numericValueSchema.optional()
  })
  .passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const unwrapEnvelope = <T>(payload: T | { data: T } | { result: T } | { results: T }): T => {
  if (Array.isArray(payload)) {
    return payload as T
  }

  if (isRecord(payload) && "data" in payload) {
    return payload.data
  }

  if (isRecord(payload) && "result" in payload) {
    return payload.result
  }

  if (isRecord(payload) && "results" in payload) {
    return payload.results
  }

  return payload as T
}

const parseWithSchema = <T>(schema: ZodType<T>, payload: unknown, context: string): T => {
  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    throw new PredexonSchemaParseError(`Predexon ${context} payload validation failed.`, parsed.error.issues)
  }

  return parsed.data
}

export const parsePredexonMarketsResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(arrayEnvelopeSchema(predexonMarketSchema), payload, "markets"))

export const parsePredexonEventsResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(arrayEnvelopeSchema(predexonEventSchema), payload, "events"))

export const parsePredexonCandlesticksResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(arrayEnvelopeSchema(predexonCandleSchema), payload, "candlesticks"))

export const parsePredexonMarketPriceResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(objectEnvelopeSchema(predexonMarketPriceSchema), payload, "market price"))

export const parsePredexonOrderbooksResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(arrayEnvelopeSchema(predexonOrderbookSnapshotSchema), payload, "orderbooks"))

export const parsePredexonTradesResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(arrayEnvelopeSchema(predexonTradeSchema), payload, "trades"))

export const parsePredexonVolumeResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(arrayEnvelopeSchema(predexonVolumePointSchema), payload, "volume"))

export const parsePredexonOpenInterestResponse = (payload: unknown) =>
  unwrapEnvelope(parseWithSchema(arrayEnvelopeSchema(predexonOpenInterestPointSchema), payload, "open interest"))
