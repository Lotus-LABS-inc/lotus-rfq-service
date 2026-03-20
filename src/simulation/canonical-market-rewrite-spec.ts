export type RewriteCanonicalCategory = "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS";
export type RewriteVenue = "POLYMARKET" | "LIMITLESS" | "OPINION";

export interface CanonicalMarketRewriteTarget {
  venue: RewriteVenue;
  canonicalMarketId: string;
  primaryResolutionText: string;
}

export interface CanonicalMarketRewriteDefinition {
  oldCanonicalMarketId: string;
  legacyCanonicalMarketId: string;
  canonicalEventId: string;
  canonicalCategory: RewriteCanonicalCategory;
  targets: readonly CanonicalMarketRewriteTarget[];
}

export interface ExactOverlapAssessmentDefinition {
  canonicalEventId: string;
  canonicalMarketId: string;
  marketA: { venue: RewriteVenue };
  marketB: { venue: RewriteVenue };
  riskScore: string;
  confidenceScore: string;
  equivalenceClass: "SAFE_EQUIVALENT";
  factorBreakdown: Record<string, { score: number; reason: string }>;
  reasons: readonly string[];
  version: string;
}

export const CANONICAL_MARKET_REWRITE_SPEC: readonly CanonicalMarketRewriteDefinition[] = [
  {
    oldCanonicalMarketId: "SPORTS-M1",
    legacyCanonicalMarketId: "LEGACY-SPORTS-M1",
    canonicalEventId: "11111111-1111-4111-8111-111111111111",
    canonicalCategory: "SPORTS",
    targets: [
      {
        venue: "POLYMARKET",
        canonicalMarketId: "POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN",
        primaryResolutionText: "Lakers vs. Magic"
      },
      {
        venue: "LIMITLESS",
        canonicalMarketId: "LIMITLESS-MLB-DODGERS-GAME-WINNER",
        primaryResolutionText: "MLB: Dodgers vs Opponent - Winner"
      },
      {
        venue: "OPINION",
        canonicalMarketId: "OPINION-MLB-DODGERS-WORLD-SERIES-WIN",
        primaryResolutionText: "Dodgers win World Series"
      }
    ]
  },
  {
    oldCanonicalMarketId: "BTC-90K",
    legacyCanonicalMarketId: "LEGACY-BTC-90K",
    canonicalEventId: "22222222-2222-4222-8222-222222222222",
    canonicalCategory: "CRYPTO",
    targets: [
      {
        venue: "POLYMARKET",
        canonicalMarketId: "POLYMARKET-BTC-ALL-TIME-HIGH-BY-2026-03-31",
        primaryResolutionText: "Bitcoin all time high by March 31, 2026?"
      },
      {
        venue: "LIMITLESS",
        canonicalMarketId: "LIMITLESS-BTC-ABOVE-90K",
        primaryResolutionText: "BTC over $90k"
      },
      {
        venue: "OPINION",
        canonicalMarketId: "OPINION-BTC-ABOVE-90K-BY-2026-03-31",
        primaryResolutionText: "BTC over $90k by March 31, 2026"
      }
    ]
  },
  {
    oldCanonicalMarketId: "US-ELECTION-2028-DEM",
    legacyCanonicalMarketId: "LEGACY-US-ELECTION-2028-DEM",
    canonicalEventId: "66666666-6666-4666-8666-666666666666",
    canonicalCategory: "POLITICS",
    targets: [
      {
        venue: "POLYMARKET",
        canonicalMarketId: "POLYMARKET-2028-DEM-NOM-GAVIN-NEWSOM",
        primaryResolutionText: "Will Gavin Newsom win the 2028 Democratic presidential nomination?"
      },
      {
        venue: "LIMITLESS",
        canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
        primaryResolutionText: "US Election 2028: Democratic party wins"
      },
      {
        venue: "OPINION",
        canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
        primaryResolutionText: "US Election 2028: Democratic party wins"
      }
    ]
  },
  {
    oldCanonicalMarketId: "US-ELECTION-2028-GOP",
    legacyCanonicalMarketId: "LEGACY-US-ELECTION-2028-GOP",
    canonicalEventId: "66666666-6666-4666-8666-666666666666",
    canonicalCategory: "POLITICS",
    targets: [
      {
        venue: "POLYMARKET",
        canonicalMarketId: "POLYMARKET-2028-GOP-NOM-MIKE-PENCE",
        primaryResolutionText: "Will Mike Pence win the 2028 Republican presidential nomination?"
      },
      {
        venue: "LIMITLESS",
        canonicalMarketId: "US-ELECTION-2028-REPUBLICAN-WINS",
        primaryResolutionText: "US Election 2028: Republican party wins"
      },
      {
        venue: "OPINION",
        canonicalMarketId: "US-ELECTION-2028-REPUBLICAN-WINS",
        primaryResolutionText: "US Election 2028: Republican party wins"
      }
    ]
  },
  {
    oldCanonicalMarketId: "LOL-WORLDS-T1",
    legacyCanonicalMarketId: "LEGACY-LOL-WORLDS-T1",
    canonicalEventId: "77777777-7777-4777-8777-777777777777",
    canonicalCategory: "ESPORTS",
    targets: [
      {
        venue: "POLYMARKET",
        canonicalMarketId: "POLYMARKET-LOL-WORLDS-2026-LCK-TEAM-WINS",
        primaryResolutionText: "Will a team from LCK (South Korea) win LoL Worlds 2026?"
      },
      {
        venue: "LIMITLESS",
        canonicalMarketId: "LOL-WORLDS-2026-T1-WINS",
        primaryResolutionText: "League of Legends Worlds 2026: T1 wins"
      },
      {
        venue: "OPINION",
        canonicalMarketId: "LOL-WORLDS-2026-T1-WINS",
        primaryResolutionText: "League of Legends Worlds 2026: T1 wins"
      }
    ]
  },
  {
    oldCanonicalMarketId: "LOL-WORLDS-GENG",
    legacyCanonicalMarketId: "LEGACY-LOL-WORLDS-GENG",
    canonicalEventId: "77777777-7777-4777-8777-777777777777",
    canonicalCategory: "ESPORTS",
    targets: [
      {
        venue: "POLYMARKET",
        canonicalMarketId: "POLYMARKET-LOL-2026-GENG-GOLDEN-ROAD",
        primaryResolutionText: "Will Gen.G complete the League of Legends \"Golden Road\" in 2026?"
      },
      {
        venue: "LIMITLESS",
        canonicalMarketId: "LOL-WORLDS-2026-GENG-WINS",
        primaryResolutionText: "League of Legends Worlds 2026: Gen.G wins"
      },
      {
        venue: "OPINION",
        canonicalMarketId: "LOL-WORLDS-2026-GENG-WINS",
        primaryResolutionText: "League of Legends Worlds 2026: Gen.G wins"
      }
    ]
  }
] as const;

export const EXACT_OVERLAP_ASSESSMENTS: readonly ExactOverlapAssessmentDefinition[] = [
  {
    canonicalEventId: "66666666-6666-4666-8666-666666666666",
    canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
    marketA: { venue: "LIMITLESS" },
    marketB: { venue: "OPINION" },
    riskScore: "0.05",
    confidenceScore: "0.95",
    equivalenceClass: "SAFE_EQUIVALENT",
    factorBreakdown: {
      oracle: { score: 0, reason: "Matching authority" },
      wording: { score: 0.04, reason: "Equivalent party-wins-election phrasing" }
    },
    reasons: ["Aligned 2028 Democratic party-wins market"],
    version: "v1"
  },
  {
    canonicalEventId: "66666666-6666-4666-8666-666666666666",
    canonicalMarketId: "US-ELECTION-2028-REPUBLICAN-WINS",
    marketA: { venue: "LIMITLESS" },
    marketB: { venue: "OPINION" },
    riskScore: "0.05",
    confidenceScore: "0.95",
    equivalenceClass: "SAFE_EQUIVALENT",
    factorBreakdown: {
      oracle: { score: 0, reason: "Matching authority" },
      wording: { score: 0.04, reason: "Equivalent party-wins-election phrasing" }
    },
    reasons: ["Aligned 2028 Republican party-wins market"],
    version: "v1"
  },
  {
    canonicalEventId: "77777777-7777-4777-8777-777777777777",
    canonicalMarketId: "LOL-WORLDS-2026-T1-WINS",
    marketA: { venue: "LIMITLESS" },
    marketB: { venue: "OPINION" },
    riskScore: "0.05",
    confidenceScore: "0.95",
    equivalenceClass: "SAFE_EQUIVALENT",
    factorBreakdown: {
      oracle: { score: 0, reason: "Matching authority" },
      wording: { score: 0.02, reason: "Equivalent team-wins-Worlds phrasing" }
    },
    reasons: ["Aligned T1 wins Worlds market"],
    version: "v1"
  },
  {
    canonicalEventId: "77777777-7777-4777-8777-777777777777",
    canonicalMarketId: "LOL-WORLDS-2026-GENG-WINS",
    marketA: { venue: "LIMITLESS" },
    marketB: { venue: "OPINION" },
    riskScore: "0.05",
    confidenceScore: "0.95",
    equivalenceClass: "SAFE_EQUIVALENT",
    factorBreakdown: {
      oracle: { score: 0, reason: "Matching authority" },
      wording: { score: 0.02, reason: "Equivalent team-wins-Worlds phrasing" }
    },
    reasons: ["Aligned Gen.G wins Worlds market"],
    version: "v1"
  }
] as const;

export const BROKEN_CANONICAL_MARKET_IDS = CANONICAL_MARKET_REWRITE_SPEC.map(
  (entry) => entry.oldCanonicalMarketId
);
