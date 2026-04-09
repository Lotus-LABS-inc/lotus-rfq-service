import { z } from "zod";

export const historicalCatalogCategorySchema = z.enum(["SPORTS", "CRYPTO", "POLITICS", "ESPORTS", "OTHER"]);
export const historicalCatalogVenueSchema = z.enum(["POLYMARKET", "LIMITLESS", "OPINION"]);
export const historicalCatalogDecisionStatusSchema = z.enum(["accepted", "unresolved", "rejected"]);
export const historicalCatalogHistorySourceSchema = z.enum([
  "predexon_polymarket",
  "predexon_limitless",
  "predexon_opinion",
  "limitless_direct"
]);

export const historicalCatalogProfileOverrideSchema = z.object({
  oracleType: z.string().optional(),
  oracleName: z.string().optional(),
  resolutionAuthorityType: z.string().optional(),
  primaryResolutionText: z.string().optional(),
  supplementalRulesText: z.string().optional(),
  disputeWindowHours: z.string().optional(),
  settlementLagHours: z.string().optional(),
  marketType: z.string().optional(),
  outcomeSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  hasAmbiguousTimeBoundary: z.boolean().optional(),
  hasAmbiguousJurisdictionBoundary: z.boolean().optional(),
  hasAmbiguousSourceReference: z.boolean().optional(),
  historicalDivergenceRate: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const historicalCatalogVenueProfileSchema = z.object({
  venue: historicalCatalogVenueSchema,
  venueMarketId: z.string().min(1),
  title: z.string().min(1),
  historySource: historicalCatalogHistorySourceSchema,
  historyWindow: z.object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true })
  }),
  copyFromLiveResolutionProfile: z.boolean().optional(),
  profileOverride: historicalCatalogProfileOverrideSchema.optional()
});

export const historicalCatalogAssessmentSchema = z.object({
  marketAVenue: historicalCatalogVenueSchema,
  marketBVenue: historicalCatalogVenueSchema,
  riskScore: z.string(),
  confidenceScore: z.string(),
  equivalenceClass: z.enum(["SAFE_EQUIVALENT", "EQUIVALENT_WITH_LAG", "CAUTION", "HIGH_RISK", "DO_NOT_POOL"]),
  factorBreakdown: z.record(z.string(), z.unknown()),
  reasons: z.array(z.string()),
  version: z.string(),
  liquidityCost: z.string().optional(),
  maxSettlementDelayHours: z.number().optional()
});

export const historicalCatalogManifestEntrySchema = z.object({
  historicalCanonicalEventId: z.string().min(1),
  historicalCanonicalMarketId: z.string().min(1),
  canonicalCategory: historicalCatalogCategorySchema,
  title: z.string().min(1),
  decision: z.object({
    status: historicalCatalogDecisionStatusSchema,
    reasonCode: z.string(),
    reason: z.string()
  }),
  discoveredFrom: z.array(
    z.object({
      type: z.enum([
        "db_inventory",
        "predexon_market_catalog",
        "curated_seed",
        "archived_known_id",
        "public_site",
        "search_query",
        "predexon_validation",
        "semantic_validation"
      ]),
      reference: z.string(),
      observation: z.string()
    })
  ),
  venueProfiles: z.array(historicalCatalogVenueProfileSchema).min(1),
  acceptedAssessments: z.array(historicalCatalogAssessmentSchema).default([])
});

export const historicalRouteCandidatesSchema = z.object({
  version: z.number().int().positive(),
  observedAt: z.string(),
  policy: z.object({
    exactMatchRule: z.string(),
    approvalMode: z.string(),
    catalogScope: z.literal("historical_simulation")
  }),
  candidates: z.array(historicalCatalogManifestEntrySchema)
});

export const historicalRouteCurationSchema = z.object({
  version: z.number().int().positive(),
  observedAt: z.string(),
  policy: z.object({
    exactMatchRule: z.string(),
    approvalMode: z.string(),
    catalogScope: z.literal("historical_simulation")
  }),
  routes: z.array(historicalCatalogManifestEntrySchema)
});

export type HistoricalCatalogManifestEntry = z.infer<typeof historicalCatalogManifestEntrySchema>;
export type HistoricalRouteCandidates = z.infer<typeof historicalRouteCandidatesSchema>;
export type HistoricalRouteCuration = z.infer<typeof historicalRouteCurationSchema>;
