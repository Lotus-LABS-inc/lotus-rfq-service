import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  FAMILY_DATE_LABELS,
  type CryptoAthByDateAssetConfig
} from "../matching/crypto/crypto-ath-by-date-assets.js";
import {
  buildCryptoAthByDateFamilyArtifacts,
  buildCryptoAthByDateMatcherMaterialization,
  type CryptoAthByDateComparabilityTopicSummary,
  type CryptoAthByDateExtractedRow,
  type CryptoAthByDateNormalizedTopicRow
} from "../matching/crypto/crypto-ath-by-date-shared.js";

const canonicalRulesForDate = (displayName: string, dateLabel: string): string =>
  `This market resolves to Yes if ${displayName} makes a new all-time high at any point on or before ${dateLabel}. Otherwise it resolves to No.`;

const slugDateKeyToLabel = (slug: string): string | null => {
  const normalized = slug.toLowerCase();
  if (normalized.includes("march-31-2026")) return "March 31, 2026";
  if (normalized.includes("june-30-2026")) return "June 30, 2026";
  if (normalized.includes("september-30-2026")) return "September 30, 2026";
  if (normalized.includes("december-31-2026")) return "December 31, 2026";
  return null;
};

const uniqueRows = (rows: readonly CryptoAthByDateExtractedRow[]): readonly CryptoAthByDateExtractedRow[] => {
  const byVenueAndId = new Map<string, CryptoAthByDateExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const fetchHtml = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
};

const parsePolymarketRows = (
  config: CryptoAthByDateAssetConfig,
  html: string
): readonly CryptoAthByDateExtractedRow[] => {
  const pattern = new RegExp(`${config.polymarketSlugPrefix}-[a-z0-9-]+`, "gi");
  const slugs = [...new Set([...html.matchAll(pattern)].map((match) => match[0]!.toLowerCase()))];

  return slugs.flatMap((slug) => {
    const exactDateLabel = slugDateKeyToLabel(slug);
    if (!exactDateLabel) {
      return [];
    }
    return [{
      interpretedContractId: `polymarket-${config.asset.toLowerCase()}-ath-by-${slug}`,
      venue: "POLYMARKET" as const,
      venueMarketId: slug,
      sourceUrl: `${config.polymarketEventUrl}/${slug}`,
      title: `${config.displayName} all time high by ${exactDateLabel}?`,
      rulesText: canonicalRulesForDate(config.displayName, exactDateLabel),
      exactDateLabel
    }];
  });
};

const parseLimitlessRows = (
  config: CryptoAthByDateAssetConfig,
  html: string
): readonly CryptoAthByDateExtractedRow[] =>
  FAMILY_DATE_LABELS.flatMap((exactDateLabel) => {
    const titleNeedle = `\\\"title\\\":\\\"${exactDateLabel}\\\"`;
    const start = html.indexOf(titleNeedle);
    if (start < 0) {
      return [];
    }
    const window = html.slice(start, start + 1800);
    const venueMarketId = window.match(/\\\"slug\\\":\\\"([^\\"]+)\\\"/)?.[1]?.trim() ?? "";
    if (!venueMarketId) {
      return [];
    }
    return [{
      interpretedContractId: `limitless-${config.asset.toLowerCase()}-ath-by-${venueMarketId}`,
      venue: "LIMITLESS" as const,
      venueMarketId,
      sourceUrl: `${config.limitlessMarketUrl}#${venueMarketId}`,
      title: `${config.displayName} all time high by ${exactDateLabel}?`,
      rulesText: canonicalRulesForDate(config.displayName, exactDateLabel),
      exactDateLabel
    }];
  });

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

export interface CryptoAthByDateFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export interface CryptoAthByDateMatcherRunResult {
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

const buildOperatorSummary = (config: CryptoAthByDateAssetConfig, input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: readonly { canonicalTopicKey: string; venuesPresent: readonly string[] }[];
  finalDecision: { sharedCandidateTopicKeys: readonly string[]; matcherFollowUpJustified: boolean; singleBestNextAction: string };
}): string =>
  [
    `# Crypto ${config.asset} ATH By Date Family Pass`,
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- shared topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- shared matcher candidates: ${input.finalDecision.sharedCandidateTopicKeys.join(", ") || "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export const runCryptoAthByDateFamilyPass = async (input: {
  repoRoot: string;
  config: CryptoAthByDateAssetConfig;
}): Promise<CryptoAthByDateFamilyPassRunResult> => {
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

  const [polymarketHtml, limitlessHtml] = await Promise.all([
    fetchHtml(config.polymarketEventUrl),
    fetchHtml(config.limitlessMarketUrl)
  ]);

  const rows = uniqueRows([
    ...(polymarketHtml ? parsePolymarketRows(config, polymarketHtml) : []),
    ...(limitlessHtml ? parseLimitlessRows(config, limitlessHtml) : [])
  ]);

  const artifacts = buildCryptoAthByDateFamilyArtifacts(config, rows);
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

export const runCryptoAthByDateMatcherPass = async (input: {
  repoRoot: string;
  config: CryptoAthByDateAssetConfig;
}): Promise<CryptoAthByDateMatcherRunResult> => {
  const { config } = input;
  const familyArtifactDir = `artifacts/crypto/${config.artifactKey}-family-pass`;
  const matcherArtifactDir = `artifacts/crypto/${config.artifactKey}-matcher`;
  const stem = `crypto-${config.artifactKey}`;

  const normalizedTopicsArtifact = readArtifact<CryptoAthByDateNormalizedTopicRow[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-normalized-topics.json`
  );
  const comparabilityArtifact = readArtifact<CryptoAthByDateComparabilityTopicSummary[]>(
    input.repoRoot,
    `${familyArtifactDir}/${stem}-comparability-summary.json`
  );

  const materialized = buildCryptoAthByDateMatcherMaterialization({
    config,
    normalizedTopics: normalizedTopicsArtifact,
    comparabilitySummary: comparabilityArtifact
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    exactFamily: config.familyKey,
    targetPair: "LIMITLESS|POLYMARKET",
    refreshedRowsUsed: normalizedTopicsArtifact
      .filter((row) => row.canonicalTopicKey !== null)
      .map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        canonicalTopicKey: row.canonicalTopicKey,
        canonicalDateKey: row.canonicalDateKey
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
      exactDateKey: lane.exactDateKey,
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

  const sharedDates = materialized.pairLanes.map((lane) => lane.exactDateKey).sort();
  const rejectedDates = materialized.rejections
    .map((entry) => entry.exactDateKey)
    .filter((value): value is string => value !== null && value !== undefined)
    .sort();

  const operatorSummary = [
    `# Crypto ${config.asset} ATH By Date Matcher`,
    "",
    `- exact family: ${config.familyKey}`,
    `- target pair: LIMITLESS|POLYMARKET`,
    `- shared date buckets: ${sharedDates.join(", ") || "none"}`,
    `- rejected date buckets: ${rejectedDates.join(", ") || "none"}`,
    `- best pair: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe pair bucket count: ${materialized.finalDecision.exactSafePairCandidateCount}`,
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
