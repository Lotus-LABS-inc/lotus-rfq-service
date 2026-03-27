import type {
  HistoricalCatalogManifestEntry
} from "./historical-route-catalog-manifest.js";

type HistoricalDiscoverySource = HistoricalCatalogManifestEntry["discoveredFrom"][number];
type HistoricalVenueProfile = HistoricalCatalogManifestEntry["venueProfiles"][number];

export interface HistoricalOpinionDiscoveryHint {
  expectedTitles: readonly string[];
  searchQueries: readonly string[];
  publicReference: string;
}

export interface HistoricalSeedVenueValidation {
  venue: HistoricalVenueProfile["venue"];
  validationKind: "predexon_polymarket" | "limitless_market_detail" | "predexon_opinion";
  expectedTitle: string;
  expectedReference: string;
}

export interface HistoricalRouteDiscoverySeed {
  historicalCanonicalEventId: string;
  historicalCanonicalMarketId: string;
  canonicalCategory: HistoricalCatalogManifestEntry["canonicalCategory"];
  title: string;
  venueProfiles: HistoricalVenueProfile[];
  discoveredFrom: HistoricalDiscoverySource[];
  validations: readonly HistoricalSeedVenueValidation[];
  opinionDiscovery?: HistoricalOpinionDiscoveryHint;
}

const windowRange = (start: string, end: string) => ({ start, end });

const equivalentWithLag = (marketAVenue: HistoricalVenueProfile["venue"], marketBVenue: HistoricalVenueProfile["venue"]) => ({
  marketAVenue,
  marketBVenue,
  riskScore: "0.05",
  confidenceScore: "0.95",
  equivalenceClass: "EQUIVALENT_WITH_LAG" as const,
  factorBreakdown: {
    propositionSimilarity: "1.00",
    outcomeSchemaCompatibility: "1.00",
    timingCompatibility: "0.96",
    resolutionCompatibility: "0.95",
    settlementCompatibility: "0.90",
    structureCompatibility: "1.00"
  },
  reasons: [
    "Exact proposition semantics were manually curated across the accepted venue profiles.",
    "Binary outcome semantics match on the same named participant or threshold proposition.",
    "Historical replay stays conservative for cross-venue settlement/finality timing."
  ],
  version: "historical-sim-catalog-v2"
});

export const historicalRouteDiscoverySeeds: readonly HistoricalRouteDiscoverySeed[] = [
  {
    historicalCanonicalEventId: "HISTSIM::LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF",
    historicalCanonicalMarketId: "HISTSIM-LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF",
    canonicalCategory: "POLITICS",
    title: "Democratic Presidential Nominee 2028: Jon Ossoff",
    discoveredFrom: [
      {
        type: "archived_known_id",
        reference: "6808",
        observation: "Known Opinion numeric market already observed locally and retained as historical single-venue inventory."
      }
    ],
    validations: [
      {
        venue: "OPINION",
        validationKind: "predexon_opinion",
        expectedTitle: "Democratic Presidential Nominee 2028: Jon Ossoff",
        expectedReference: "6808"
      }
    ],
    venueProfiles: [
      {
        venue: "OPINION",
        venueMarketId: "6808",
        title: "Democratic Presidential Nominee 2028: Jon Ossoff",
        historySource: "predexon_opinion",
        historyWindow: windowRange("2026-03-10T00:00:00.000Z", "2026-03-19T23:59:59.000Z"),
        copyFromLiveResolutionProfile: true
      }
    ]
  },
  {
    historicalCanonicalEventId: "HISTSIM::US-POLITICS-2028-DEM-NOM-GAVIN-NEWSOM",
    historicalCanonicalMarketId: "HISTSIM-US-POLITICS-2028-DEM-NOM-GAVIN-NEWSOM",
    canonicalCategory: "POLITICS",
    title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
    discoveredFrom: [
      {
        type: "curated_seed",
        reference: "politics:gavin-newsom-dem-nom-2028",
        observation: "Exact binary nominee proposition curated from documented Polymarket and Limitless market detail surfaces."
      },
      {
        type: "predexon_market_catalog",
        reference: "0x0f49db97f71c68b1e42a6d16e3de93d85dbf7d4148e3f018eb79e88554be9f75",
        observation: "Predexon Polymarket market catalog resolves the exact Gavin Newsom 2028 Democratic nomination market."
      }
    ],
    validations: [
      {
        venue: "POLYMARKET",
        validationKind: "predexon_polymarket",
        expectedTitle: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
        expectedReference: "0x0f49db97f71c68b1e42a6d16e3de93d85dbf7d4148e3f018eb79e88554be9f75"
      },
      {
        venue: "LIMITLESS",
        validationKind: "limitless_market_detail",
        expectedTitle: "Gavin Newsom",
        expectedReference: "gavin-newsom-1768927395479"
      }
    ],
    venueProfiles: [
      {
        venue: "POLYMARKET",
        venueMarketId: "0x0f49db97f71c68b1e42a6d16e3de93d85dbf7d4148e3f018eb79e88554be9f75",
        title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
        historySource: "predexon_polymarket",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      },
      {
        venue: "LIMITLESS",
        venueMarketId: "gavin-newsom-1768927395479",
        title: "Gavin Newsom",
        historySource: "predexon_limitless",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      }
    ],
    opinionDiscovery: {
      expectedTitles: ["Will Gavin Newsom win the 2028 Democratic presidential nomination?", "Gavin Newsom"],
      searchQueries: ['site:opinion.trade "Gavin Newsom" "2028 Democratic presidential nomination"'],
      publicReference: "https://docs.opinion.trade/developer-guide/opinion-open-api/overview"
    }
  },
  {
    historicalCanonicalEventId: "HISTSIM::CRYPTO-BTC-ALL-TIME-HIGH-BY-2026-03-31",
    historicalCanonicalMarketId: "HISTSIM-CRYPTO-BTC-ALL-TIME-HIGH-BY-2026-03-31",
    canonicalCategory: "CRYPTO",
    title: "Bitcoin all time high by March 31, 2026?",
    discoveredFrom: [
      {
        type: "curated_seed",
        reference: "crypto:btc-ath-by-2026-03-31",
        observation: "Exact binary ATH-by-date proposition curated across documented Polymarket and Limitless markets."
      },
      {
        type: "predexon_market_catalog",
        reference: "0x3fd88dc4dde49dd20ceade22fda96dc345aa6932c46237ff7f47352e49475588",
        observation: "Predexon Polymarket market catalog resolves the exact BTC ATH by March 31, 2026 market."
      }
    ],
    validations: [
      {
        venue: "POLYMARKET",
        validationKind: "predexon_polymarket",
        expectedTitle: "Bitcoin all time high by March 31, 2026?",
        expectedReference: "0x3fd88dc4dde49dd20ceade22fda96dc345aa6932c46237ff7f47352e49475588"
      },
      {
        venue: "LIMITLESS",
        validationKind: "limitless_market_detail",
        expectedTitle: "Bitcoin all time high by March 31?",
        expectedReference: "bitcoin-all-time-high-by-march-31-1767809993576"
      }
    ],
    venueProfiles: [
      {
        venue: "POLYMARKET",
        venueMarketId: "0x3fd88dc4dde49dd20ceade22fda96dc345aa6932c46237ff7f47352e49475588",
        title: "Bitcoin all time high by March 31, 2026?",
        historySource: "predexon_polymarket",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      },
      {
        venue: "LIMITLESS",
        venueMarketId: "bitcoin-all-time-high-by-march-31-1767809993576",
        title: "Bitcoin all time high by March 31?",
        historySource: "predexon_limitless",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      }
    ],
    opinionDiscovery: {
      expectedTitles: ["Bitcoin all time high by March 31, 2026?", "Bitcoin all time high by March 31?"],
      searchQueries: ['site:opinion.trade "Bitcoin all time high by March 31, 2026?"'],
      publicReference: "https://docs.opinion.trade/developer-guide/opinion-open-api/overview"
    }
  },
  {
    historicalCanonicalEventId: "HISTSIM::SPORTS-2026-NBA-CHAMPION-OKLAHOMA-CITY-THUNDER",
    historicalCanonicalMarketId: "HISTSIM-SPORTS-2026-NBA-CHAMPION-OKLAHOMA-CITY-THUNDER",
    canonicalCategory: "SPORTS",
    title: "Will the Oklahoma City Thunder win the 2026 NBA Finals?",
    discoveredFrom: [
      {
        type: "curated_seed",
        reference: "sports:okc-thunder-2026-nba-finals",
        observation: "Exact same-team same-champion proposition curated across documented Polymarket and Limitless child markets."
      },
      {
        type: "predexon_market_catalog",
        reference: "0x22e7b5e35423e76842dd3a5e1a21d13793811080d5e7b2896d0c001bd5e97d54",
        observation: "Predexon Polymarket market catalog resolves the exact Oklahoma City Thunder 2026 NBA Finals winner market."
      }
    ],
    validations: [
      {
        venue: "POLYMARKET",
        validationKind: "predexon_polymarket",
        expectedTitle: "Will the Oklahoma City Thunder win the 2026 NBA Finals?",
        expectedReference: "0x22e7b5e35423e76842dd3a5e1a21d13793811080d5e7b2896d0c001bd5e97d54"
      },
      {
        venue: "LIMITLESS",
        validationKind: "limitless_market_detail",
        expectedTitle: "Oklahoma City Thunder",
        expectedReference: "oklahoma-city-thunder-1766486782236"
      }
    ],
    venueProfiles: [
      {
        venue: "POLYMARKET",
        venueMarketId: "0x22e7b5e35423e76842dd3a5e1a21d13793811080d5e7b2896d0c001bd5e97d54",
        title: "Will the Oklahoma City Thunder win the 2026 NBA Finals?",
        historySource: "predexon_polymarket",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      },
      {
        venue: "LIMITLESS",
        venueMarketId: "oklahoma-city-thunder-1766486782236",
        title: "Oklahoma City Thunder",
        historySource: "predexon_limitless",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      }
    ],
    opinionDiscovery: {
      expectedTitles: ["Will the Oklahoma City Thunder win the 2026 NBA Finals?", "Oklahoma City Thunder"],
      searchQueries: ['site:opinion.trade "Oklahoma City Thunder" "2026 NBA Finals"'],
      publicReference: "https://docs.opinion.trade/developer-guide/opinion-open-api/overview"
    }
  },
  {
    historicalCanonicalEventId: "HISTSIM::SPORTS-2026-NHL-STANLEY-CUP-COLORADO-AVALANCHE",
    historicalCanonicalMarketId: "HISTSIM-SPORTS-2026-NHL-STANLEY-CUP-COLORADO-AVALANCHE",
    canonicalCategory: "SPORTS",
    title: "Will the Colorado Avalanche win the 2026 NHL Stanley Cup?",
    discoveredFrom: [
      {
        type: "curated_seed",
        reference: "sports:colorado-avalanche-2026-stanley-cup",
        observation: "Exact same-team same-champion proposition curated across documented Polymarket and Limitless child markets."
      },
      {
        type: "predexon_market_catalog",
        reference: "0xf8f63bb47b2a7c2e0c1be3cedf4075079b11c07476d76a9469065b0c4791961a",
        observation: "Predexon Polymarket market catalog resolves the exact Colorado Avalanche 2026 Stanley Cup winner market."
      }
    ],
    validations: [
      {
        venue: "POLYMARKET",
        validationKind: "predexon_polymarket",
        expectedTitle: "Will the Colorado Avalanche win the 2026 NHL Stanley Cup?",
        expectedReference: "0xf8f63bb47b2a7c2e0c1be3cedf4075079b11c07476d76a9469065b0c4791961a"
      },
      {
        venue: "LIMITLESS",
        validationKind: "limitless_market_detail",
        expectedTitle: "Colorado Avalanche",
        expectedReference: "colorado-avalanche-1766489096394"
      }
    ],
    venueProfiles: [
      {
        venue: "POLYMARKET",
        venueMarketId: "0xf8f63bb47b2a7c2e0c1be3cedf4075079b11c07476d76a9469065b0c4791961a",
        title: "Will the Colorado Avalanche win the 2026 NHL Stanley Cup?",
        historySource: "predexon_polymarket",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      },
      {
        venue: "LIMITLESS",
        venueMarketId: "colorado-avalanche-1766489096394",
        title: "Colorado Avalanche",
        historySource: "predexon_limitless",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      }
    ],
    opinionDiscovery: {
      expectedTitles: ["Will the Colorado Avalanche win the 2026 NHL Stanley Cup?", "Colorado Avalanche"],
      searchQueries: ['site:opinion.trade "Colorado Avalanche" "Stanley Cup"'],
      publicReference: "https://docs.opinion.trade/developer-guide/opinion-open-api/overview"
    }
  },
  {
    historicalCanonicalEventId: "HISTSIM::ESPORTS-LOL-LCK-2026-T1-WINS",
    historicalCanonicalMarketId: "HISTSIM-ESPORTS-LOL-LCK-2026-T1-WINS",
    canonicalCategory: "ESPORTS",
    title: "Will T1 win the LCK 2026 season playoffs?",
    discoveredFrom: [
      {
        type: "curated_seed",
        reference: "esports:t1-lck-2026-playoffs",
        observation: "Exact same-team same-winner proposition curated across documented Polymarket and Limitless child markets."
      },
      {
        type: "predexon_market_catalog",
        reference: "0x7b147310a79af60523698cf0bd2a91fbd18db3bd26aac843b25d6cd88788a3dc",
        observation: "Predexon Polymarket market catalog resolves the exact T1 LCK 2026 winner market."
      }
    ],
    validations: [
      {
        venue: "POLYMARKET",
        validationKind: "predexon_polymarket",
        expectedTitle: "Will T1 win the LCK 2026 season playoffs?",
        expectedReference: "0x7b147310a79af60523698cf0bd2a91fbd18db3bd26aac843b25d6cd88788a3dc"
      },
      {
        venue: "LIMITLESS",
        validationKind: "limitless_market_detail",
        expectedTitle: "T1",
        expectedReference: "t1-1769164336549"
      }
    ],
    venueProfiles: [
      {
        venue: "POLYMARKET",
        venueMarketId: "0x7b147310a79af60523698cf0bd2a91fbd18db3bd26aac843b25d6cd88788a3dc",
        title: "Will T1 win the LCK 2026 season playoffs?",
        historySource: "predexon_polymarket",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      },
      {
        venue: "LIMITLESS",
        venueMarketId: "t1-1769164336549",
        title: "T1",
        historySource: "predexon_limitless",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      }
    ],
    opinionDiscovery: {
      expectedTitles: ["Will T1 win the LCK 2026 season playoffs?", "T1"],
      searchQueries: ['site:opinion.trade "T1" "LCK 2026 season playoffs"'],
      publicReference: "https://docs.opinion.trade/developer-guide/opinion-open-api/overview"
    }
  },
  {
    historicalCanonicalEventId: "HISTSIM::ESPORTS-LOL-LCK-2026-GENG-WINS",
    historicalCanonicalMarketId: "HISTSIM-ESPORTS-LOL-LCK-2026-GENG-WINS",
    canonicalCategory: "ESPORTS",
    title: "Will Gen.G Esports win the LCK 2026 season playoffs?",
    discoveredFrom: [
      {
        type: "curated_seed",
        reference: "esports:geng-lck-2026-playoffs",
        observation: "Exact same-team same-winner proposition curated across documented Polymarket and Limitless child markets."
      },
      {
        type: "predexon_market_catalog",
        reference: "0x36668e37b463d0762bf6e4c053a44682f89fec1198ec07c279812067bb732604",
        observation: "Predexon Polymarket market catalog resolves the exact Gen.G Esports LCK 2026 winner market."
      }
    ],
    validations: [
      {
        venue: "POLYMARKET",
        validationKind: "predexon_polymarket",
        expectedTitle: "Will Gen.G Esports win the LCK 2026 season playoffs?",
        expectedReference: "0x36668e37b463d0762bf6e4c053a44682f89fec1198ec07c279812067bb732604"
      },
      {
        venue: "LIMITLESS",
        validationKind: "limitless_market_detail",
        expectedTitle: "Gen.G Esports",
        expectedReference: "geng-esports-1769164336537"
      }
    ],
    venueProfiles: [
      {
        venue: "POLYMARKET",
        venueMarketId: "0x36668e37b463d0762bf6e4c053a44682f89fec1198ec07c279812067bb732604",
        title: "Will Gen.G Esports win the LCK 2026 season playoffs?",
        historySource: "predexon_polymarket",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      },
      {
        venue: "LIMITLESS",
        venueMarketId: "geng-esports-1769164336537",
        title: "Gen.G Esports",
        historySource: "predexon_limitless",
        historyWindow: windowRange("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z")
      }
    ],
    opinionDiscovery: {
      expectedTitles: ["Will Gen.G Esports win the LCK 2026 season playoffs?", "Gen.G Esports"],
      searchQueries: ['site:opinion.trade "Gen.G Esports" "LCK 2026 season playoffs"'],
      publicReference: "https://docs.opinion.trade/developer-guide/opinion-open-api/overview"
    }
  }
];

export const buildSourceBackedHistoricalCandidate = (
  seed: HistoricalRouteDiscoverySeed,
  options: {
    additionalDiscoveredFrom?: readonly HistoricalDiscoverySource[];
    additionalVenueProfiles?: readonly HistoricalVenueProfile[];
  } = {}
): HistoricalCatalogManifestEntry => ({
  historicalCanonicalEventId: seed.historicalCanonicalEventId,
  historicalCanonicalMarketId: seed.historicalCanonicalMarketId,
  canonicalCategory: seed.canonicalCategory,
  title: seed.title,
  decision: {
    status: "unresolved",
    reasonCode: "awaiting_curated_approval",
    reason: "Source-backed historical exact match candidate validated against documented venue metadata and requires explicit checked-in approval."
  },
  discoveredFrom: [...seed.discoveredFrom, ...(options.additionalDiscoveredFrom ?? [])],
  venueProfiles: [...seed.venueProfiles, ...(options.additionalVenueProfiles ?? [])],
  acceptedAssessments: []
});

export const acceptedHistoricalPairAssessments = Object.freeze({
  politics: [equivalentWithLag("POLYMARKET", "LIMITLESS")],
  crypto: [equivalentWithLag("POLYMARKET", "LIMITLESS")],
  sports: [equivalentWithLag("POLYMARKET", "LIMITLESS")],
  esports: [equivalentWithLag("POLYMARKET", "LIMITLESS")]
});
