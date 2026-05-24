import { z } from "zod";

const opinionMarketSchema = z.object({
  marketId: z.union([z.string(), z.number()]).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  market_id: z.union([z.string(), z.number()]).optional(),
  marketTitle: z.string().optional(),
  title: z.string().optional(),
  question: z.string().optional(),
  slug: z.string().nullable().optional(),
  status: z.number().int().nullable().optional(),
  statusEnum: z.string().nullable().optional(),
  statusText: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  marketType: z.number().int().nullable().optional(),
  market_type: z.number().int().nullable().optional(),
  childMarkets: z.array(z.unknown()).nullable().optional(),
  child_markets: z.array(z.unknown()).nullable().optional(),
  children: z.array(z.unknown()).nullable().optional(),
  labels: z.array(z.string()).default([]),
  rules: z.string().nullable().optional(),
  yesLabel: z.string().nullable().optional(),
  yes_label: z.string().nullable().optional(),
  noLabel: z.string().nullable().optional(),
  no_label: z.string().nullable().optional(),
  yesTokenId: z.string().nullable().optional(),
  yes_token_id: z.string().nullable().optional(),
  yesToken: z.string().nullable().optional(),
  yes_token: z.string().nullable().optional(),
  yesPositionTokenId: z.string().nullable().optional(),
  yes_position_token_id: z.string().nullable().optional(),
  noTokenId: z.string().nullable().optional(),
  no_token_id: z.string().nullable().optional(),
  noToken: z.string().nullable().optional(),
  no_token: z.string().nullable().optional(),
  noPositionTokenId: z.string().nullable().optional(),
  no_position_token_id: z.string().nullable().optional(),
  conditionId: z.string().nullable().optional(),
  condition_id: z.string().nullable().optional(),
  resultTokenId: z.string().nullable().optional(),
  result_token_id: z.string().nullable().optional(),
  volume: z.union([z.string(), z.number()]).nullable().optional(),
  volume24h: z.union([z.string(), z.number()]).nullable().optional(),
  volume7d: z.union([z.string(), z.number()]).nullable().optional(),
  quoteToken: z.string().nullable().optional(),
  quote_token: z.string().nullable().optional(),
  chainId: z.union([z.string(), z.number()]).nullable().optional(),
  chain_id: z.union([z.string(), z.number()]).nullable().optional(),
  questionId: z.string().nullable().optional(),
  question_id: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  created_at: z.union([z.string(), z.number()]).nullable().optional(),
  cutoffAt: z.union([z.string(), z.number()]).nullable().optional(),
  cutoff_at: z.union([z.string(), z.number()]).nullable().optional(),
  resolvedAt: z.union([z.string(), z.number()]).nullable().optional(),
  resolved_at: z.union([z.string(), z.number()]).nullable().optional()
}).passthrough();

const opinionEnvelopeSchema = z.object({
  result: z.object({
    list: z.array(opinionMarketSchema).optional(),
    items: z.array(opinionMarketSchema).optional()
  }).optional(),
  data: z.object({
    markets: z.array(opinionMarketSchema).optional(),
    items: z.array(opinionMarketSchema).optional()
  }).optional(),
  markets: z.array(opinionMarketSchema).optional(),
  items: z.array(opinionMarketSchema).optional()
}).passthrough();

export const parseOpinionMarketList = (payload: unknown): readonly z.infer<typeof opinionMarketSchema>[] => {
  const parsed = opinionEnvelopeSchema.parse(payload);
  return parsed.result?.list
    ?? parsed.result?.items
    ?? parsed.data?.markets
    ?? parsed.data?.items
    ?? parsed.markets
    ?? parsed.items
    ?? [];
};

export const parseOpinionMarketDetail = (payload: unknown): z.infer<typeof opinionMarketSchema> => {
  const record = asRecord(payload);
  const result = asRecord(record.result);
  const data = asRecord(result.data ?? record.data);
  const candidate = Object.keys(data).length > 0
    ? data
    : Object.keys(result).length > 0
      ? result
      : record;
  if (!hasMarketIdentity(candidate)) {
    throw new Error("Opinion market detail payload did not contain market identity.");
  }
  return opinionMarketSchema.parse(candidate);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const hasMarketIdentity = (value: Record<string, unknown>): boolean =>
  [value.marketId, value.market_id, value.id].some((item) =>
    (typeof item === "string" || typeof item === "number") && String(item).trim().length > 0
  ) || [value.marketTitle, value.title, value.question].some((item) =>
    typeof item === "string" && item.trim().length > 0
  );
