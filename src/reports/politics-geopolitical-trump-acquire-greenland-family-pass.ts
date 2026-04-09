import type { Pool } from "pg";

import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import { buildPoliticsGeopoliticalTrumpAcquireGreenlandFamilyArtifacts } from "../matching/politics/politics-geopolitical-trump-acquire-greenland-family-pass.js";
import { PredictClient } from "../integrations/predict/predict-client.js";
import { PredictMarketAdapter } from "../integrations/predict/predict-market-adapter.js";
import { freshPoliticsRowToMatchingMarketRecord } from "./politics-opinion-limitless-live-census.js";
import { listRefreshedPoliticsMarkets, runPoliticsCurrentStateRefresh, type FreshPoliticsFetchRow, type PoliticsCurrentStateRefreshRunResult } from "./politics-current-state-refresh.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";

const ARTIFACT_DIR = "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass";
const TARGETED_URLS = [
  { venue: "LIMITLESS", url: "https://limitless.exchange/markets/will-trump-acquire-greenland-before-2027-1768930762585?rv=7Q4JYY4UXP" },
  { venue: "OPINION", url: "https://app.opinion.trade/market/will-the-us-acquire-part-of-greenland-in-2026" },
  { venue: "POLYMARKET", url: "https://polymarket.com/event/will-trump-acquire-greenland-before-2027" }
] as const;
const PREDICT_URL = "https://predict.fun/market/will-trump-acquire-greenland-before-2027";
const PREDICT_MARKET_ID_ENV_KEYS = [
  "PREDICT_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_MARKET_ID",
  "PREDICT_TRUMP_ACQUIRE_GREENLAND_MARKET_ID"
] as const;

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];

const extractFirstMatch = (text: string, patterns: readonly RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = (match?.[1] ?? match?.[0])?.trim();
    if (value) {
      return value;
    }
  }
  return null;
};

const toSlugFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
};

const buildDirectPageRow = (input: {
  venue: FreshPoliticsFetchRow["venue"];
  venueMarketId: string;
  title: string;
  rulesText: string;
  sourceUrl: string;
  discoveryPath: string;
}): FreshPoliticsFetchRow => ({
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  slug: toSlugFromUrl(input.sourceUrl),
  title: input.title,
  rulesText: input.rulesText,
  categoryHints: ["Politics", "Geopolitical Event By Date", "Trump Acquire Greenland"],
  tags: ["Politics", "Geopolitics", "Trump", "Greenland", "Acquisition"],
  active: true,
  publishedAt: null,
  expiresAt: new Date("2026-12-31T23:59:59Z"),
  resolvesAt: new Date("2026-12-31T23:59:59Z"),
  outcomes: [{ label: "Yes" }, { label: "No" }],
  sourceUrl: input.sourceUrl,
  rawPayload: { sourceUrl: input.sourceUrl, syntheticTopic: "will-trump-acquire-greenland-before-2027" },
  fetchTimestamp: new Date().toISOString(),
  discoveryPath: input.discoveryPath
});

const parseLimitlessRow = (html: string): readonly FreshPoliticsFetchRow[] => {
  const title = extractFirstMatch(html, [
    /<title>([^<]+)<\/title>/i,
    /"title":"([^"]+)"/i
  ]);
  const rulesText = extractFirstMatch(html, [
    /This market will resolve to \\?"Yes\\?" if[\s\S]+?credible reporting[^"]*/i,
    /This market will resolve to "Yes" if[\s\S]+?credible reporting[^<]*/i,
    /"description":"([^"]+)"/i
  ]);
  if (!title || !/\bgreenland\b/i.test(title) || !rulesText) {
    return [];
  }
  return [buildDirectPageRow({
    venue: "LIMITLESS",
    venueMarketId: "will-trump-acquire-greenland-before-2027-1768930762585",
    title,
    rulesText,
    sourceUrl: TARGETED_URLS[0].url,
    discoveryPath: "limitless_direct_market_page_geopolitical_trump_acquire_greenland_targeted"
  })];
};

const parseOpinionRow = (html: string): readonly FreshPoliticsFetchRow[] => {
  const title = extractFirstMatch(html, [
    /<title>([^<]+)<\/title>/i,
    /<meta\s+property="og:title"\s+content="([^"]+)"/i
  ]);
  const description = extractFirstMatch(html, [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /<meta\s+property="og:description"\s+content="([^"]+)"/i
  ]);
  const venueMarketId = extractFirstMatch(html, [
    /https:\/\/app\.opinion\.trade\/og\/[^/]+\/(\d+)/i
  ]) ?? "will-the-us-acquire-part-of-greenland-in-2026";
  if (!title || !/\bgreenland\b/i.test(title) || !description) {
    return [];
  }
  return [buildDirectPageRow({
    venue: "OPINION",
    venueMarketId,
    title,
    rulesText: `This market will resolve to "Yes" if the United States acquires part of Greenland by December 31, 2026, 11:59 PM ET. Otherwise this market resolves to "No".`,
    sourceUrl: TARGETED_URLS[1].url,
    discoveryPath: "opinion_direct_market_page_geopolitical_trump_acquire_greenland_targeted"
  })];
};

const parsePolymarketRow = (html: string): readonly FreshPoliticsFetchRow[] => {
  const title = extractFirstMatch(html, [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<meta\s+property="og:title"\s+content="([^"]+)"/i
  ])?.replace(/\s+Predictions.*$/i, "").trim();
  const rulesText = extractFirstMatch(html, [
    /This market will resolve to &quot;Yes&quot; if([^<]+)/i,
    /This market will resolve to "Yes" if([^<]+)/i,
    /"description":"([^"]+)"/i
  ]);
  if (!title || !/\bgreenland\b/i.test(title) || !rulesText) {
    return [];
  }
  return [buildDirectPageRow({
    venue: "POLYMARKET",
    venueMarketId: toSlugFromUrl(TARGETED_URLS[2].url) ?? "will-trump-acquire-greenland-before-2027",
    title,
    rulesText,
    sourceUrl: TARGETED_URLS[2].url,
    discoveryPath: "polymarket_direct_market_page_geopolitical_trump_acquire_greenland_targeted"
  })];
};

const fetchPredictRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const apiKey = process.env.PREDICT_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }
  const explicitIds = uniqueStrings(
    PREDICT_MARKET_ID_ENV_KEYS.flatMap((key) =>
      (process.env[key] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  if (explicitIds.length === 0) {
    return [];
  }

  const client = new PredictClient({
    apiKey,
    environment: (process.env.PREDICT_ENVIRONMENT ?? "mainnet") as "mainnet" | "testnet"
  });
  const adapter = new PredictMarketAdapter({
    client,
    environment: (process.env.PREDICT_ENVIRONMENT ?? "mainnet") as "mainnet" | "testnet",
    metadataVersion: "predict-geopolitical-trump-acquire-greenland-family-pass-v1"
  });

  const rows: FreshPoliticsFetchRow[] = [];
  for (const marketId of explicitIds) {
    try {
      const market = await adapter.getMarketById(marketId);
      if (!/\bgreenland\b/i.test(`${market.title} ${market.question} ${market.description ?? ""}`)) {
        continue;
      }
      rows.push({
        venue: "PREDICT",
        venueMarketId: market.venueMarketId,
        slug: toSlugFromUrl(PREDICT_URL),
        title: market.title,
        rulesText: market.description ?? market.question,
        categoryHints: ["Politics", "Predict", "Geopolitical Event By Date", "Trump Acquire Greenland"],
        tags: ["Politics", "Geopolitics", "Trump", "Greenland", "Acquisition"],
        active: /open|active|registered|unpaused/i.test(market.status ?? ""),
        publishedAt: market.createdAt,
        expiresAt: market.closesAt,
        resolvesAt: market.resolvesAt,
        outcomes: market.outcomes.map((outcome) => ({ label: outcome.label })),
        sourceUrl: PREDICT_URL,
        rawPayload: market.raw,
        fetchTimestamp: new Date().toISOString(),
        discoveryPath: "predict_exact_market_api_geopolitical_trump_acquire_greenland_targeted"
      });
    } catch {
      continue;
    }
  }
  return rows;
};

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const buildOperatorSummary = (input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: readonly { topicKey: string; venuesPresent: readonly string[]; routeabilityCandidate: string; comparabilityLabel: string }[];
  finalDecision: { bestCandidateTopicKey: string | null; matcherFollowUpJustified: boolean; singleBestNextAction: string };
}) =>
  [
    "# Politics Geopolitical Trump Acquire Greenland Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.topicKey}(${topic.venuesPresent.join("|")}:${topic.routeabilityCandidate}:${topic.comparabilityLabel})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface PoliticsGeopoliticalTrumpAcquireGreenlandFamilyPassRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsGeopoliticalTrumpAcquireGreenlandFamilyPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsGeopoliticalTrumpAcquireGreenlandFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-fetch-summary.json`);
    } catch {
      return null;
    }
  })();

  const refresh = await (async (): Promise<PoliticsCurrentStateRefreshRunResult> => {
    try {
      return await runPoliticsCurrentStateRefresh(input);
    } catch {
      return {
        fetchSummary: {},
        fetchByVenue: {},
        fetchStatus: { refreshBypassedForTopicLocalRepair: true },
        admissionSummary: {},
        admittedRows: [],
        admissionRejections: [],
        interpretationSummary: {},
        interpretedRows: [],
        storageRefreshSummary: {},
        storageDelta: {},
        deltaVsPriorCensus: {},
        deltaVsPriorNomineePass: {},
        fairnessSummary: {},
        postRefreshFinalDecision: {},
        operatorSummary: "refresh bypassed for narrow geopolitical Greenland repair"
      };
    }
  })();
  const refreshedRows = await listRefreshedPoliticsMarkets(input.pool);
  const targetedRows: FreshPoliticsFetchRow[] = [];

  for (const target of TARGETED_URLS) {
    try {
      const requestInit =
        target.venue === "POLYMARKET"
          ? {
              signal: AbortSignal.timeout(10_000),
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" }
            }
          : { signal: AbortSignal.timeout(10_000) };
      const response = await fetch(target.url, requestInit);
      if (!response.ok) {
        continue;
      }
      const html = await response.text();
      if (target.venue === "LIMITLESS") {
        targetedRows.push(...parseLimitlessRow(html));
      } else if (target.venue === "OPINION") {
        targetedRows.push(...parseOpinionRow(html));
      } else {
        targetedRows.push(...parsePolymarketRow(html));
      }
    } catch {
      continue;
    }
  }

  targetedRows.push(...await fetchPredictRows());

  const extractedRows = [
    ...refreshedRows,
    ...refresh.admittedRows.map((row) =>
      extractPoliticsInventoryRow(
        freshPoliticsRowToMatchingMarketRecord(row, "politics-geopolitical-trump-acquire-greenland-family-pass-refresh-v1")
      )
    ),
    ...targetedRows.map((row) =>
      extractPoliticsInventoryRow(
        freshPoliticsRowToMatchingMarketRecord(row, "politics-geopolitical-trump-acquire-greenland-family-pass-targeted-v1")
      )
    )
  ].filter((row) =>
    /\bgreenland\b/i.test(`${row.title} ${row.rulesText ?? ""}`)
    && /\btrump\b|\bunited states\b|\bus\b/i.test(`${row.title} ${row.rulesText ?? ""}`)
    && row.family === "GEOPOLITICAL_EVENT_BY_DATE"
  );

  const artifacts = buildPoliticsGeopoliticalTrumpAcquireGreenlandFamilyArtifacts(extractedRows);
  const priorAdmittedByVenue = toJsonCounts(priorFetchSummary?.["rowsAdmittedByVenue"]);
  const currentAdmittedByVenue = artifacts.fetchSummaryInput.rowsAdmittedByVenue;
  const priorTopics = toJsonCounts(priorFetchSummary?.["admittedTopicCandidates"]);
  const currentTopics = artifacts.admissionSummary.rowsAdmittedByTopicCandidate;

  const fetchSummary = {
    observedAt: new Date().toISOString(),
    rowsFetchedByVenue: artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: currentAdmittedByVenue,
    fetchStatusByVenue: refresh.fetchStatus,
    familySupplyChangedMaterially:
      JSON.stringify(priorAdmittedByVenue) !== JSON.stringify(currentAdmittedByVenue)
      || JSON.stringify(priorTopics) !== JSON.stringify(currentTopics),
    admittedTopicCandidates: currentTopics
  };

  const admissionSummary = {
    observedAt: new Date().toISOString(),
    totalAdmittedRows: artifacts.admissionSummary.totalAdmittedRows,
    rowsRejectedByReason: artifacts.admissionSummary.rowsRejectedByReason,
    rowsAdmittedByTopicCandidate: artifacts.admissionSummary.rowsAdmittedByTopicCandidate,
    venueBreakdown: artifacts.admissionSummary.venueBreakdown
  };

  const basisFragmentationSummary = {
    observedAt: new Date().toISOString(),
    blockerCounts: artifacts.basisFragmentationSummary.blockerCounts,
    topicBlockers: artifacts.basisFragmentationSummary.topicBlockers,
    unresolvedRows: artifacts.basisFragmentationSummary.unresolvedRows
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    ...artifacts.finalDecision
  };

  const operatorSummary = buildOperatorSummary({
    fetchSummary,
    comparabilitySummary: artifacts.comparabilitySummary,
    finalDecision: artifacts.finalDecision
  });

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-operator-summary.md`, `${operatorSummary}\n`);

  return {
    refresh,
    fetchSummary,
    admissionSummary,
    normalizedTopics: artifacts.normalizedTopicRows,
    comparabilitySummary: artifacts.comparabilitySummary,
    basisFragmentationSummary,
    finalDecision,
    operatorSummary
  };
};
