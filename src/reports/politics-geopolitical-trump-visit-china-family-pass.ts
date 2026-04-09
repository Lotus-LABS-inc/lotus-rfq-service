import type { Pool } from "pg";

import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import { buildPoliticsGeopoliticalTrumpVisitChinaFamilyArtifacts } from "../matching/politics/politics-geopolitical-trump-visit-china-family-pass.js";
import { PredictClient } from "../integrations/predict/predict-client.js";
import { PredictMarketAdapter } from "../integrations/predict/predict-market-adapter.js";
import { freshPoliticsRowToMatchingMarketRecord } from "./politics-opinion-limitless-live-census.js";
import { listRefreshedPoliticsMarkets, runPoliticsCurrentStateRefresh, type FreshPoliticsFetchRow, type PoliticsCurrentStateRefreshRunResult } from "./politics-current-state-refresh.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";

const ARTIFACT_DIR = "artifacts/politics/geopolitical-trump-visit-china-family-pass";
const TARGETED_URLS = [
  { venue: "OPINION", url: "https://app.opinion.trade/market/will-trump-visit-china-by" },
  { venue: "POLYMARKET", url: "https://polymarket.com/event/will-trump-visit-china-by" }
] as const;
const PREDICT_URL = "https://predict.fun/market/will-trump-visit-china-by";
const PREDICT_COMPONENT_MARKET_IDS_ENV_KEYS = [
  "PREDICT_GEOPOLITICAL_TRUMP_VISIT_CHINA_COMPONENT_MARKET_IDS",
  "PREDICT_TRUMP_VISIT_CHINA_COMPONENT_MARKET_IDS",
  "PREDICT_GEOPOLITICAL_TRUMP_VISIT_CHINA_MARKET_ID"
] as const;
const DATE_LABEL_PATTERN = /\b(March|April|May|June)\s+\d{1,2},\s+2026\b/gi;
const DATE_LABEL_EXACT_PATTERN = /^(March|April|May|June)\s+\d{1,2},\s+2026$/i;

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const decodeJsonEscapes = (value: string): string =>
  value
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n");

const extractFirstMatch = (text: string, patterns: readonly RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return decodeHtmlEntities(decodeJsonEscapes(value));
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

const canonicalRulesForLabel = (label: string): string =>
  `If U.S. President Donald Trump visits China by ${label}, 11:59 PM ET, this market will resolve to "Yes". Otherwise, this market will resolve to "No". `
  + `For the purpose of this market, a "visit" is defined as Trump physically entering the terrestrial or maritime territory of China. `
  + `Whether or not Trump enters Chinese airspace during the timeframe of this market will have no bearing on a positive resolution. `
  + `The primary resolution source will be official information from the United States government, official information from Trump or his verified social media accounts, however a consensus of credible reporting may also be used.`;

const buildSyntheticDateBucketRows = (input: {
  venue: FreshPoliticsFetchRow["venue"];
  venueMarketIdBase: string;
  sourceUrl: string;
  labels: readonly string[];
  discoveryPath: string;
}): readonly FreshPoliticsFetchRow[] =>
  input.labels.map((label) => ({
    venue: input.venue,
    venueMarketId: `${input.venueMarketIdBase}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    slug: toSlugFromUrl(input.sourceUrl),
    title: `Will Trump visit China by ${label}?`,
    rulesText: canonicalRulesForLabel(label),
    categoryHints: ["Politics", "Geopolitical Event By Date", "Trump Visit China"],
    tags: ["Politics", "Geopolitics", "Trump", "China", "Visit By Date"],
    active: true,
    publishedAt: null,
    expiresAt: new Date(`${label} 23:59:59 UTC`),
    resolvesAt: new Date(`${label} 23:59:59 UTC`),
    outcomes: [{ label: "Yes" }, { label: "No" }],
    sourceUrl: input.sourceUrl,
    rawPayload: {
      sourceUrl: input.sourceUrl,
      dateBucketLabel: label,
      syntheticTopic: "will-trump-visit-china-by"
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: input.discoveryPath
  }));

const extractDateLabels = (text: string): readonly string[] =>
  uniqueStrings([...text.matchAll(DATE_LABEL_PATTERN)].map((match) => match[0] ?? ""));

const parseOpinionRows = (html: string): readonly FreshPoliticsFetchRow[] => {
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
  ]) ?? "will-trump-visit-china-by";
  if (!title || !/\btrump\b/i.test(title) || !/\bchina\b/i.test(title) || !description) {
    return [];
  }
  const labels = description
    .split("|")
    .map((part) => part.split(":")[0]?.trim() ?? "")
    .filter((label) => DATE_LABEL_EXACT_PATTERN.test(label))
    .map((label) => label.replace(/\s+/g, " "));
  return buildSyntheticDateBucketRows({
    venue: "OPINION",
    venueMarketIdBase: venueMarketId,
    sourceUrl: TARGETED_URLS[0].url,
    labels: uniqueStrings(labels),
    discoveryPath: "opinion_direct_market_page_geopolitical_trump_visit_china_targeted"
  });
};

const parsePolymarketRows = (html: string): readonly FreshPoliticsFetchRow[] => {
  const title = extractFirstMatch(html, [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<meta\s+property="og:title"\s+content="([^"]+)"/i
  ])?.replace(/\s+Predictions.*$/i, "").trim();
  if (!title || !/\btrump\b/i.test(title) || !/\bchina\b/i.test(title)) {
    return [];
  }
  const labels = uniqueStrings([
    ...extractDateLabels(extractFirstMatch(html, [
      /"endDate":"([^"]+)"/i,
      /<meta\s+property="og:temporal:next_update_time"\s+content="([^"]+)"/i
    ]) ?? "").map((value) => {
      const isoDate = new Date(value);
      return Number.isNaN(isoDate.getTime())
        ? ""
        : isoDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    }),
    ...[...html.matchAll(/mslug=will-trump-visit-china-by-([a-z]+)-(\d{1,2})/gi)].map((match) => {
      const monthSlug = match[1]?.toLowerCase() ?? "";
      const day = match[2] ?? "";
      const monthLabel =
        monthSlug === "march" ? "March"
        : monthSlug === "april" ? "April"
        : monthSlug === "may" ? "May"
        : monthSlug === "june" ? "June"
        : "";
      return monthLabel && day ? `${monthLabel} ${Number.parseInt(day, 10)}, 2026` : "";
    })
  ].filter((value) => DATE_LABEL_EXACT_PATTERN.test(value)));
  return buildSyntheticDateBucketRows({
    venue: "POLYMARKET",
    venueMarketIdBase: toSlugFromUrl(TARGETED_URLS[1].url) ?? "will-trump-visit-china-by",
    sourceUrl: TARGETED_URLS[1].url,
    labels,
    discoveryPath: "polymarket_direct_market_page_geopolitical_trump_visit_china_targeted"
  });
};

const fetchPredictRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const apiKey = process.env.PREDICT_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }
  const client = new PredictClient({
    apiKey,
    environment: (process.env.PREDICT_ENVIRONMENT ?? "mainnet") as "mainnet" | "testnet"
  });
  const adapter = new PredictMarketAdapter({
    client,
    environment: (process.env.PREDICT_ENVIRONMENT ?? "mainnet") as "mainnet" | "testnet",
    metadataVersion: "predict-geopolitical-trump-visit-china-family-pass-v1"
  });
  const explicitIds = uniqueStrings(
    PREDICT_COMPONENT_MARKET_IDS_ENV_KEYS.flatMap((key) =>
      (process.env[key] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  if (explicitIds.length === 0) {
    return [];
  }

  const exactMarkets = [];
  for (const marketId of explicitIds) {
    try {
      exactMarkets.push(await adapter.getMarketById(marketId));
    } catch {
      continue;
    }
  }
  if (exactMarkets.length === 0) {
    return [];
  }

  const categorySlug = exactMarkets[0]?.categories[0] ?? null;
  const discovered = new Map<string, typeof exactMarkets[number]>();
  for (const market of exactMarkets) {
    discovered.set(market.venueMarketId, market);
  }
  const anchorId = Number.parseInt(exactMarkets[0]!.venueMarketId, 10);
  if (categorySlug !== null && Number.isFinite(anchorId)) {
    for (let offset = -4; offset <= 4; offset += 1) {
      if (offset === 0) {
        continue;
      }
      const candidateId = String(anchorId + offset);
      try {
        const market = await adapter.getMarketById(candidateId);
        if (market.categories.includes(categorySlug)) {
          discovered.set(market.venueMarketId, market);
        }
      } catch {
        continue;
      }
    }
  }

  return [...discovered.values()]
    .filter((market) => categorySlug !== null && market.categories.includes(categorySlug))
    .filter((market) => market.outcomes.length === 2 && market.outcomes.every((outcome) => /^(yes|no)$/i.test(outcome.label)))
    .map((market) => ({
      venue: "PREDICT" as const,
      venueMarketId: market.venueMarketId,
      slug: toSlugFromUrl(PREDICT_URL),
      title: `Will Trump visit China by ${market.title}?`,
      rulesText: market.description ?? canonicalRulesForLabel(market.title),
      categoryHints: ["Politics", "Predict", "Geopolitical Event By Date", "Trump Visit China"],
      tags: ["Politics", "Geopolitics", "Trump", "China", "Visit By Date"],
      active: /open|active|registered|unpaused/i.test(market.status ?? ""),
      publishedAt: market.createdAt,
      expiresAt: market.closesAt,
      resolvesAt: market.resolvesAt,
      outcomes: [{ label: "Yes" }, { label: "No" }],
      sourceUrl: PREDICT_URL,
      rawPayload: market.raw,
      fetchTimestamp: new Date().toISOString(),
      discoveryPath: "predict_exact_market_api_geopolitical_trump_visit_china_targeted"
    }));
};

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const buildOperatorSummary = (input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: readonly { topicKey: string; venuesPresent: readonly string[]; routeabilityCandidate: string }[];
  finalDecision: { bestCandidateTopicKey: string | null; matcherFollowUpJustified: boolean; singleBestNextAction: string };
}) =>
  [
    "# Politics Geopolitical Trump Visit China Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.topicKey}(${topic.venuesPresent.join("|")}:${topic.routeabilityCandidate})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface PoliticsGeopoliticalTrumpVisitChinaFamilyPassRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsGeopoliticalTrumpVisitChinaFamilyPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsGeopoliticalTrumpVisitChinaFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-fetch-summary.json`);
    } catch {
      return null;
    }
  })();

  const refresh = await runPoliticsCurrentStateRefresh(input);
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
      targetedRows.push(...(target.venue === "OPINION" ? parseOpinionRows(html) : parsePolymarketRows(html)));
    } catch {
      continue;
    }
  }

  targetedRows.push(...await fetchPredictRows());

  const extractedRows = [
    ...refreshedRows,
    ...refresh.admittedRows.map((row) =>
      extractPoliticsInventoryRow(
        freshPoliticsRowToMatchingMarketRecord(row, "politics-geopolitical-trump-visit-china-family-pass-refresh-v1")
      )
    ),
    ...targetedRows.map((row) =>
      extractPoliticsInventoryRow(
        freshPoliticsRowToMatchingMarketRecord(row, "politics-geopolitical-trump-visit-china-family-pass-targeted-v1")
      )
    )
  ].filter((row) =>
    /\btrump\b/i.test(row.title)
    && /\bchina\b/i.test(`${row.title} ${row.rulesText ?? ""}`)
    && row.family === "GEOPOLITICAL_EVENT_BY_DATE"
  );

  const artifacts = buildPoliticsGeopoliticalTrumpVisitChinaFamilyArtifacts(extractedRows);
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

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-operator-summary.md`, `${operatorSummary}\n`);

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
