import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { buildStableUuid, type CanonicalVenue } from "../../src/canonical/canonicalization-types.js";
import { CanonicalCompatibilityProjector } from "../../src/canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../../src/canonical/curated-canonical-graph.js";
import { CanonicalGraphProjector } from "../../src/canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityRepository } from "../../src/repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../src/repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../src/repositories/compatibility-version.repository.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

type Category = "CRYPTO" | "ESPORTS" | "POLITICS" | "SPORTS";

interface CuratedVenueEvidence {
  venue: CanonicalVenue;
  venueMarketId: string;
  rawLabel?: string;
}

interface CuratedFrontendMarket {
  category: Category;
  key: string;
  title: string;
  normalizedTitle: string;
  artifact: string;
  evidence: CuratedVenueEvidence[];
}

const manualCuratedMarkets: readonly CuratedFrontendMarket[] = [
  {
    category: "CRYPTO",
    key: "CRYPTO|ATH_BY_DATE|ETH|2026-06-30",
    title: "Ethereum all time high by June 30, 2026?",
    normalizedTitle: "Ethereum all time high by June 30, 2026?",
    artifact: "artifacts/crypto/eth-ath-by-date-matcher/crypto-eth-ath-by-date-pair-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "june-30-2026-1775136208593" },
      { venue: "POLYMARKET", venueMarketId: "ethereum-all-time-high-by-june-30-2026" }
    ]
  },
  {
    category: "CRYPTO",
    key: "CRYPTO|ATH_BY_DATE|ETH|2026-09-30",
    title: "Ethereum all time high by September 30, 2026?",
    normalizedTitle: "Ethereum all time high by September 30, 2026?",
    artifact: "artifacts/crypto/eth-ath-by-date-matcher/crypto-eth-ath-by-date-pair-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "september-30-2026-1775136208604" },
      { venue: "POLYMARKET", venueMarketId: "ethereum-all-time-high-by-september-30-2026" }
    ]
  },
  {
    category: "CRYPTO",
    key: "CRYPTO|ATH_BY_DATE|ETH|2026-12-31",
    title: "Ethereum all time high by December 31, 2026?",
    normalizedTitle: "Ethereum all time high by December 31, 2026?",
    artifact: "artifacts/crypto/eth-ath-by-date-matcher/crypto-eth-ath-by-date-pair-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "december-31-2026-1775136208609" },
      { venue: "POLYMARKET", venueMarketId: "ethereum-all-time-high-by-december-31-2026" }
    ]
  },
  {
    category: "ESPORTS",
    key: "ESPORTS|LEAGUE_WINNER|LPL|2026|BILIBILI_GAMING",
    title: "Will Bilibili Gaming win the LPL 2026 season?",
    normalizedTitle: "Will Bilibili Gaming win the LPL 2026 season?",
    artifact: "artifacts/sports/lpl-winner-2026-matcher/sports-lpl-winner-2026-pair-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "lol-lpl-2026-season-winner-1769165526999:bilibili-gaming" },
      { venue: "POLYMARKET", venueMarketId: "lol-lpl-2026-season-winner:bilibili-gaming" }
    ]
  },
  {
    category: "ESPORTS",
    key: "ESPORTS|LEAGUE_WINNER|LPL|2026|JD_GAMING",
    title: "Will JD Gaming win the LPL 2026 season?",
    normalizedTitle: "Will JD Gaming win the LPL 2026 season?",
    artifact: "artifacts/sports/lpl-winner-2026-matcher/sports-lpl-winner-2026-pair-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "lol-lpl-2026-season-winner-1769165526999:jd-gaming" },
      { venue: "POLYMARKET", venueMarketId: "lol-lpl-2026-season-winner:jd-gaming" }
    ]
  },
  {
    category: "ESPORTS",
    key: "ESPORTS|LEAGUE_WINNER|LPL|2026|TOP_ESPORTS",
    title: "Will Top Esports win the LPL 2026 season?",
    normalizedTitle: "Will Top Esports win the LPL 2026 season?",
    artifact: "artifacts/sports/lpl-winner-2026-matcher/sports-lpl-winner-2026-pair-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "lol-lpl-2026-season-winner-1769165526999:top-esports" },
      { venue: "POLYMARKET", venueMarketId: "lol-lpl-2026-season-winner:top-esports" }
    ]
  },
  {
    category: "ESPORTS",
    key: "ESPORTS|LEAGUE_WINNER|LPL|2026|WEIBO_GAMING",
    title: "Will Weibo Gaming win the LPL 2026 season?",
    normalizedTitle: "Will Weibo Gaming win the LPL 2026 season?",
    artifact: "artifacts/sports/lpl-winner-2026-matcher/sports-lpl-winner-2026-pair-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "lol-lpl-2026-season-winner-1769165526999:weibo-gaming" },
      { venue: "POLYMARKET", venueMarketId: "lol-lpl-2026-season-winner:weibo-gaming" }
    ]
  },
  {
    category: "POLITICS",
    key: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|DONALD_TRUMP",
    title: "Republican Presidential Nominee 2028: Donald Trump",
    normalizedTitle: "Republican Presidential Nominee 2028: Donald Trump",
    artifact: "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-matcher-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "republican-presidential-nominee-2028-1768931335047", rawLabel: "Donald Trump" },
      { venue: "POLYMARKET", venueMarketId: "0x895e01dbf3e6a33cd9a44ca0f8cdb5df1bd2b0b6ebed5300d28f8da7145145e4", rawLabel: "Donald Trump" }
    ]
  },
  {
    category: "POLITICS",
    key: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|DONALD_TRUMP_JR",
    title: "Republican Presidential Nominee 2028: Donald Trump Jr.",
    normalizedTitle: "Republican Presidential Nominee 2028: Donald Trump Jr.",
    artifact: "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-matcher-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "republican-presidential-nominee-2028-1768931335047", rawLabel: "Donald Trump Jr." },
      { venue: "POLYMARKET", venueMarketId: "0x4a9d58d4da874e26708f5bdb014eb07a06aeebb927068d169d43831595386557", rawLabel: "Donald Trump Jr." }
    ]
  },
  {
    category: "POLITICS",
    key: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|TED_CRUZ",
    title: "Republican Presidential Nominee 2028: Ted Cruz",
    normalizedTitle: "Republican Presidential Nominee 2028: Ted Cruz",
    artifact: "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-matcher-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "republican-presidential-nominee-2028-1768931335047", rawLabel: "Ted Cruz" },
      { venue: "POLYMARKET", venueMarketId: "0x0ac23db1e56971022bc7e822b907a2466c618b34104ea72bc9fa95e41c86a9c6", rawLabel: "Ted Cruz" }
    ]
  },
  {
    category: "POLITICS",
    key: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|TUCKER_CARLSON",
    title: "Republican Presidential Nominee 2028: Tucker Carlson",
    normalizedTitle: "Republican Presidential Nominee 2028: Tucker Carlson",
    artifact: "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-matcher-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "republican-presidential-nominee-2028-1768931335047", rawLabel: "Tucker Carlson" },
      { venue: "POLYMARKET", venueMarketId: "0x4273517fc8141d57ad1528ede46efdceebdb6a4da746d5de5bad216564209a1e", rawLabel: "Tucker Carlson" }
    ]
  },
  {
    category: "SPORTS",
    key: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|BRAZIL",
    title: "Will Brazil win the 2026 FIFA World Cup?",
    normalizedTitle: "Will Brazil win the 2026 FIFA World Cup?",
    artifact: "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-all-venue-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "2026-fifa-world-cup-winner-1765296582257:brazil" },
      { venue: "OPINION", venueMarketId: "2026-fifa-world-cup-winner:brazil" },
      { venue: "POLYMARKET", venueMarketId: "2026-fifa-world-cup-winner:brazil" },
      { venue: "PREDICT", venueMarketId: "1522" }
    ]
  },
  {
    category: "SPORTS",
    key: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|ENGLAND",
    title: "Will England win the 2026 FIFA World Cup?",
    normalizedTitle: "Will England win the 2026 FIFA World Cup?",
    artifact: "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-all-venue-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "2026-fifa-world-cup-winner-1765296582257:england" },
      { venue: "OPINION", venueMarketId: "2026-fifa-world-cup-winner:england" },
      { venue: "POLYMARKET", venueMarketId: "2026-fifa-world-cup-winner:england" },
      { venue: "PREDICT", venueMarketId: "1519" }
    ]
  },
  {
    category: "SPORTS",
    key: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|FRANCE",
    title: "Will France win the 2026 FIFA World Cup?",
    normalizedTitle: "Will France win the 2026 FIFA World Cup?",
    artifact: "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-all-venue-lanes.json",
    evidence: [
      { venue: "LIMITLESS", venueMarketId: "2026-fifa-world-cup-winner-1765296582257:france" },
      { venue: "OPINION", venueMarketId: "2026-fifa-world-cup-winner:france" },
      { venue: "POLYMARKET", venueMarketId: "2026-fifa-world-cup-winner:france" },
      { venue: "PREDICT", venueMarketId: "1520" }
    ]
  }
] as const;

const dryRun = process.argv.includes("--dry-run");
const approvalsOnly = process.argv.includes("--approvals-only");
const metadataVersion = "frontend-curated-catalog-v1";

interface ArtifactLaneEvidence {
  venue?: string;
  venueMarketId?: string;
  rawOutcomeLabel?: string;
  rawTitle?: string;
}

interface ArtifactLane {
  topicKey?: string;
  canonicalTopicKey?: string;
  canonicalTopic?: string;
  routeabilityDecision?: string;
  rulesDecision?: string;
  matcherReady?: boolean;
  candidateIdentityKey?: string;
  normalizedCandidateName?: string;
  candidate?: string;
  outcome?: string;
  club?: string;
  driver?: string;
  exactDateKey?: string;
  exactLaunchDate?: string;
  exactThresholdLabel?: string;
  exactFdvThresholdLabel?: string;
  evidence?: ArtifactLaneEvidence[];
}

const collectArtifactCuratedMarkets = (artifactRoot: string): CuratedFrontendMarket[] => {
  if (!existsSync(artifactRoot)) {
    return [];
  }
  const files = listJsonFiles(artifactRoot)
    .filter((file) => /(?:pair|tri|strict-all|all-venue).*lanes\.json$/i.test(path.basename(file)));
  const markets: CuratedFrontendMarket[] = [];
  for (const file of files) {
    const parsed = readJson(file);
    const lanes = Array.isArray(parsed?.matcherLanes) ? parsed.matcherLanes
      : Array.isArray(parsed?.lanes) ? parsed.lanes
        : [];
    for (const lane of lanes.filter(isArtifactLane)) {
      const market = laneToCuratedMarket(file, lane);
      if (market) {
        markets.push(market);
      }
    }
  }
  return markets;
};

const listJsonFiles = (root: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listJsonFiles(fullPath));
    } else if (entry.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
};

const readJson = (file: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const isArtifactLane = (value: unknown): value is ArtifactLane =>
  value !== null && typeof value === "object";

const laneToCuratedMarket = (file: string, lane: ArtifactLane): CuratedFrontendMarket | null => {
  const topic = lane.topicKey ?? lane.canonicalTopicKey ?? lane.canonicalTopic;
  if (!topic || !isApprovedLane(lane)) {
    return null;
  }
  const evidence = normalizeLaneEvidence(lane.evidence);
  if (evidence.length < 2) {
    return null;
  }
  const category = categoryFromTopic(topic, file);
  const outcomeKey = lane.candidateIdentityKey
    ?? slug(lane.normalizedCandidateName)
    ?? slug(lane.candidate)
    ?? slug(lane.outcome)
    ?? slug(lane.club)
    ?? slug(lane.driver)
    ?? slug(lane.exactDateKey)
    ?? slug(lane.exactLaunchDate)
    ?? slug(lane.exactThresholdLabel)
    ?? slug(lane.exactFdvThresholdLabel)
    ?? "YES";
  const key = `${topic}|${outcomeKey.toUpperCase()}`;
  const label = displayLaneLabel(lane, topic);
  const title = `${eventTitleFromTopic(topic)}: ${label}`;
  return {
    category,
    key,
    title,
    normalizedTitle: title,
    artifact: path.relative(process.cwd(), file).replace(/\\/g, "/"),
    evidence
  };
};

const isApprovedLane = (lane: ArtifactLane): boolean => {
  const routeability = lane.routeabilityDecision ?? "";
  const rules = lane.rulesDecision ?? "";
  return lane.matcherReady === true
    || /ROUTEABLE|READY/i.test(routeability)
    || /COMPATIBLE/i.test(rules);
};

const normalizeLaneEvidence = (evidence: ArtifactLaneEvidence[] | undefined): CuratedVenueEvidence[] => {
  if (!Array.isArray(evidence)) {
    return [];
  }
  return evidence
    .map((entry): CuratedVenueEvidence | null => {
      const venue = normalizeVenue(entry.venue);
      const venueMarketId = entry.venueMarketId?.trim();
      if (!venue || !venueMarketId) {
        return null;
      }
      return {
        venue,
        venueMarketId,
        rawLabel: entry.rawOutcomeLabel ?? entry.rawTitle ?? undefined
      };
    })
    .filter((entry): entry is CuratedVenueEvidence => entry !== null);
};

const normalizeVenue = (venue: string | undefined): CanonicalVenue | null => {
  const normalized = venue?.trim().toUpperCase();
  if (normalized === "PREDICT_FUN") {
    return "PREDICT";
  }
  return normalized === "POLYMARKET" || normalized === "LIMITLESS" || normalized === "OPINION" || normalized === "MYRIAD" || normalized === "PREDICT"
    ? normalized
    : null;
};

const categoryFromTopic = (topic: string, file: string): Category => {
  if (topic.startsWith("CRYPTO|")) {
    return "CRYPTO";
  }
  if (topic.startsWith("SPORTS|")) {
    return topic.includes("|LCK|") || topic.includes("|LPL|") ? "ESPORTS" : "SPORTS";
  }
  if (topic.includes("NOMINEE|") || topic.includes("OFFICE_") || topic.includes("PARTY_CONTROL|") || topic.includes("GEOPOLITICAL_")) {
    return "POLITICS";
  }
  return "SPORTS";
};

const displayLaneLabel = (lane: ArtifactLane, topic: string): string =>
  toTitleCase(
    lane.normalizedCandidateName
    ?? lane.candidate
    ?? lane.outcome
    ?? lane.club
    ?? lane.driver
    ?? lane.exactDateKey
    ?? lane.exactLaunchDate
    ?? lane.exactThresholdLabel
    ?? lane.exactFdvThresholdLabel
    ?? topic.split("|").at(-1)
    ?? "Yes"
  );

const eventTitleFromTopic = (topic: string): string => {
  const parts = topic.split("|").filter(Boolean);
  if (parts[0] === "NOMINEE" && parts[1] === "US_PRESIDENT" && parts[2] && parts[3]) {
    return `${toTitleCase(parts[3])} Presidential Nominee ${parts[2]}`;
  }
  if (parts[0] === "OFFICE_WINNER") {
    return `${toTitleCase(parts.slice(1).join(" "))} Winner`;
  }
  if (parts[0] === "PARTY_CONTROL") {
    return `${parts[3] ?? ""} ${toTitleCase(parts.slice(4).join(" "))}`.trim();
  }
  if (parts[0] === "GEOPOLITICAL_EVENT_BY_DATE") {
    return toTitleCase(parts.slice(1).join(" "));
  }
  if (parts[0] === "CRYPTO") {
    return toTitleCase(parts.slice(1, Math.min(parts.length, 4)).join(" "));
  }
  if (parts[0] === "SPORTS") {
    return `${toTitleCase(parts.slice(2).join(" "))} Winner`;
  }
  return toTitleCase(topic);
};

const slug = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || null;
};

const toTitleCase = (value: string): string =>
  value
    .replace(/[_|]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word === "us" || word === "usa" || word === "fdv" || word === "nba" || word === "nhl" || word === "epl" || word === "lck" || word === "lpl") {
        return word.toUpperCase();
      }
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");

const mergeCuratedMarkets = (markets: CuratedFrontendMarket[]): CuratedFrontendMarket[] => {
  const byKey = new Map<string, CuratedFrontendMarket>();
  for (const market of markets) {
    const existing = byKey.get(market.key);
    if (!existing || market.evidence.length > existing.evidence.length) {
      byKey.set(market.key, market);
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.category.localeCompare(right.category)
    || left.key.localeCompare(right.key)
  );
};

const artifactCuratedMarkets = collectArtifactCuratedMarkets(path.resolve(process.cwd(), "artifacts"));
const curatedMarkets = mergeCuratedMarkets([...manualCuratedMarkets, ...artifactCuratedMarkets]);

const toSeed = (market: CuratedFrontendMarket, evidence: CuratedVenueEvidence): CuratedCanonicalGraphSeed => ({
  canonicalEventId: buildStableUuid(`frontend-curated-event:${market.key}`),
  canonicalMarketId: `FRONTEND_CURATED:${market.key}:${evidence.venue}`,
  canonicalCategory: market.category,
  venue: evidence.venue,
  venueMarketId: `${evidence.venue}:${evidence.venueMarketId}:${market.key}`,
  title: market.title,
  description: market.normalizedTitle,
  marketType: "BINARY",
  marketClass: "BINARY",
  outcomes: [
    { id: "YES", label: "Yes", metadata: { venue: evidence.venue } },
    { id: "NO", label: "No", metadata: { venue: evidence.venue } }
  ],
  outcomeSchema: { marketShape: "binary", yesLabel: "Yes", noLabel: "No" },
  topics: [market.category.toLowerCase(), "frontend_curated"],
  resolutionSource: evidence.venue,
  resolutionTitle: market.title,
  resolutionRulesText: market.normalizedTitle,
  resolutionAuthorityType: "CENTRAL",
  settlementType: "unknown",
  rawSourcePayload: {
    source: "frontend-curated-catalog",
    sourceArtifact: market.artifact,
    venueMarketId: evidence.venueMarketId,
    rawLabel: evidence.rawLabel ?? null
  },
  normalizedPayload: {
    curatedKey: market.key,
    venueMarketId: evidence.venueMarketId,
    rawLabel: evidence.rawLabel ?? null
  },
  mappingLineage: ["frontend-curated-catalog", market.artifact],
  sourceMetadataVersion: metadataVersion,
  eventPropositionKey: `frontend-curated:${market.key}`,
  eventTitle: market.title,
  eventNormalizedPropositionText: market.normalizedTitle,
  eventSourceHints: {
    source: "frontend-curated-catalog",
    artifact: market.artifact
  },
  eventMetadata: {
    frontendCurated: true,
    curatedKey: market.key,
    sourceArtifact: market.artifact
  },
  propositionHints: {
    normalizedPropositionText: market.normalizedTitle,
    groupingHints: {
      curatedKey: market.key,
      sourceArtifact: market.artifact
    }
  },
  executableDisplayName: market.title,
  executableMetadata: {
    source: "frontend-curated-catalog",
    curatedKey: market.key,
    sourceArtifact: market.artifact
  }
});

const main = async (): Promise<void> => {
  const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL or DATABASE_URL is required.");
  }
  const target = new URL(databaseUrl);
  const useSsl = !["localhost", "127.0.0.1", "::1"].includes(target.hostname);

  const pool = new Pool({
    connectionString: databaseUrl,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    application_name: "seed-frontend-curated-markets",
    statement_timeout: 0,
    query_timeout: 0
  });

  try {
    await pool.query("SET statement_timeout = 0");
    const seeds = curatedMarkets.flatMap((market) => market.evidence.map((evidence) => toSeed(market, evidence)));
    if (!dryRun && !approvalsOnly) {
      const projector = new CanonicalGraphProjector(
        new CanonicalGraphRepository(pool),
        new CanonicalCompatibilityProjector(
          new CanonicalCompatibilityRepository(pool),
          new CompatibilityVersionRepository(pool)
        )
      );
      await projector.persistAndProject(new CuratedCanonicalGraphSnapshotBuilder().build(seeds));
    }

    if (!dryRun) {
      let sortPriority = 100;
      for (const market of curatedMarkets) {
        await pool.query(
          `INSERT INTO frontend_market_approvals (
             canonical_event_id,
             status,
             display_title,
             sort_priority,
             approved_by,
             approval_reason,
             metadata,
             approved_at,
             updated_at
           )
           VALUES ($1, 'APPROVED', $2, $3, $4, $5, $6::jsonb, now(), now())
           ON CONFLICT (canonical_event_id) DO UPDATE SET
             status = EXCLUDED.status,
             display_title = EXCLUDED.display_title,
             sort_priority = EXCLUDED.sort_priority,
             approved_by = EXCLUDED.approved_by,
             approval_reason = EXCLUDED.approval_reason,
             metadata = EXCLUDED.metadata,
             approved_at = now(),
             updated_at = now()`,
          [
            buildStableUuid(`frontend-curated-event:${market.key}`),
            market.title,
            sortPriority,
            process.env.FRONTEND_MARKET_APPROVAL_ACTOR ?? "codex-curated-seed",
            "reviewed curated frontend market catalog seed",
            JSON.stringify({
              source: "frontend-curated-catalog",
              curatedKey: market.key,
              sourceArtifact: market.artifact
            })
          ]
        );
        sortPriority += 10;
      }
    }

    const categoryCounts = curatedMarkets.reduce<Record<string, number>>((acc, market) => {
      acc[market.category] = (acc[market.category] ?? 0) + 1;
      return acc;
    }, {});
    console.log(JSON.stringify({
      dryRun,
      approvalsOnly,
      database: { host: target.hostname, database: target.pathname.replace(/^\//, "") },
      curatedMarketCount: curatedMarkets.length,
      venueProfileSeedCount: seeds.length,
      categoryCounts
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
