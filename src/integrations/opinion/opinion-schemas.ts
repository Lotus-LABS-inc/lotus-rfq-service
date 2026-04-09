import { z } from "zod";

const opinionMarketSchema = z.object({
  marketId: z.union([z.string(), z.number()]),
  marketTitle: z.string(),
  slug: z.string().nullable().optional(),
  status: z.number().int().nullable().optional(),
  statusEnum: z.string().nullable().optional(),
  labels: z.array(z.string()).default([]),
  rules: z.string().nullable().optional(),
  yesLabel: z.string().nullable().optional(),
  noLabel: z.string().nullable().optional(),
  volume: z.union([z.string(), z.number()]).nullable().optional(),
  volume24h: z.union([z.string(), z.number()]).nullable().optional(),
  volume7d: z.union([z.string(), z.number()]).nullable().optional(),
  quoteToken: z.string().nullable().optional(),
  chainId: z.union([z.string(), z.number()]).nullable().optional(),
  questionId: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  cutoffAt: z.union([z.string(), z.number()]).nullable().optional(),
  resolvedAt: z.union([z.string(), z.number()]).nullable().optional()
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
