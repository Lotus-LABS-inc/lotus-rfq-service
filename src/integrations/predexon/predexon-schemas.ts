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
const idStringSchema = z.union([z.string(), z.number().int()]).transform((value) => String(value))

const marketOutcomeSchema = z
  .object({
    token_id: z.string().optional(),
    label: z.string().optional(),
    price: numericValueSchema.optional()
  })
  .passthrough()

export const predexonMarketSchema = z
  .object({
    market_id: idStringSchema.optional(),
    condition_id: z.string(),
    title: z.string(),
    market_slug: z.string().optional(),
    event_id: idStringSchema.optional(),
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
    id: idStringSchema,
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

const predexonWrappedCandleSchema = z
  .object({
    end_period_ts: timestampSchema,
    price: z
      .object({
        open: numericValueSchema,
        high: numericValueSchema,
        low: numericValueSchema,
        close: numericValueSchema
      })
      .passthrough(),
    volume: numericValueSchema.optional()
  })
  .passthrough()
  .transform((candle) => ({
    timestamp: candle.end_period_ts,
    open: candle.price.open,
    high: candle.price.high,
    low: candle.price.low,
    close: candle.price.close,
    ...(candle.volume !== undefined ? { volume: candle.volume } : {})
  }))

export const predexonMarketPriceSchema = z
  .object({
    price: numericValueSchema,
    timestamp: timestampSchema
  })
  .passthrough()

const orderbookLevelObjectSchema = z
  .object({
    price: numericValueSchema,
    size: numericValueSchema
  })
  .passthrough()

const orderbookLevelSchema = z.union([
  orderbookLevelObjectSchema,
  z.tuple([numericValueSchema, numericValueSchema]).transform(([price, size]) => ({ price, size }))
])

export const predexonOrderbookSnapshotSchema = z
  .union([
    z
      .object({
        token_id: z.string(),
        timestamp: timestampSchema,
        bids: z.array(orderbookLevelSchema),
        asks: z.array(orderbookLevelSchema)
      })
      .passthrough(),
    z
      .object({
        assetId: z.string(),
        timestamp: timestampSchema,
        bids: z.array(orderbookLevelSchema),
        asks: z.array(orderbookLevelSchema)
      })
      .passthrough()
      .transform((snapshot) => ({
        token_id: snapshot.assetId,
        timestamp: snapshot.timestamp,
        bids: snapshot.bids,
        asks: snapshot.asks
      }))
  ])

export const predexonLimitlessOrderbookSnapshotSchema = z
  .object({
    market_slug: z.string(),
    timestamp: timestampSchema,
    bids: z.array(orderbookLevelSchema).default([]),
    asks: z.array(orderbookLevelSchema).default([]),
    midpoint: numericValueSchema.optional(),
    adjusted_midpoint: numericValueSchema.optional()
  })
  .passthrough()

export const predexonOpinionOrderbookSnapshotSchema = z
  .object({
    market_id: idStringSchema,
    timestamp: timestampSchema,
    bids: z.array(orderbookLevelSchema).default([]),
    asks: z.array(orderbookLevelSchema).default([]),
    best_bid: numericValueSchema.optional(),
    best_ask: numericValueSchema.optional(),
    bid_depth: numericValueSchema.optional(),
    ask_depth: numericValueSchema.optional()
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
    open_interest_usd: numericValueSchema.optional(),
    value: numericValueSchema.optional()
  })
  .passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const unwrapObjectEnvelope = <T>(payload: T | { data: T } | { result: T }): T => {
  if (!isRecord(payload)) {
    return payload as T
  }

  if ("data" in payload) {
    return payload.data
  }

  if ("result" in payload) {
    return payload.result
  }

  return payload as T
}

const unwrapArrayEnvelope = <T>(
  payload: unknown,
  keys: readonly string[]
): unknown => {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!isRecord(payload)) {
    return payload
  }

  for (const key of keys) {
    if (key in payload) {
      return payload[key]
    }
  }

  return payload
}

const parseWithSchema = <T>(schema: ZodType<T>, payload: unknown, context: string): T => {
  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    throw new PredexonSchemaParseError(`Predexon ${context} payload validation failed.`, parsed.error.issues)
  }

  return parsed.data
}

const parseNamedArrayEnvelope = <T>(
  payload: unknown,
  itemSchema: ZodType<T>,
  context: string,
  keys: readonly string[]
): T[] => parseWithSchema(z.array(itemSchema), unwrapArrayEnvelope(payload, ["data", "results", ...keys]), context)

export const parsePredexonMarketsResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, predexonMarketSchema, "markets", ["markets"])

export const parsePredexonEventsResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, predexonEventSchema, "events", ["events"])

export const parsePredexonCandlesticksResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, z.union([predexonCandleSchema, predexonWrappedCandleSchema]), "candlesticks", ["candlesticks"])

export const parsePredexonMarketPriceResponse = (payload: unknown) =>
  unwrapObjectEnvelope(parseWithSchema(z.union([predexonMarketPriceSchema, z.object({ data: predexonMarketPriceSchema }).passthrough(), z.object({ result: predexonMarketPriceSchema }).passthrough()]), payload, "market price"))

export const parsePredexonOrderbooksResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, predexonOrderbookSnapshotSchema, "orderbooks", ["snapshots"])

export const parsePredexonLimitlessOrderbooksResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, predexonLimitlessOrderbookSnapshotSchema, "limitless orderbooks", ["snapshots"])

export const parsePredexonOpinionOrderbooksResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, predexonOpinionOrderbookSnapshotSchema, "opinion orderbooks", ["snapshots"])

export const parsePredexonTradesResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, predexonTradeSchema, "trades", ["trades"])

export const parsePredexonVolumeResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(payload, predexonVolumePointSchema, "volume", ["volume_over_time"])

export const parsePredexonOpenInterestResponse = (payload: unknown) =>
  parseNamedArrayEnvelope(
    payload,
    predexonOpenInterestPointSchema.transform((point) => ({
      ...point,
      ...(point.open_interest === undefined && point.open_interest_usd !== undefined
        ? { open_interest: point.open_interest_usd }
        : {})
    })),
    "open interest",
    ["open_interest_over_time"]
  )
