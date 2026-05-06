import { z, type ZodType } from "zod";

export class PredictSchemaParseError extends Error {
  public readonly issues: z.ZodIssue[];

  public constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "PredictSchemaParseError";
    this.issues = issues;
  }
}

const numericStringSchema = z.union([z.string(), z.number().finite()]).transform((value) => String(value));
const nullableNumericStringSchema = z.union([z.string(), z.number().finite(), z.null()]).optional().transform((value) => {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
});
const timestampSchema = z.union([z.string(), z.number().finite()]).transform((value) => {
  if (typeof value === "number") {
    return value;
  }
  return value;
});

const outcomeSchema = z.object({
  id: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  indexSet: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  label: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  tokenId: z.string().optional(),
  token_id: z.string().optional(),
  onChainId: z.string().optional(),
  on_chain_id: z.string().optional(),
  outcomeType: z.string().optional(),
  outcome_type: z.string().optional()
}).passthrough();

const marketSchema = z.object({
  id: z.union([z.string(), z.number().finite()]).transform((value) => String(value)),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  categorySlug: z.string().nullable().optional(),
  category_slug: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  chainId: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  chain_id: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  contractAddress: z.string().nullable().optional(),
  contract_address: z.string().nullable().optional(),
  tokenId: z.string().nullable().optional(),
  token_id: z.string().nullable().optional(),
  outcomes: z.array(outcomeSchema).optional()
}).passthrough();

const marketStatsSchema = z.object({
  volume: nullableNumericStringSchema,
  liquidity: nullableNumericStringSchema,
  totalLiquidityUsd: nullableNumericStringSchema,
  total_liquidity_usd: nullableNumericStringSchema,
  volume24hUsd: nullableNumericStringSchema,
  volume_24h_usd: nullableNumericStringSchema,
  volumeTotalUsd: nullableNumericStringSchema,
  volume_total_usd: nullableNumericStringSchema,
  openInterest: nullableNumericStringSchema,
  open_interest: nullableNumericStringSchema,
  feeRateBps: nullableNumericStringSchema,
  fee_rate_bps: nullableNumericStringSchema
}).passthrough();

const lastSaleSchema = z.object({
  price: nullableNumericStringSchema,
  priceInCurrency: nullableNumericStringSchema,
  price_in_currency: nullableNumericStringSchema,
  size: nullableNumericStringSchema,
  timestamp: timestampSchema.nullable().optional(),
  matchedAt: timestampSchema.nullable().optional(),
  matched_at: timestampSchema.nullable().optional()
}).passthrough();

const orderbookLevelObjectSchema = z.object({
  price: numericStringSchema,
  size: z.union([z.string(), z.number().finite(), z.object({ size: z.union([z.string(), z.number().finite()]) }).passthrough()])
}).passthrough().transform((level) => {
  const rawSize = typeof level.size === "object" && level.size !== null && "size" in level.size ? level.size.size : level.size;
  return {
    price: level.price,
    size: String(rawSize),
    raw: level as Record<string, unknown>
  };
});
const orderbookLevelTupleSchema = z.tuple([
  z.union([z.string(), z.number().finite()]),
  z.union([z.string(), z.number().finite()])
]).transform((level) => ({
  price: String(level[0]),
  size: String(level[1]),
  raw: { price: level[0], size: level[1] }
}));
const orderbookLevelSchema = z.union([orderbookLevelObjectSchema, orderbookLevelTupleSchema]);

const orderbookSchema = z.object({
  marketId: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  market_id: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  timestamp: timestampSchema.optional(),
  bids: z.array(orderbookLevelSchema),
  asks: z.array(orderbookLevelSchema)
}).passthrough();

const orderSchema = z.object({
  hash: z.string(),
  marketId: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  market_id: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  status: z.string().nullable().optional(),
  side: z.string().nullable().optional(),
  price: nullableNumericStringSchema,
  size: nullableNumericStringSchema,
  remainingSize: nullableNumericStringSchema,
  remaining_size: nullableNumericStringSchema,
  createdAt: timestampSchema.optional(),
  created_at: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
  updated_at: timestampSchema.optional()
}).passthrough();

const matchEventSchema = z.object({
  id: z.union([z.string(), z.number().finite()]).transform((value) => String(value)).optional(),
  marketId: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  market_id: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  orderHash: z.string().optional(),
  order_hash: z.string().optional(),
  side: z.string().nullable().optional(),
  price: nullableNumericStringSchema,
  size: nullableNumericStringSchema,
  timestamp: timestampSchema.optional(),
  matchedAt: timestampSchema.optional(),
  matched_at: timestampSchema.optional()
}).passthrough();

const accountActivitySchema = z.object({
  id: z.union([z.string(), z.number().finite()]).transform((value) => String(value)).optional(),
  marketId: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  market_id: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  orderHash: z.string().optional(),
  order_hash: z.string().optional(),
  side: z.string().nullable().optional(),
  price: nullableNumericStringSchema,
  size: nullableNumericStringSchema,
  timestamp: timestampSchema.optional(),
  createdAt: timestampSchema.optional(),
  created_at: timestampSchema.optional(),
  type: z.string().nullable().optional()
}).passthrough();

const positionSchema = z.object({
  conditionId: z.string().optional(),
  condition_id: z.string().optional(),
  marketId: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  market_id: z.union([z.string(), z.number().finite()]).optional().transform((value) => value === undefined ? undefined : String(value)),
  size: nullableNumericStringSchema,
  quantity: nullableNumericStringSchema,
  outcome: z.string().nullable().optional()
}).passthrough();

const connectedAccountSchema = z.object({
  address: z.string(),
  predictAccount: z.string().optional(),
  predict_account: z.string().optional()
}).passthrough();

const authMessageSchema = z.object({
  message: z.string()
}).passthrough();

const jwtSchema = z.object({
  token: z.string().optional(),
  jwt: z.string().optional()
}).passthrough().transform((value) => ({
  token: value.token ?? value.jwt ?? ""
}));

const arrayResponse = <T>(itemSchema: ZodType<T>) =>
  z.union([
    z.array(itemSchema),
    z.object({ data: z.array(itemSchema) }).passthrough(),
    z.object({ items: z.array(itemSchema) }).passthrough(),
    z.object({ markets: z.array(itemSchema) }).passthrough(),
    z.object({ orders: z.array(itemSchema) }).passthrough(),
    z.object({ positions: z.array(itemSchema) }).passthrough(),
    z.object({ events: z.array(itemSchema) }).passthrough(),
    z.object({ cursor: z.string().optional(), data: z.array(itemSchema) }).passthrough()
  ]).transform((payload) => {
    if (Array.isArray(payload)) {
      return payload;
    }
    for (const key of ["data", "items", "markets", "orders", "positions", "events"] as const) {
      const candidate = payload[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
    return [];
  });

const objectResponse = <T>(itemSchema: ZodType<T>) =>
  z.union([
    itemSchema,
    z.object({ data: itemSchema }).passthrough()
  ]).transform((payload) => {
    if (typeof payload === "object" && payload !== null && "data" in payload) {
      return payload.data;
    }
    return payload;
  });

const parseWithSchema = <T>(schema: ZodType<T>, payload: unknown, context: string): T => {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new PredictSchemaParseError(`Predict ${context} payload validation failed.`, parsed.error.issues);
  }
  return parsed.data;
};

export const parsePredictMarketsResponse = (payload: unknown) => parseWithSchema(arrayResponse(marketSchema), payload, "markets");
export const parsePredictMarketResponse = (payload: unknown) => parseWithSchema(objectResponse(marketSchema), payload, "market");
export const parsePredictMarketStatisticsResponse = (payload: unknown) => parseWithSchema(objectResponse(marketStatsSchema), payload, "market statistics");
export const parsePredictMarketLastSaleResponse = (payload: unknown) => parseWithSchema(objectResponse(lastSaleSchema), payload, "market last sale");
export const parsePredictMarketOrderbookResponse = (payload: unknown) => parseWithSchema(objectResponse(orderbookSchema), payload, "market orderbook");
export const parsePredictOrdersResponse = (payload: unknown) => parseWithSchema(arrayResponse(orderSchema), payload, "orders");
export const parsePredictOrderResponse = (payload: unknown) => parseWithSchema(objectResponse(orderSchema), payload, "order");
export const parsePredictOrderMatchEventsResponse = (payload: unknown) => parseWithSchema(arrayResponse(matchEventSchema), payload, "order match events");
export const parsePredictConnectedAccountResponse = (payload: unknown) => parseWithSchema(objectResponse(connectedAccountSchema), payload, "connected account");
export const parsePredictAccountActivityResponse = (payload: unknown) => parseWithSchema(arrayResponse(accountActivitySchema), payload, "account activity");
export const parsePredictPositionsResponse = (payload: unknown) => parseWithSchema(arrayResponse(positionSchema), payload, "positions");
export const parsePredictAuthMessageResponse = (payload: unknown) => parseWithSchema(objectResponse(authMessageSchema), payload, "auth message");
export const parsePredictJwtResponse = (payload: unknown) => parseWithSchema(objectResponse(jwtSchema), payload, "jwt");
