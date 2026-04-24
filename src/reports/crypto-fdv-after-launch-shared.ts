import "dotenv/config";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import type { CryptoFdvAfterLaunchProjectConfig } from "../matching/crypto/crypto-fdv-after-launch-assets.js";
import {
  buildCryptoFdvAfterLaunchFamilyArtifacts,
  buildCryptoFdvAfterLaunchMatcherMaterialization,
  type CryptoFdvAfterLaunchComparabilityTopicSummary,
  type CryptoFdvAfterLaunchExtractedRow,
  type CryptoFdvAfterLaunchNormalizedTopicRow
} from "../matching/crypto/crypto-fdv-after-launch-shared.js";

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
  title?: string | null;
  question?: string | null;
  description?: string | null;
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

const parseFdvLabel = (value: string): string | null => {
  const match = value.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)(m|b|million|billion)\b/i);
  return match ? `${match[1]}${match[2]}` : null;
};

const buildCanonicalRules = (config: CryptoFdvAfterLaunchProjectConfig, thresholdLabel: string): string =>
  `This market resolves to Yes if ${config.displayName}'s token FDV is above ${thresholdLabel} one day after launch. Otherwise it resolves to No.`;

const uniqueRows = (rows: readonly CryptoFdvAfterLaunchExtractedRow[]): readonly CryptoFdvAfterLaunchExtractedRow[] => {
  const byVenueAndId = new Map<string, CryptoFdvAfterLaunchExtractedRow>();
  for (const row of rows) byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  return [...byVenueAndId.values()];
};

const parsePolymarketRows = (
  config: CryptoFdvAfterLaunchProjectConfig,
  markets: readonly PolymarketEventMarket[]
): readonly CryptoFdvAfterLaunchExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? market.groupItemTitle?.trim() ?? "";
    const thresholdLabel = parseFdvLabel(market.groupItemTitle?.trim() ?? title);
    const outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : null;
    if (!title || !thresholdLabel || !Array.isArray(outcomes) || outcomes.length !== 2) return [];
    return [{
      interpretedContractId: `polymarket-${config.artifactKey}-${market.id}`,
      venue: "POLYMARKET" as const,
      venueMarketId: String(market.id),
      sourceUrl: `${config.polymarketEventUrl}/${market.slug ?? ""}`.replace(/\/$/, ""),
      title,
      rulesText: typeof market.description === "string" ? market.description : buildCanonicalRules(config, thresholdLabel),
      thresholdLabel
    }];
  });

const parsePredictRows = (
  config: CryptoFdvAfterLaunchProjectConfig,
  markets: readonly PredictCategoryMarket[]
): readonly CryptoFdvAfterLaunchExtractedRow[] =>
  markets.flatMap((market) => {
    const title = market.question?.trim() ?? market.title?.trim() ?? "";
    const thresholdLabel = parseFdvLabel(market.title?.trim() ?? title);
    const outcomeNames = (market.outcomes ?? [])
      .map((outcome) => typeof outcome.name === "string" ? outcome.name.toLowerCase() : null)
      .filter((value): value is string => value !== null);
    if (!title || !thresholdLabel || outcomeNames.length !== 2 || !outcomeNames.includes("yes") || !outcomeNames.includes("no")) return [];
    return [{
      interpretedContractId: `predict-${config.artifactKey}-${market.id}`,
      venue: "PREDICT" as const,
      venueMarketId: String(market.id),
      sourceUrl: `https://predict.fun/market/${config.predictCategorySlug}`,
      title,
      rulesText: typeof market.description === "string" ? market.description : buildCanonicalRules(config, thresholdLabel),
      thresholdLabel
    }];
  });

export const runCryptoFdvAfterLaunchFamilyPass = async (input: {
  repoRoot: string;
  config: CryptoFdvAfterLaunchProjectConfig;
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
  const artifacts = buildCryptoFdvAfterLaunchFamilyArtifacts(config, rows);
  const fetchSummary = {
    rowsFetchedByVenue: artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: artifacts.fetchSummaryInput.rowsAdmittedByVenue,
    opinionAdmissionStatus: config.opinionMarketSlug ? "NOT_ADMITTED_FETCH_UNCERTAIN" : "NOT_CONFIGURED"
  };
  const operatorSummary = [
    `# Crypto ${config.project} FDV After Launch Family Pass`,
    "",
    `- family supply by venue: ${JSON.stringify(fetchSummary.rowsAdmittedByVenue)}`,
    `- shared FDV thresholds: ${artifacts.comparabilitySummary.filter((topic) => topic.matcherCandidate).map((topic) => topic.canonicalThresholdLabel).join(", ") || "none"}`,
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

export const runCryptoFdvAfterLaunchMatcherPass = async (input: {
  repoRoot: string;
  config: CryptoFdvAfterLaunchProjectConfig;
}) => {
  const { config } = input;
  const familyArtifactDir = `artifacts/crypto/${config.artifactKey}-family-pass`;
  const matcherArtifactDir = `artifacts/crypto/${config.artifactKey}-matcher`;
  const stem = `crypto-${config.artifactKey}`;
  const normalizedTopicsArtifact = readArtifact<CryptoFdvAfterLaunchNormalizedTopicRow[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-normalized-topics.json`
  );
  const comparabilityArtifact = readArtifact<CryptoFdvAfterLaunchComparabilityTopicSummary[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-comparability-summary.json`
  );
  const materialized = buildCryptoFdvAfterLaunchMatcherMaterialization({
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
    `# Crypto ${config.project} FDV After Launch Matcher`,
    "",
    `- exact family: ${config.familyKey}`,
    "- target pair: POLYMARKET|PREDICT",
    `- shared FDV thresholds: ${materialized.pairLanes.map((lane) => lane.exactFdvThresholdLabel).join(", ") || "none"}`,
    `- rejected thresholds: ${materialized.rejections.map((entry) => entry.exactFdvThresholdLabel).filter(Boolean).join(", ") || "none"}`,
    `- final decision: ${materialized.finalDecision.overallDecision}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${matcherArtifactDir}/${stem}-operator-summary.md`, `${operatorSummary}\n`);
  return { inputSummary, pairLanes, rejections, finalDecision, operatorSummary };
};
