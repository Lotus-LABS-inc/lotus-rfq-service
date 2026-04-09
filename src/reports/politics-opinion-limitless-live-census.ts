import { buildStableUuid } from "../canonical/canonicalization-types.js";
import { LimitlessCurrentDiscoveryClient } from "../integrations/limitless/limitless-current-discovery-client.js";
import { type LimitlessLiveMarket } from "../integrations/limitless/limitless-live-market-loader.js";
import { OpinionCurrentDiscoveryClient } from "../integrations/opinion/opinion-current-discovery-client.js";
import type { OpinionNormalizedMarket } from "../integrations/opinion/opinion-types.js";
import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import {
  admitNominee2028Row,
  isNominee2028CandidateRow
} from "../matching/politics/politics-nominee-2028-cluster.js";
import type { MatchingMarketRecord } from "../matching/matching-types.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  NOMINEE_2028_TARGET_QUERY_LABELS,
  extractLimitlessOutcomeLabels,
  matchesNominee2028TopicTarget,
  type FreshPoliticsFetchRow
} from "./politics-current-state-refresh.js";

const ARTIFACT_DIR = "artifacts/politics/opinion-limitless-live-census";
const OPINION_METADATA_VERSION = "opinion-live-census-v1";
const LIMITLESS_METADATA_VERSION = "limitless-live-census-v1";
const OPINION_DIRECT_PAGE_URLS = [
  "https://app.opinion.trade/market/democratic-presidential-nominee-2028",
  "https://app.opinion.trade/market/republican-presidential-nominee-2028"
] as const;
const LIMITLESS_DIRECT_PAGE_URLS = [
  "https://limitless.exchange/markets/democratic-presidential-nominee-2028-1768929458278?rv=7Q4JYY4UXP",
  "https://limitless.exchange/markets/republican-presidential-nominee-2028-1768931335047?rv=7Q4JYY4UXP"
] as const;
type CensusVenue = "OPINION" | "LIMITLESS";

export interface PoliticsOpinionLimitlessLiveCensusVenueStatus {
  fetchState: "SUCCESS" | "EMPTY" | "UNAVAILABLE" | "MISCONFIGURED" | "UNSUPPORTED_PATH";
  discoveryPath: string;
  broadDiscoveryRowCount: number;
  targetedDiscoveryRowCount: number;
  targetedDiscoveryPathUsed: string | null;
  targetedQueryLabels: readonly string[];
  warnings: readonly string[];
}

export interface PoliticsOpinionLimitlessLiveCensusRunResult {
  summary: Record<string, unknown>;
  opinionRawSnapshot: readonly Record<string, unknown>[];
  limitlessRawSnapshot: readonly Record<string, unknown>[];
  extractedRows: readonly ReturnType<typeof extractPoliticsInventoryRow>[];
  venueStatuses: Record<CensusVenue, PoliticsOpinionLimitlessLiveCensusVenueStatus>;
  operatorSummary: string;
}

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));

const toSlugFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
};

const decodeJsonEscapes = (value: string): string => {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, "\"");
  }
};

const extractFirstDecodedMatch = (html: string, patterns: readonly RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1];
    if (typeof value === "string" && value.trim().length > 0) {
      return decodeJsonEscapes(value.trim());
    }
  }
  return null;
};

const buildDecodedWindow = (html: string, anchor: string, prefix: number, suffix: number): string | null => {
  const index = html.indexOf(anchor);
  if (index === -1) {
    return null;
  }
  return html
    .slice(Math.max(0, index - prefix), Math.min(html.length, index + suffix))
    .replace(/\\"/g, "\"");
};

const parseOpinionDescriptionCandidates = (description: string): readonly string[] =>
  uniqueStrings(
    description
      .split("|")
      .map((part) => part.split(":")[0]?.trim() ?? "")
      .filter((part) => part.length > 0)
  );

export const parseOpinionDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = extractFirstDecodedMatch(input.html, [
    /<title>([^<]*Presidential Nominee 2028)<\/title>/i,
    /"title","\d+",\{"children":"([^"]*Presidential Nominee 2028)"/i,
    /"children":"([^"]*Presidential Nominee 2028)"/i
  ]);
  const description = extractFirstDecodedMatch(input.html, [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /"name":"description","content":"([^"]+)"/i
  ]);
  const venueMarketId = extractFirstDecodedMatch(input.html, [
    /https:\/\/app\.opinion\.trade\/og\/[^/]+\/(\d+)/i
  ]) ?? toSlugFromUrl(input.url);

  if (!title || !venueMarketId) {
    return null;
  }

  const candidateLabels = description ? parseOpinionDescriptionCandidates(description) : [];
  return {
    venue: "OPINION",
    venueMarketId,
    slug: toSlugFromUrl(input.url),
    title,
    rulesText: "Direct page census from app.opinion.trade nominee market page.",
    categoryHints: ["Politics", "Opinion", "Nominee"],
    tags: ["Politics"],
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: candidateLabels.map((label) => ({ label })),
    sourceUrl: input.url,
    rawPayload: {
      title,
      description,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "opinion_direct_market_page_live_census"
  };
};

const extractJsonArrayAfterToken = (html: string, token: string): unknown[] => {
  const results: unknown[] = [];
  let searchIndex = 0;

  while (searchIndex < html.length) {
    const tokenIndex = html.indexOf(token, searchIndex);
    if (tokenIndex === -1) {
      break;
    }
    const arrayStart = html.indexOf("[", tokenIndex + token.length);
    if (arrayStart === -1) {
      break;
    }

    let depth = 0;
    let inString = false;
    let escaping = false;
    let arrayEnd = -1;

    for (let index = arrayStart; index < html.length; index += 1) {
      const character = html[index]!;
      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (character === "\\") {
          escaping = true;
          continue;
        }
        if (character === "\"") {
          inString = false;
        }
        continue;
      }
      if (character === "\"") {
        inString = true;
        continue;
      }
      if (character === "[") {
        depth += 1;
        continue;
      }
      if (character === "]") {
        depth -= 1;
        if (depth === 0) {
          arrayEnd = index;
          break;
        }
      }
    }

    if (arrayEnd === -1) {
      break;
    }

    try {
      const parsed = JSON.parse(html.slice(arrayStart, arrayEnd + 1));
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      }
    } catch {
      // Ignore malformed fragments.
    }
    searchIndex = arrayEnd + 1;
  }

  return results;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toCounts = <T extends { venue: string }>(rows: readonly T[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.venue] = (accumulator[row.venue] ?? 0) + 1;
    return accumulator;
  }, {});

const buildOpinionSourceUrl = (market: OpinionNormalizedMarket): string | null =>
  market.slug ? `https://opinion.trade/markets/${market.slug}` : null;

const opinionMarketToFreshRow = (market: OpinionNormalizedMarket): FreshPoliticsFetchRow => ({
  venue: "OPINION",
  venueMarketId: market.venueMarketId,
  slug: market.slug,
  title: market.title,
  rulesText: market.rules,
  categoryHints: uniqueStrings([...market.labels, "OPINION"]),
  tags: market.labels,
  active: true,
  publishedAt: market.createdAt,
  expiresAt: market.cutoffAt,
  resolvesAt: market.resolvedAt,
  outcomes: uniqueStrings([market.yesLabel ?? "Yes", market.noLabel ?? "No"]).map((label) => ({ label })),
  sourceUrl: buildOpinionSourceUrl(market),
  rawPayload: market.raw,
  fetchTimestamp: new Date().toISOString(),
  discoveryPath: "opinion_clob_sdk_active_markets_live_census"
});

const limitlessMarketToFreshRow = (market: LimitlessLiveMarket, discoveryPath: string): FreshPoliticsFetchRow => ({
  venue: "LIMITLESS",
  venueMarketId: market.venueMarketId,
  slug: market.slug,
  title: market.title,
  rulesText: market.description,
  categoryHints: uniqueStrings([...market.categories, ...market.tags, market.canonicalCategory]),
  tags: market.tags,
  active: market.status ? !/closed|resolved/i.test(market.status) : null,
  publishedAt: market.createdAt,
  expiresAt: market.expiresAt,
  resolvesAt: market.expiresAt,
  outcomes: extractLimitlessOutcomeLabels(market),
  sourceUrl: market.slug ? `https://limitless.exchange/markets/${market.slug}` : null,
  rawPayload: market.raw,
  fetchTimestamp: market.fetchedAt.toISOString(),
  discoveryPath
});

export const freshPoliticsRowToMatchingMarketRecord = (
  row: FreshPoliticsFetchRow,
  metadataVersion: string
): MatchingMarketRecord => ({
  interpretedContractId: buildStableUuid(`politics-live-census:${row.venue}:${row.venueMarketId}`),
  venueMarketProfileId: `${row.venue.toLowerCase()}:${row.venueMarketId}`,
  canonicalEventId: buildStableUuid(`politics-live-census:event:${row.venue}:${row.slug ?? row.venueMarketId}`),
  venue: row.venue,
  venueMarketId: row.venueMarketId,
  title: row.title,
  description: row.rulesText,
  rulesText: row.rulesText,
  category: "POLITICS",
  marketClass: row.outcomes.length === 2 ? "BINARY" : "MULTI_OUTCOME",
  sourceMetadataVersion: metadataVersion,
  confidenceScore: "0.8",
  propositionSemantics: {},
  outcomeSemantics: {},
  timingSemantics: {},
  resolutionSemantics: {},
  settlementSemantics: {},
  ambiguityFlags: {},
  rawLineageReferences: {
    slug: row.slug,
    sourceUrl: row.sourceUrl,
    discoveryPath: row.discoveryPath,
    fetchTimestamp: row.fetchTimestamp,
    censusPass: "politics-opinion-limitless-live-census"
  },
  publishedAt: row.publishedAt,
  expiresAt: row.expiresAt,
  resolvesAt: row.resolvesAt,
  outcomes: row.outcomes.map((outcome, index) => ({
    id: `${row.venueMarketId}:${index}`,
    label: outcome.label
  })),
  outcomeSchema: {
    marketShape: row.outcomes.length === 2 ? "binary" : "categorical",
    outcomeLabels: row.outcomes.map((outcome) => outcome.label)
  },
  historicalRowCount: 0,
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

const buildRawSnapshotRow = (row: FreshPoliticsFetchRow): Record<string, unknown> => ({
  venue: row.venue,
  venueMarketId: row.venueMarketId,
  slug: row.slug,
  title: row.title,
  rulesText: row.rulesText,
  categoryHints: row.categoryHints,
  tags: row.tags,
  active: row.active,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  resolvesAt: row.resolvesAt?.toISOString() ?? null,
  outcomes: row.outcomes,
  sourceUrl: row.sourceUrl,
  discoveryPath: row.discoveryPath,
  fetchTimestamp: row.fetchTimestamp,
  rawPayloadKeys: Object.keys(row.rawPayload).sort(),
  rawPayloadPreview: {
    id: typeof row.rawPayload.id === "string" || typeof row.rawPayload.id === "number" ? row.rawPayload.id : null,
    marketId:
      typeof row.rawPayload.marketId === "string" || typeof row.rawPayload.marketId === "number" ? row.rawPayload.marketId : null,
    questionId: typeof row.rawPayload.questionId === "string" ? row.rawPayload.questionId : null,
    status: typeof row.rawPayload.status === "string" ? row.rawPayload.status : null
  }
});

const fetchOpinionDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();

  for (const url of OPINION_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parseOpinionDirectPage({
      url,
      html
    });
    if (!parsed) {
      continue;
    }
    rows.set(parsed.venueMarketId, parsed);
  }

  return [...rows.values()];
};

const fetchLimitlessDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();

  for (const url of LIMITLESS_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const titleAnchor = toSlugFromUrl(url)?.includes("republican")
      ? "Republican Presidential Nominee 2028"
      : "Democratic Presidential Nominee 2028";
    const decodedWindow = buildDecodedWindow(html, titleAnchor, 500, 40_000);
    if (!decodedWindow) {
      continue;
    }
    const titles = [...decodedWindow.matchAll(/"title":"([^"]+)"\s*,\s*"proxyTitle"/g)]
      .map((match) => decodeJsonEscapes(match[1]!))
      .filter((title) => title.trim().length > 0);
    const groupTitleMatch = decodedWindow.match(/"title":"([^"]*Presidential Nominee 2028[^"]*)"/i);
    const slugMatch = decodedWindow.match(/"slug":"([^"]*presidential-nominee-2028[^"]*)"/i);
    const title = groupTitleMatch ? decodeJsonEscapes(groupTitleMatch[1]!).replace(/^💠\s*/u, "") : null;
    const slug = slugMatch ? decodeJsonEscapes(slugMatch[1]!) : toSlugFromUrl(url);
    if (!title || !slug) {
      continue;
    }

    rows.set(slug, {
      venue: "LIMITLESS",
      venueMarketId: slug,
      slug,
      title,
      rulesText: "Direct page census from limitless.exchange nominee market page.",
      categoryHints: ["Politics", "Limitless", "Nominee"],
      tags: ["Politics"],
      active: true,
      publishedAt: null,
      expiresAt: null,
      resolvesAt: null,
      outcomes: uniqueStrings(titles.filter((candidateTitle) => candidateTitle !== title)).map((label) => ({ label })),
      sourceUrl: url,
      rawPayload: {
        title,
        candidateTitles: uniqueStrings(titles.filter((candidateTitle) => candidateTitle !== title)),
        directPage: true
      },
      fetchTimestamp: new Date().toISOString(),
      discoveryPath: "limitless_direct_market_page_live_census"
    });
  }

  return [...rows.values()];
};

const loadOpinionLiveRows = async (): Promise<{
  rows: readonly FreshPoliticsFetchRow[];
  status: PoliticsOpinionLimitlessLiveCensusVenueStatus;
}> => {
  const client = new OpinionCurrentDiscoveryClient({
    apiKey: process.env.OPINION_API_KEY ?? null,
    maxPages: 5,
    requestTimeoutMs: 5_000,
    ...(process.env.OPINION_CLOB_BASE_URL ? { baseUrl: process.env.OPINION_CLOB_BASE_URL } : {}),
    ...(process.env.OPINION_OPENAPI_BASE_URL ? { fallbackBaseUrl: process.env.OPINION_OPENAPI_BASE_URL } : {})
  });
  const result = await client.listCurrentMarkets(OPINION_METADATA_VERSION);
  const directPageRows = await fetchOpinionDirectPageRows().catch(() => []);
  const merged = new Map<string, FreshPoliticsFetchRow>();
  for (const row of [...result.rows.map(opinionMarketToFreshRow), ...directPageRows]) {
    merged.set(row.venueMarketId, row);
  }
  const rows = [...merged.values()];
  const targetedRows = rows.filter((row) =>
    matchesNominee2028TopicTarget({
      title: row.title,
      rulesText: row.rulesText,
      categoryHints: row.categoryHints,
      tags: row.tags
    })
  );
  return {
    rows,
    status: {
      fetchState:
        result.status === "NOT_CONFIGURED" ? "MISCONFIGURED"
        : result.status === "UNAVAILABLE" ? "UNAVAILABLE"
        : result.rows.length > 0 ? "SUCCESS"
        : "EMPTY",
      discoveryPath: result.primaryDiscoveryPath,
      broadDiscoveryRowCount: result.scannedRowCount ?? result.rows.length,
      targetedDiscoveryRowCount: targetedRows.length,
      targetedDiscoveryPathUsed:
        directPageRows.length > 0 ? "opinion_direct_market_page_live_census"
        : targetedRows.length > 0 ? result.primaryDiscoveryPath
        : null,
      targetedQueryLabels: NOMINEE_2028_TARGET_QUERY_LABELS,
      warnings: result.warnings
    }
  };
};

const loadLimitlessLiveRows = async (repoRoot: string): Promise<{
  rows: readonly FreshPoliticsFetchRow[];
  status: PoliticsOpinionLimitlessLiveCensusVenueStatus;
}> => {
  const primaryClient = new LimitlessCurrentDiscoveryClient({
    apiKey: process.env.LIMITLESS_API_KEY ?? null,
    baseUrl: process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange",
    maxPages: 3,
    requestTimeoutMs: 5_000
  });
  const primary = await primaryClient.listCurrentMarkets();
  const directPageRows = await fetchLimitlessDirectPageRows().catch(() => []);
  const broadRows = primary.rows.map((row) => limitlessMarketToFreshRow(row, "limitless_sdk_active_markets_live_census"));
  const mergedRows = new Map<string, FreshPoliticsFetchRow>();
  for (const row of [...broadRows, ...directPageRows]) {
    mergedRows.set(row.venueMarketId, row);
  }
  const rows = [...mergedRows.values()];
  const targetedBroadRows = broadRows.filter((row) =>
    matchesNominee2028TopicTarget({
      title: row.title,
      rulesText: row.rulesText,
      categoryHints: row.categoryHints,
      tags: row.tags
    })
  );
  let targetedDiscoveryPathUsed: string | null =
    directPageRows.length > 0 ? "limitless_direct_market_page_live_census"
    : targetedBroadRows.length > 0 ? "limitless_sdk_active_markets_live_census"
    : null;
  const warnings = [...primary.warnings];
  const targetedRows = rows.filter((row) =>
    matchesNominee2028TopicTarget({
      title: row.title,
      rulesText: row.rulesText,
      categoryHints: row.categoryHints,
      tags: row.tags
    })
  );

  return {
    rows,
    status: {
      fetchState:
        primary.status === "UNAVAILABLE" ? "UNAVAILABLE"
        : rows.length > 0 ? "SUCCESS"
        : "EMPTY",
      discoveryPath: primary.primaryDiscoveryPath,
      broadDiscoveryRowCount: broadRows.length,
      targetedDiscoveryRowCount: targetedRows.length,
      targetedDiscoveryPathUsed,
      targetedQueryLabels: NOMINEE_2028_TARGET_QUERY_LABELS,
      warnings
    }
  };
};

export const mergeRefreshedRowsWithOpinionLimitlessLiveCensus = (
  refreshedRows: readonly ReturnType<typeof extractPoliticsInventoryRow>[],
  liveCensusRows: readonly ReturnType<typeof extractPoliticsInventoryRow>[]
): readonly ReturnType<typeof extractPoliticsInventoryRow>[] => [
  ...refreshedRows.filter((row) => row.venue !== "OPINION" && row.venue !== "LIMITLESS"),
  ...liveCensusRows
];

export const buildOpinionLimitlessLiveCensusExtractedRows = (input: {
  opinionRows: readonly FreshPoliticsFetchRow[];
  limitlessRows: readonly FreshPoliticsFetchRow[];
}): readonly ReturnType<typeof extractPoliticsInventoryRow>[] => [
  ...input.opinionRows.map((row) => extractPoliticsInventoryRow(freshPoliticsRowToMatchingMarketRecord(row, OPINION_METADATA_VERSION))),
  ...input.limitlessRows.map((row) => extractPoliticsInventoryRow(freshPoliticsRowToMatchingMarketRecord(row, LIMITLESS_METADATA_VERSION)))
];

export const runPoliticsOpinionLimitlessLiveCensusPass = async (input: {
  repoRoot: string;
}): Promise<PoliticsOpinionLimitlessLiveCensusRunResult> => {
  const [opinion, limitless] = await Promise.all([
    loadOpinionLiveRows(),
    loadLimitlessLiveRows(input.repoRoot)
  ]);

  const extractedRows = buildOpinionLimitlessLiveCensusExtractedRows({
    opinionRows: opinion.rows,
    limitlessRows: limitless.rows
  });
  const candidateRows = extractedRows.filter((row) => isNominee2028CandidateRow(row));
  const admittedRows = extractedRows.filter((row) => admitNominee2028Row(row).admitted);

  const summary = {
    observedAt: new Date().toISOString(),
    venueStatuses: {
      OPINION: opinion.status,
      LIMITLESS: limitless.status
    },
    rawLiveMarketCountsByVenue: {
      OPINION: opinion.rows.length,
      LIMITLESS: limitless.rows.length
    },
    nominee2028CandidateRowsByVenue: toCounts(candidateRows),
    nominee2028AdmittedRowsByVenue: toCounts(admittedRows)
  };

  const operatorSummary = [
    "# Opinion / Limitless Live Census",
    "",
    `- opinion live markets: ${opinion.rows.length} (${opinion.status.fetchState})`,
    `- limitless live markets: ${limitless.rows.length} (${limitless.status.fetchState})`,
    `- nominee-2028 candidate rows by venue: ${JSON.stringify(toCounts(candidateRows))}`,
    `- nominee-2028 admitted rows by venue: ${JSON.stringify(toCounts(admittedRows))}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-opinion-limitless-live-census-summary.json`, summary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-opinion-live-raw-snapshot.json`, opinion.rows.map(buildRawSnapshotRow));
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-limitless-live-raw-snapshot.json`, limitless.rows.map(buildRawSnapshotRow));
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-opinion-limitless-live-census-operator-summary.md`, `${operatorSummary}\n`);

  return {
    summary,
    opinionRawSnapshot: opinion.rows.map(buildRawSnapshotRow),
    limitlessRawSnapshot: limitless.rows.map(buildRawSnapshotRow),
    extractedRows,
    venueStatuses: {
      OPINION: opinion.status,
      LIMITLESS: limitless.status
    },
    operatorSummary
  };
};
