import "dotenv/config";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import type { CryptoTokenLaunchByDateProjectConfig } from "../matching/crypto/crypto-token-launch-by-date-assets.js";
import {
  buildCryptoTokenLaunchByDateFamilyArtifacts,
  buildCryptoTokenLaunchByDateMatcherMaterialization,
  type CryptoTokenLaunchByDateComparabilityTopicSummary,
  type CryptoTokenLaunchByDateExtractedRow,
  type CryptoTokenLaunchByDateNormalizedTopicRow
} from "../matching/crypto/crypto-token-launch-by-date-shared.js";

interface PolymarketEventMarket {
  id: string | number;
  slug?: string | null;
  question?: string | null;
  description?: string | null;
  groupItemTitle?: string | null;
  endDate?: string | null;
  outcomes?: string | null;
}

interface PredictCategoryMarket {
  id: string | number;
  title?: string | null;
  question?: string | null;
  description?: string | null;
  endDate?: string | null;
  outcomes?: Array<{ name?: string | null }> | null;
}

const fetchJson = async <T>(url: string, headers: Record<string, string> = {}): Promise<T | null> => {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
        ...headers
      }
    });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
};

const monthLookup: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12"
};

const lastDayOfYear = (text: string): string | null => {
  const match = text.match(/\bin\s+(20\d{2})\b|\bby\s+(20\d{2})\b/i);
  const year = match?.[1] ?? match?.[2];
  return year ? `${year}-12-31` : null;
};

const parseLaunchDateKey = (value: string, fallbackEndDate?: string | null): string | null => {
  const calendarMatch = value.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i);
  if (calendarMatch) {
    const month = monthLookup[calendarMatch[1]!.toLowerCase()];
    const day = calendarMatch[2]!.padStart(2, "0");
    const year = calendarMatch[3] ?? fallbackEndDate?.slice(0, 4);
    if (month && year) return `${year}-${month}-${day}`;
  }
  const yearEnd = lastDayOfYear(value);
  if (yearEnd) return yearEnd;
  return null;
};

const buildCanonicalRules = (config: CryptoTokenLaunchByDateProjectConfig, dateKey: string): string =>
  `This market resolves to Yes if ${config.displayName} launches a token on or before ${dateKey}. Otherwise it resolves to No.`;

const uniqueRows = (
  rows: readonly CryptoTokenLaunchByDateExtractedRow[]
): readonly CryptoTokenLaunchByDateExtractedRow[] => {
  const byVenueAndId = new Map<string, CryptoTokenLaunchByDateExtractedRow>();
  for (const row of rows) byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  return [...byVenueAndId.values()];
};

const parsePolymarketRows = (
  config: CryptoTokenLaunchByDateProjectConfig,
  markets: readonly PolymarketEventMarket[]
): readonly CryptoTokenLaunchByDateExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? market.groupItemTitle?.trim() ?? "";
    const dateKey = parseLaunchDateKey(title, market.endDate);
    const outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : null;
    if (!title || !dateKey || !Array.isArray(outcomes) || outcomes.length !== 2) return [];
    return [{
      interpretedContractId: `polymarket-${config.artifactKey}-${market.id}`,
      venue: "POLYMARKET" as const,
      venueMarketId: String(market.id),
      sourceUrl: `${config.polymarketEventUrl}/${market.slug ?? ""}`.replace(/\/$/, ""),
      title,
      rulesText: typeof market.description === "string" ? market.description : buildCanonicalRules(config, dateKey),
      dateKey
    }];
  });

const parsePredictRows = (
  config: CryptoTokenLaunchByDateProjectConfig,
  markets: readonly PredictCategoryMarket[]
): readonly CryptoTokenLaunchByDateExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? market.title?.trim() ?? "";
    const dateKey = parseLaunchDateKey(title, market.endDate);
    const outcomeNames = (market.outcomes ?? [])
      .map((outcome) => typeof outcome.name === "string" ? outcome.name.toLowerCase() : null)
      .filter((value): value is string => value !== null);
    if (!title || !dateKey || outcomeNames.length !== 2 || !outcomeNames.includes("yes") || !outcomeNames.includes("no")) return [];
    return [{
      interpretedContractId: `predict-${config.artifactKey}-${market.id}`,
      venue: "PREDICT" as const,
      venueMarketId: String(market.id),
      sourceUrl: `https://predict.fun/market/${config.predictCategorySlug}`,
      title,
      rulesText: typeof market.description === "string" ? market.description : buildCanonicalRules(config, dateKey),
      dateKey
    }];
  });

export const runCryptoTokenLaunchByDateFamilyPass = async (input: {
  repoRoot: string;
  config: CryptoTokenLaunchByDateProjectConfig;
}) => {
  const { config } = input;
  const artifactDir = `artifacts/crypto/${config.artifactKey}-family-pass`;
  const stem = `crypto-${config.artifactKey}`;
  const [polymarketEvent, predictCategory] = await Promise.all([
    fetchJson<{ markets?: PolymarketEventMarket[] }>(`https://gamma-api.polymarket.com/events/slug/${config.polymarketEventSlug}`),
    fetchJson<{ data?: { markets?: PredictCategoryMarket[] } }>(
      `https://api.predict.fun/v1/categories/${config.predictCategorySlug}`,
      process.env.PREDICT_API_KEY?.trim() ? { "x-api-key": process.env.PREDICT_API_KEY.trim() } : {}
    )
  ]);
  const rows = uniqueRows([
    ...parsePolymarketRows(config, polymarketEvent?.markets ?? []),
    ...parsePredictRows(config, predictCategory?.data?.markets ?? [])
  ]);
  const artifacts = buildCryptoTokenLaunchByDateFamilyArtifacts(config, rows);
  const fetchSummary = {
    rowsFetchedByVenue: artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: artifacts.fetchSummaryInput.rowsAdmittedByVenue,
    excludedDates: config.excludedDates,
    opinionAdmissionStatus: config.opinionMarketSlug ? "NOT_ADMITTED_FETCH_UNCERTAIN" : "NOT_CONFIGURED"
  };
  const operatorSummary = [
    `# Crypto ${config.project} Token Launch By Date Family Pass`,
    "",
    `- family supply by venue: ${JSON.stringify(fetchSummary.rowsAdmittedByVenue)}`,
    `- shared launch dates: ${artifacts.comparabilitySummary.filter((topic) => topic.matcherCandidate).map((topic) => topic.canonicalDateKey).join(", ") || "none"}`,
    `- excluded dates: ${config.excludedDates.join(", ") || "none"}`,
    `- single best next action: ${artifacts.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-admission-summary.json`, artifacts.admissionSummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-basis-fragmentation-summary.json`, artifacts.basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-final-decision.json`, artifacts.finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${artifactDir}/${stem}-operator-summary.md`, `${operatorSummary}\n`);
  return { fetchSummary, ...artifacts, operatorSummary };
};

export const runCryptoTokenLaunchByDateMatcherPass = async (input: {
  repoRoot: string;
  config: CryptoTokenLaunchByDateProjectConfig;
}) => {
  const { config } = input;
  const familyArtifactDir = `artifacts/crypto/${config.artifactKey}-family-pass`;
  const matcherArtifactDir = `artifacts/crypto/${config.artifactKey}-matcher`;
  const stem = `crypto-${config.artifactKey}`;
  const normalizedTopicsArtifact = readArtifact<CryptoTokenLaunchByDateNormalizedTopicRow[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-normalized-topics.json`
  );
  const comparabilityArtifact = readArtifact<CryptoTokenLaunchByDateComparabilityTopicSummary[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-comparability-summary.json`
  );
  const materialized = buildCryptoTokenLaunchByDateMatcherMaterialization({
    config,
    normalizedTopics: normalizedTopicsArtifact,
    comparabilitySummary: comparabilityArtifact
  });
  const inputSummary = {
    observedAt: new Date().toISOString(),
    exactFamily: config.familyKey,
    targetPair: "POLYMARKET|PREDICT",
    refreshedRowsUsed: normalizedTopicsArtifact.filter((row) => row.canonicalTopicKey !== null),
    familyComparabilitySourceArtifacts: {
      normalizedTopics: `${familyArtifactDir}/${stem}-normalized-topics.json`,
      comparabilitySummary: `${familyArtifactDir}/${stem}-comparability-summary.json`
    },
    admittedVenues: materialized.admittedVenues,
    admittedTopicKeys: materialized.admittedTopicKeys,
    exclusionsBeforeFinalLaneConstruction: materialized.rejections
  };
  const pairLanes = {
    observedAt: new Date().toISOString(),
    matcherLanes: materialized.pairLanes
  };
  const rejections = {
    observedAt: new Date().toISOString(),
    rejections: materialized.rejections
  };
  const finalDecision = {
    observedAt: new Date().toISOString(),
    ...materialized.finalDecision
  };
  const operatorSummary = [
    `# Crypto ${config.project} Token Launch By Date Matcher`,
    "",
    `- exact family: ${config.familyKey}`,
    "- target pair: POLYMARKET|PREDICT",
    `- shared launch dates: ${materialized.pairLanes.map((lane) => lane.exactLaunchDate).join(", ") || "none"}`,
    `- rejected dates: ${materialized.rejections.map((entry) => entry.exactLaunchDate).filter(Boolean).join(", ") || "none"}`,
    `- final decision: ${materialized.finalDecision.overallDecision}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-operator-summary.md`, `${operatorSummary}\n`);
  return { inputSummary, pairLanes, rejections, finalDecision, operatorSummary };
};
