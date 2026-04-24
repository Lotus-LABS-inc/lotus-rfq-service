import "dotenv/config";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildCryptoThresholdByDateFamilyArtifacts,
  buildCryptoThresholdByDateMatcherMaterialization,
  type CryptoThresholdByDateComparabilityTopicSummary,
  type CryptoThresholdByDateExtractedRow,
  type CryptoThresholdByDateNormalizedTopicRow,
  type CryptoThresholdComparator
} from "../matching/crypto/crypto-threshold-by-date-shared.js";
import type { CryptoThresholdByDateAssetConfig } from "../matching/crypto/crypto-threshold-by-date-assets.js";

interface PolymarketEventMarket {
  id: string | number;
  slug?: string | null;
  question?: string | null;
  description?: string | null;
  groupItemTitle?: string | null;
  outcomes?: string | null;
}

interface PredictCategoryMarket {
  id: string | number;
  categorySlug?: string | null;
  title?: string | null;
  question?: string | null;
  description?: string | null;
  outcomes?: Array<{ name?: string | null }> | null;
}

const uniqueRows = (
  rows: readonly CryptoThresholdByDateExtractedRow[]
): readonly CryptoThresholdByDateExtractedRow[] => {
  const byVenueAndId = new Map<string, CryptoThresholdByDateExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const parseComparator = (value: string): CryptoThresholdComparator | null => {
  const normalized = value.toLowerCase();
  if (normalized.includes("reach") || normalized.includes("hit") || normalized.includes("↑")) {
    return "ABOVE";
  }
  if (normalized.includes("dip") || normalized.includes("↓")) {
    return "BELOW";
  }
  return null;
};

const parseThresholdLabel = (value: string): string | null => {
  const match = value.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/);
  return match?.[1]?.trim() ?? null;
};

const buildCanonicalRulesForThreshold = (
  config: CryptoThresholdByDateAssetConfig,
  comparator: CryptoThresholdComparator,
  thresholdLabel: string
): string =>
  comparator === "ABOVE"
    ? `This market resolves to Yes if ${config.displayName} reaches $${thresholdLabel} at any time on or before April 30, 2026. Otherwise it resolves to No.`
    : `This market resolves to Yes if ${config.displayName} dips to $${thresholdLabel} at any time on or before April 30, 2026. Otherwise it resolves to No.`;

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
  config: CryptoThresholdByDateAssetConfig,
  markets: readonly PolymarketEventMarket[]
): readonly CryptoThresholdByDateExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? market.groupItemTitle?.trim() ?? "";
    const comparator = parseComparator(title);
    const thresholdLabel = parseThresholdLabel(market.groupItemTitle?.trim() ?? title);
    const outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : null;
    if (!title || !comparator || !thresholdLabel || !Array.isArray(outcomes) || outcomes.length !== 2) {
      return [];
    }
    return [{
      interpretedContractId: `polymarket-${config.asset.toLowerCase()}-threshold-apr-2026-${market.id}`,
      venue: "POLYMARKET" as const,
      venueMarketId: String(market.id),
      sourceUrl: `${config.polymarketEventUrl}/${market.slug ?? ""}`.replace(/\/$/, ""),
      title,
      rulesText: typeof market.description === "string" ? market.description : buildCanonicalRulesForThreshold(config, comparator, thresholdLabel),
      comparator,
      thresholdLabel
    }];
  });

const parsePredictRows = (
  config: CryptoThresholdByDateAssetConfig,
  markets: readonly PredictCategoryMarket[]
): readonly CryptoThresholdByDateExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? market.title?.trim() ?? "";
    const comparator = parseComparator(title);
    const thresholdLabel = parseThresholdLabel(market.title?.trim() ?? title);
    const outcomeNames = (market.outcomes ?? [])
      .map((outcome) => typeof outcome.name === "string" ? outcome.name.toLowerCase() : null)
      .filter((value): value is string => value !== null);
    if (!title || !comparator || !thresholdLabel || outcomeNames.length !== 2 || !outcomeNames.includes("yes") || !outcomeNames.includes("no")) {
      return [];
    }
    return [{
      interpretedContractId: `predict-${config.asset.toLowerCase()}-threshold-apr-2026-${market.id}`,
      venue: "PREDICT" as const,
      venueMarketId: String(market.id),
      sourceUrl: `https://predict.fun/market/${config.predictCategorySlug}`,
      title,
      rulesText: typeof market.description === "string" ? market.description : buildCanonicalRulesForThreshold(config, comparator, thresholdLabel),
      comparator,
      thresholdLabel
    }];
  });

export interface CryptoThresholdByDateFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export interface CryptoThresholdByDateMatcherRunResult {
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

const buildOperatorSummary = (config: CryptoThresholdByDateAssetConfig, input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: readonly { canonicalThresholdLabel: string; venuesPresent: readonly string[] }[];
  finalDecision: { sharedCandidateTopicKeys: readonly string[]; matcherFollowUpJustified: boolean; singleBestNextAction: string };
}): string =>
  [
    `# Crypto ${config.asset} Threshold By Date April 2026 Family Pass`,
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- shared threshold lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalThresholdLabel}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- shared matcher candidates: ${input.finalDecision.sharedCandidateTopicKeys.join(", ") || "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export const runCryptoThresholdByDateFamilyPass = async (input: {
  repoRoot: string;
  config: CryptoThresholdByDateAssetConfig;
}): Promise<CryptoThresholdByDateFamilyPassRunResult> => {
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

  const artifacts = buildCryptoThresholdByDateFamilyArtifacts(config, rows);
  const fetchSummary = {
    rowsFetchedByVenue: artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: artifacts.fetchSummaryInput.rowsAdmittedByVenue,
    priorRowsFetchedByVenue: toJsonCounts(priorFetchSummary?.["rowsFetchedByVenue"]),
    priorRowsAdmittedByVenue: toJsonCounts(priorFetchSummary?.["rowsAdmittedByVenue"])
  };
  const operatorSummary = buildOperatorSummary(config, {
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

export const runCryptoThresholdByDateMatcherPass = async (input: {
  repoRoot: string;
  config: CryptoThresholdByDateAssetConfig;
}): Promise<CryptoThresholdByDateMatcherRunResult> => {
  const { config } = input;
  const familyArtifactDir = `artifacts/crypto/${config.artifactKey}-family-pass`;
  const matcherArtifactDir = `artifacts/crypto/${config.artifactKey}-matcher`;
  const stem = `crypto-${config.artifactKey}`;

  const normalizedTopicsArtifact = readArtifact<CryptoThresholdByDateNormalizedTopicRow[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-normalized-topics.json`
  );
  const comparabilityArtifact = readArtifact<CryptoThresholdByDateComparabilityTopicSummary[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-comparability-summary.json`
  );

  const materialized = buildCryptoThresholdByDateMatcherMaterialization({
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
        canonicalThresholdValue: row.canonicalThresholdValue,
        canonicalComparator: row.canonicalComparator,
        canonicalThresholdLabel: row.canonicalThresholdLabel
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
      exactThresholdLabel: lane.exactThresholdLabel,
      exactThresholdValue: lane.exactThresholdValue,
      comparator: lane.comparator,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
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

  const sharedThresholds = materialized.pairLanes.map((lane) => lane.exactThresholdLabel);
  const rejectedThresholds = materialized.rejections
    .map((entry) => entry.exactThresholdLabel)
    .filter((value): value is string => value !== null && value !== undefined);

  const operatorSummary = [
    `# Crypto ${config.asset} Threshold By Date April 2026 Matcher`,
    "",
    `- exact family: ${config.familyKey}`,
    `- target pair: POLYMARKET|PREDICT`,
    `- shared threshold buckets: ${sharedThresholds.join(", ") || "none"}`,
    `- rejected threshold buckets: ${rejectedThresholds.join(", ") || "none"}`,
    `- best pair: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe pair threshold count: ${materialized.finalDecision.exactSafePairCandidateCount}`,
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
