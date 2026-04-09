import type { LimitlessBtcDirectionalDiscoveryMap } from "./limitless-btc-directional-types.js";

export const buildLimitlessBtcDirectionalDiscoveryMap = (input: {
  limitlessApiKeyPresent: boolean;
}): LimitlessBtcDirectionalDiscoveryMap => ({
  observedAt: new Date().toISOString(),
  authoritativeDiscoverySurface: "limitless-live-market-loader",
  authenticatedEnrichmentAvailable: input.limitlessApiKeyPresent,
  surfaces: [
    {
      surfaceName: "limitless-live-market-loader",
      codePath: "src/integrations/limitless/limitless-live-market-loader.ts",
      authMode: "PUBLIC",
      temporalMode: "LIVE_CURRENT_STATE",
      payloadMode: "DISCOVERY",
      structuralFields: [
        "venueMarketId",
        "title",
        "description",
        "expiresAt",
        "status",
        "categories",
        "tags",
        "marketType"
      ],
      alreadyConsumedByLotus: true,
      strength: "STRONG",
      limitations: [
        "public HTML discovery only",
        "no guaranteed full market history",
        "cutoff semantics inferred from parsed content and expiration fields"
      ]
    },
    {
      surfaceName: "limitless-live-market-loader-snapshot-fallback",
      codePath: "src/integrations/limitless/limitless-live-market-loader.ts",
      authMode: "PUBLIC",
      temporalMode: "MIXED",
      payloadMode: "DISCOVERY",
      structuralFields: [
        "title",
        "description",
        "expirationTimestamp",
        "slug"
      ],
      alreadyConsumedByLotus: true,
      strength: "PARTIAL",
      limitations: [
        "snapshot-backed rather than guaranteed live",
        "cannot prove exact absence",
        "only as complete as checked-in HTML"
      ]
    },
    {
      surfaceName: "limitless-client-market-detail",
      codePath: "src/integrations/limitless/limitless-client.ts",
      authMode: "AUTHENTICATED",
      temporalMode: "LIVE_CURRENT_STATE",
      payloadMode: "DETAIL",
      structuralFields: [
        "title",
        "description",
        "expirationTimestamp",
        "status"
      ],
      alreadyConsumedByLotus: false,
      strength: input.limitlessApiKeyPresent ? "PARTIAL" : "WEAK",
      limitations: [
        "requires known slug",
        "cannot discover unknown markets by itself",
        "useful only as enrichment on already discovered candidates"
      ]
    },
    {
      surfaceName: "limitless-client-market-events",
      codePath: "src/integrations/limitless/limitless-client.ts",
      authMode: "AUTHENTICATED",
      temporalMode: "HISTORICAL",
      payloadMode: "EVENTS",
      structuralFields: [
        "event stream for known slug"
      ],
      alreadyConsumedByLotus: false,
      strength: "WEAK",
      limitations: [
        "requires known slug",
        "not a discovery surface",
        "not needed for exact-safe directional proof"
      ]
    },
    {
      surfaceName: "limitless-client-historical-price",
      codePath: "src/integrations/limitless/limitless-client.ts",
      authMode: "AUTHENTICATED",
      temporalMode: "HISTORICAL",
      payloadMode: "STATE",
      structuralFields: [
        "historical price series for known slug"
      ],
      alreadyConsumedByLotus: false,
      strength: "WEAK",
      limitations: [
        "requires known slug",
        "not a listing surface",
        "cannot reveal missing directional inventory"
      ]
    },
    {
      surfaceName: "ingest-limitless-live-markets.job",
      codePath: "src/jobs/ingest-limitless-live-markets.job.ts",
      authMode: "PUBLIC",
      temporalMode: "LIVE_CURRENT_STATE",
      payloadMode: "ENRICHMENT",
      structuralFields: [
        "same fields as limitless-live-market-loader"
      ],
      alreadyConsumedByLotus: true,
      strength: "PARTIAL",
      limitations: [
        "consumer of the live loader rather than an independent discovery path",
        "cannot discover beyond what the loader already exposes"
      ]
    },
    {
      surfaceName: "btc-limitless-counterpart-proof-audit",
      codePath: "src/operations/semantic-expansion/btc-limitless-counterpart-proof-audit.ts",
      authMode: input.limitlessApiKeyPresent ? "AUTHENTICATED" : "PUBLIC",
      temporalMode: "MIXED",
      payloadMode: "ENRICHMENT",
      structuralFields: [
        "family",
        "asset",
        "exactDate",
        "cutoffStyle"
      ],
      alreadyConsumedByLotus: false,
      strength: "PARTIAL",
      limitations: [
        "proof helper, not a raw discovery surface",
        "depends on underlying public loader and known-slug enrichment"
      ]
    },
    {
      surfaceName: "btc-venue-audit-sources",
      codePath: "src/operations/semantic-expansion/btc-venue-audit-sources.ts",
      authMode: input.limitlessApiKeyPresent ? "AUTHENTICATED" : "PUBLIC",
      temporalMode: "MIXED",
      payloadMode: "ENRICHMENT",
      structuralFields: [
        "family",
        "asset",
        "exactDate",
        "cutoffStyle",
        "reference"
      ],
      alreadyConsumedByLotus: false,
      strength: "PARTIAL",
      limitations: [
        "snapshot-derived candidate universe",
        "detail enrichment still requires known slug",
        "exact absence cannot be proven from this surface alone"
      ]
    }
  ]
});

export const buildLimitlessBtcDirectionalDiscoveryMapMarkdown = (
  artifact: LimitlessBtcDirectionalDiscoveryMap
): string => [
  "# Limitless BTC Directional Discovery Map",
  "",
  `- authoritative discovery surface: ${artifact.authoritativeDiscoverySurface ?? "none"}`,
  `- authenticated enrichment available: ${artifact.authenticatedEnrichmentAvailable ? "yes" : "no"}`,
  "",
  "| Surface | Auth | Temporal | Payload | Consumed | Strength | Notes |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...artifact.surfaces.map((surface) =>
    `| ${surface.surfaceName} | ${surface.authMode} | ${surface.temporalMode} | ${surface.payloadMode} | ${surface.alreadyConsumedByLotus ? "yes" : "no"} | ${surface.strength} | ${surface.limitations.join("; ")} |`
  ),
  ""
].join("\n");
