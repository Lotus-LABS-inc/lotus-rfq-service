import "dotenv/config";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildCryptoFirstToThresholdByDateFamilyArtifacts,
  buildCryptoFirstToThresholdByDateMatcherMaterialization,
  type CryptoFirstToThresholdComparabilityTopicSummary,
  type CryptoFirstToThresholdByDateExtractedRow,
  type CryptoFirstToThresholdByDateNormalizedTopicRow
} from "../matching/crypto/crypto-first-to-threshold-by-date-shared.js";
import type { CryptoFirstToThresholdByDateAssetConfig } from "../matching/crypto/crypto-first-to-threshold-by-date-assets.js";

interface PolymarketEventMarket {
  id: string | number;
  slug?: string | null;
  question?: string | null;
  description?: string | null;
  outcomes?: string | null;
}

interface PredictCategoryMarket {
  id: string | number;
  title?: string | null;
  question?: string | null;
  description?: string | null;
  outcomes?: Array<{ name?: string | null }> | null;
}

const uniqueRows = (
  rows: readonly CryptoFirstToThresholdByDateExtractedRow[]
): readonly CryptoFirstToThresholdByDateExtractedRow[] => {
  const byVenueAndId = new Map<string, CryptoFirstToThresholdByDateExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const normalizeThreshold = (value: string): number | null => {
  const match = value.match(/(\d+(?:,\d{3})*(?:\.\d+)?)(k|m|b)?/i);
  if (!match) {
    return null;
  }
  const base = Number.parseFloat(match[1]!.replace(/,/g, ""));
  const multiplier =
    !match[2] ? 1
    : match[2].toLowerCase() === "k" ? 1_000
    : match[2].toLowerCase() === "m" ? 1_000_000
    : 1_000_000_000;
  const normalized = base * multiplier;
  return Number.isFinite(normalized) ? normalized : null;
};

const sortOutcomeLabels = (outcomes: readonly string[]): readonly [string, string] | null => {
  if (outcomes.length !== 2) {
    return null;
  }
  const normalized = outcomes
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => {
      const leftValue = normalizeThreshold(left) ?? Number.MAX_SAFE_INTEGER;
      const rightValue = normalizeThreshold(right) ?? Number.MAX_SAFE_INTEGER;
      return leftValue - rightValue;
    });
  return normalized.length === 2 ? [normalized[0]!, normalized[1]!] : null;
};

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
    if (!response.ok) {
      return null;
    }
    return await response.json() as T;
  } catch {
    return null;
  }
};

const parsePolymarketRows = (
  config: CryptoFirstToThresholdByDateAssetConfig,
  markets: readonly PolymarketEventMarket[]
): readonly CryptoFirstToThresholdByDateExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? "";
    const outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : null;
    const orderedOutcomes = Array.isArray(outcomes)
      ? sortOutcomeLabels(outcomes.filter((value): value is string => typeof value === "string"))
      : null;
    if (!title || !orderedOutcomes) {
      return [];
    }
    return [{
      interpretedContractId: `polymarket-${config.asset.toLowerCase()}-first-threshold-${market.id}`,
      venue: "POLYMARKET",
      venueMarketId: String(market.id),
      sourceUrl: `${config.polymarketEventUrl}${market.slug ? `/${market.slug}` : ""}`.replace(/\/$/, ""),
      title,
      rulesText: market.description?.trim() ?? null,
      lowerOutcomeLabel: orderedOutcomes[0],
      higherOutcomeLabel: orderedOutcomes[1]
    }];
  });

const parsePredictRows = (
  config: CryptoFirstToThresholdByDateAssetConfig,
  markets: readonly PredictCategoryMarket[]
): readonly CryptoFirstToThresholdByDateExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? market.title?.trim() ?? "";
    const orderedOutcomes = sortOutcomeLabels(
      (market.outcomes ?? [])
        .map((outcome) => typeof outcome.name === "string" ? outcome.name : null)
        .filter((value): value is string => value !== null)
    );
    if (!title || !orderedOutcomes) {
      return [];
    }
    return [{
      interpretedContractId: `predict-${config.asset.toLowerCase()}-first-threshold-${market.id}`,
      venue: "PREDICT",
      venueMarketId: String(market.id),
      sourceUrl: `https://predict.fun/market/${config.predictCategorySlug}`,
      title,
      rulesText: market.description?.trim() ?? null,
      lowerOutcomeLabel: orderedOutcomes[0],
      higherOutcomeLabel: orderedOutcomes[1]
    }];
  });

export interface CryptoFirstToThresholdByDateFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export interface CryptoFirstToThresholdByDateMatcherRunResult {
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

const buildFamilyOperatorSummary = (
  config: CryptoFirstToThresholdByDateAssetConfig,
  input: {
    fetchSummary: Record<string, unknown>;
    comparabilitySummary: readonly {
      canonicalTopicKey: string;
      venuesPresent: readonly string[];
      exactOutcomeLabels: readonly string[];
    }[];
    finalDecision: { sharedCandidateTopicKeys: readonly string[]; matcherFollowUpJustified: boolean; singleBestNextAction: string };
  }
): string =>
  [
    `# Crypto ${config.asset} First To Threshold By Date Family Pass`,
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- shared binary markets: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")} => ${topic.exactOutcomeLabels.join(" vs ")})`).join(", ") || "none"}`,
    `- shared matcher candidates: ${input.finalDecision.sharedCandidateTopicKeys.join(", ") || "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export const runCryptoFirstToThresholdByDateFamilyPass = async (input: {
  repoRoot: string;
  config: CryptoFirstToThresholdByDateAssetConfig;
}): Promise<CryptoFirstToThresholdByDateFamilyPassRunResult> => {
  const { config } = input;
  const artifactDir = `artifacts/crypto/${config.artifactKey}-family-pass`;
  const stem = `crypto-${config.artifactKey}`;
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${artifactDir}/${stem}-fetch-summary.json`);
    } catch {
      return null;
    }
  })();

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

  const artifacts = buildCryptoFirstToThresholdByDateFamilyArtifacts(config, rows);
  const fetchSummary = {
    rowsFetchedByVenue: artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: artifacts.fetchSummaryInput.rowsAdmittedByVenue,
    priorRowsFetchedByVenue: toJsonCounts(priorFetchSummary?.["rowsFetchedByVenue"]),
    priorRowsAdmittedByVenue: toJsonCounts(priorFetchSummary?.["rowsAdmittedByVenue"])
  };
  const operatorSummary = buildFamilyOperatorSummary(config, {
    fetchSummary,
    comparabilitySummary: artifacts.comparabilitySummary,
    finalDecision: artifacts.finalDecision
  });

  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-admission-summary.json`, artifacts.admissionSummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-basis-fragmentation-summary.json`, artifacts.basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${artifactDir}/${stem}-final-decision.json`, artifacts.finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${artifactDir}/${stem}-operator-summary.md`, operatorSummary);

  return {
    fetchSummary,
    admissionSummary: artifacts.admissionSummary,
    normalizedTopics: artifacts.normalizedTopicRows,
    comparabilitySummary: artifacts.comparabilitySummary,
    basisFragmentationSummary: artifacts.basisFragmentationSummary,
    finalDecision: artifacts.finalDecision as unknown as Record<string, unknown>,
    operatorSummary
  };
};

export const runCryptoFirstToThresholdByDateMatcherPass = async (input: {
  repoRoot: string;
  config: CryptoFirstToThresholdByDateAssetConfig;
}): Promise<CryptoFirstToThresholdByDateMatcherRunResult> => {
  const { config } = input;
  const familyArtifactDir = `artifacts/crypto/${config.artifactKey}-family-pass`;
  const matcherArtifactDir = `artifacts/crypto/${config.artifactKey}-matcher`;
  const stem = `crypto-${config.artifactKey}`;

  const normalizedTopicsArtifact = readArtifact<CryptoFirstToThresholdByDateNormalizedTopicRow[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-normalized-topics.json`
  );
  const comparabilityArtifact = readArtifact<CryptoFirstToThresholdComparabilityTopicSummary[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-comparability-summary.json`
  );

  const materialized = buildCryptoFirstToThresholdByDateMatcherMaterialization({
    config,
    normalizedTopics: normalizedTopicsArtifact,
    comparabilitySummary: comparabilityArtifact
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    exactFamily: config.familyKey,
    targetPair: "POLYMARKET|PREDICT",
    refreshedRowsUsed: normalizedTopicsArtifact
      .filter((row) => row.canonicalTopicKey !== null)
      .map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        canonicalTopicKey: row.canonicalTopicKey,
        canonicalLowerThreshold: row.canonicalLowerThreshold,
        canonicalHigherThreshold: row.canonicalHigherThreshold,
        canonicalDeadlineDateKey: row.canonicalDeadlineDateKey,
        exactOutcomeLabels: row.exactOutcomeLabels
      })),
    familyComparabilitySourceArtifacts: {
      fetchSummary: `${familyArtifactDir}/${stem}-fetch-summary.json`,
      admissionSummary: `${familyArtifactDir}/${stem}-admission-summary.json`,
      normalizedTopics: `${familyArtifactDir}/${stem}-normalized-topics.json`,
      comparabilitySummary: `${familyArtifactDir}/${stem}-comparability-summary.json`,
      basisFragmentationSummary: `${familyArtifactDir}/${stem}-basis-fragmentation-summary.json`,
      finalDecision: `${familyArtifactDir}/${stem}-final-decision.json`
    },
    admittedVenues: materialized.admittedVenues,
    admittedTopicKeys: materialized.admittedTopicKeys,
    exclusionsBeforeFinalLaneConstruction: materialized.rejections
  };

  const pairLanes = {
    observedAt: new Date().toISOString(),
    matcherLanes: materialized.pairLanes.map((lane) => ({
      venuePair: lane.venuePair,
      canonicalTopicKey: lane.canonicalTopicKey,
      exactOutcomeLabels: lane.exactOutcomeLabels,
      lowerThreshold: lane.lowerThreshold,
      higherThreshold: lane.higherThreshold,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      operatorReviewRequiredReasons: lane.operatorReviewRequiredReasons,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    }))
  };

  const rejections = {
    observedAt: new Date().toISOString(),
    rejections: materialized.rejections
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    ...materialized.finalDecision
  };

  const outcomeCore = materialized.pairLanes.flatMap((lane) => lane.exactOutcomeLabels);
  const operatorSummary = [
    `# Crypto ${config.asset} First To Threshold By Date Matcher`,
    "",
    `- exact family: ${config.familyKey}`,
    `- target pair: POLYMARKET|PREDICT`,
    `- binary outcome core: ${outcomeCore.join(", ") || "none"}`,
    `- best pair: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe pair candidate count: ${materialized.finalDecision.exactSafePairCandidateCount}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-operator-summary.md`, `${operatorSummary}\n`);

  return {
    inputSummary,
    pairLanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
