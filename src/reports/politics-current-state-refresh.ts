import { existsSync } from "node:fs";
import path from "node:path";

import type { Pool } from "pg";
import { Pool as PgPool } from "pg";

import { CanonicalGraphProjector } from "../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../canonical/curated-canonical-graph.js";
import { buildStableUuid } from "../canonical/canonicalization-types.js";
import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput,
  type HistoricalCanonicalCategory
} from "../core/historical-simulation/historical-simulation.types.js";
import { OpinionCurrentDiscoveryClient } from "../integrations/opinion/opinion-current-discovery-client.js";
import { OpinionMarketAdapter } from "../integrations/opinion/opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "../integrations/opinion/opinion-types.js";
import {
  loadLimitlessLiveMarkets,
  type LimitlessLiveMarket
} from "../integrations/limitless/limitless-live-market-loader.js";
import { LimitlessCurrentDiscoveryClient } from "../integrations/limitless/limitless-current-discovery-client.js";
import { PredexonHistoricalClient, type PredexonMarket } from "../integrations/predexon/predexon-client.js";
import { PredictClient } from "../integrations/predict/predict-client.js";
import { PredictMarketAdapter } from "../integrations/predict/predict-market-adapter.js";
import { PredictOrderbookAdapter } from "../integrations/predict/predict-orderbook-adapter.js";
import type {
  PredictEnvironment,
  PredictNormalizedMarket,
  PredictNormalizedOrderbookSnapshot
} from "../integrations/predict/predict-types.js";
import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import { writeArtifact, writeMarkdownArtifact, readArtifact } from "../operations/semantic-expansion/shared.js";
import { buildPoliticsInventoryGroundedArtifacts } from "./politics-inventory-grounded-pass.js";
import { buildPoliticsNomineeLivePassArtifactsFromRepository } from "./politics-nominee-live-pass.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { CanonicalCompatibilityRepository } from "../repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../repositories/historical-market-state.repository.js";
import { PredictBootstrapRepository } from "../repositories/predict-bootstrap.repository.js";

export type PoliticsCurrentFetchStatus = "SUCCESS" | "EMPTY" | "PARTIAL" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";
export type PoliticsCurrentAdmissionLabel = "POLITICS_ADMITTED" | "NON_POLITICS_REJECTED" | "AMBIGUOUS_HELD" | "UNKNOWN_CATEGORY";
export type PoliticsCurrentFairnessDecision =
  | "POLITICS_CURRENT_STATE_REFRESH_SUCCEEDED"
  | "POLITICS_REFRESH_PARTIAL_BUT_USABLE"
  | "POLITICS_REFRESH_INSUFFICIENT"
  | "POLITICS_VENUE_DISCOVERY_STILL_BLOCKED"
  | "POLITICS_NOW_READY_FOR_NOMINEE_MATCHER_EVAL"
  | "POLITICS_STILL_BELOW_SPORTS_AND_CRYPTO";

export interface FreshPoliticsFetchRow {
  venue: "POLYMARKET" | "LIMITLESS" | "OPINION" | "MYRIAD" | "PREDICT";
  venueMarketId: string;
  slug: string | null;
  title: string;
  rulesText: string | null;
  categoryHints: readonly string[];
  tags: readonly string[];
  active: boolean | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  resolvesAt: Date | null;
  outcomes: readonly { label: string }[];
  sourceUrl: string | null;
  rawPayload: Record<string, unknown>;
  fetchTimestamp: string;
  discoveryPath: string;
}

export interface PoliticsCurrentFetchResult {
  venue: FreshPoliticsFetchRow["venue"];
  status: PoliticsCurrentFetchStatus;
  rows: readonly FreshPoliticsFetchRow[];
  discoveryPath: string;
  warnings: readonly string[];
  primaryDiscoveryPath?: string;
  fallbackDiscoveryPathUsed?: string | null;
  primaryPathFailure?: string | null;
  broadDiscoveryRowCount?: number;
  targetedDiscoveryRowCount?: number;
  targetedDiscoveryPathUsed?: string | null;
  targetedQueryLabels?: readonly string[];
}

export interface PoliticsCurrentInterpretationRow {
  interpretedContractId: string;
  venue: FreshPoliticsFetchRow["venue"];
  venueMarketId: string;
  title: string;
  familyCandidateSignals: readonly string[];
  jurisdiction: string | null;
  office: string | null;
  cycleYear: string | null;
  candidateNames: readonly string[];
  outcomeStructureType: string;
  activeCurrentStatus: boolean;
  interpretationConfidence: string;
  interpretationFailures: readonly string[];
  sourceMetadataVersion: string;
}

export interface PoliticsCurrentStateRefreshRunResult {
  fetchSummary: Record<string, unknown>;
  fetchByVenue: Record<string, unknown>;
  fetchStatus: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  admittedRows: readonly FreshPoliticsFetchRow[];
  admissionRejections: readonly { venue: string; venueMarketId: string; title: string; label: PoliticsCurrentAdmissionLabel }[];
  interpretationSummary: Record<string, unknown>;
  interpretedRows: readonly PoliticsCurrentInterpretationRow[];
  storageRefreshSummary: Record<string, unknown>;
  storageDelta: Record<string, unknown>;
  deltaVsPriorCensus: Record<string, unknown>;
  deltaVsPriorNomineePass: Record<string, unknown>;
  fairnessSummary: Record<string, unknown>;
  postRefreshFinalDecision: Record<string, unknown>;
  operatorSummary: string;
}

const REFRESH_DIR = "artifacts/politics/current-state-refresh";
const OPINION_METADATA_VERSION = "opinion-current-politics-refresh-v1";
const PREDICT_METADATA_VERSION = "predict-current-politics-refresh-v1";
const LIMITLESS_METADATA_VERSION = "limitless-current-politics-refresh-v1";
const POLYMARKET_METADATA_VERSION = "polymarket-current-politics-refresh-v1";

export const CURRENT_REFRESH_METADATA_VERSIONS = [
  OPINION_METADATA_VERSION,
  PREDICT_METADATA_VERSION,
  LIMITLESS_METADATA_VERSION,
  POLYMARKET_METADATA_VERSION
] as const;

const POLITICS_PATTERNS = /\b(election|president|presidential|senate|house|parliament|prime minister|governor|mayor|nominee|nomination|primary|democrat|democratic|republican|gop|cabinet|congress|minister|court|judge|ceasefire|sanctions|trump|newsom|buttigieg|ossoff|white house|midterms|balance of power|party control)\b/i;
const NON_POLITICS_PATTERNS = /\b(bitcoin|btc|eth|crypto|sol|nba|nfl|nhl|mlb|premier league|la liga|valorant|lck|lec|lcs|dota|esports|meme|celebrity|box office)\b/i;
export const NOMINEE_2028_TARGET_QUERY_LABELS = [
  "Republican Presidential Nominee 2028",
  "Democratic Presidential Nominee 2028",
  "Republican nominee for U.S. president in 2028",
  "Democratic nominee for U.S. president in 2028",
  "win the 2028 Republican presidential nomination",
  "win the 2028 Democratic presidential nomination",
  "JD Vance",
  "Donald Trump",
  "Gavin Newsom",
  "Kamala Harris"
] as const;
export const OFFICE_WINNER_TARGET_QUERY_LABELS = [
  "presidential election winner 2028",
  "2028 U.S. presidential election winner",
  "colombia presidential election",
  "2026 busan mayoral election winner",
  "2026 seoul mayoral election winner"
] as const;
export const PARTY_CONTROL_TARGET_QUERY_LABELS = [
  "balance of power 2026 midterms",
  "2026 midterms balance of power",
  "control of the house and senate after the 2026 midterms"
] as const;
export const OFFICE_EXIT_TARGET_QUERY_LABELS = [
  "trump out as president before 2027",
  "netanyahu out before 2027",
  "keir starmer out before july",
  "starmer out by",
  "netanyahu out by"
] as const;
const NOMINEE_2028_TARGET_PATTERNS = [
  /\brepublican presidential nominee 2028\b/i,
  /\bdemocratic presidential nominee 2028\b/i,
  /\brepublican nominee\b.*\b(?:u\.?s\.?|united states)\b.*\bpresident\b.*\b2028\b/i,
  /\bdemocratic nominee\b.*\b(?:u\.?s\.?|united states)\b.*\bpresident\b.*\b2028\b/i,
  /\bwin the 2028 republican presidential nomination\b/i,
  /\bwin the 2028 democratic presidential nomination\b/i,
  /\b2028 republican presidential nomination\b/i,
  /\b2028 democratic presidential nomination\b/i
] as const;
const OFFICE_WINNER_TARGET_PATTERNS = [
  /\bpresidential election winner\b/i,
  /\bmayoral election winner\b/i,
  /\bgubernatorial election winner\b/i,
  /\bwho will win\b.*\belection\b/i,
  /\bwho will be\b.*\b(president|governor|mayor|prime minister)\b/i,
  /\bcolombia presidential election\b/i,
  /\bseoul mayoral election winner\b/i,
  /\bbusan mayoral election winner\b/i
] as const;
const OFFICE_WINNER_NEGATIVE_PATTERNS = [
  /\bnominee|nomination|primary|caucus\b/i,
  /\bbalance of power\b/i,
  /\bcontrol of\b/i,
  /\bparty winner\b/i,
  /\bsenate majority\b/i,
  /\bhouse majority\b/i
] as const;
const PARTY_CONTROL_TARGET_PATTERNS = [
  /\bbalance of power\b.*\b2026\b.*\bmidterms?\b/i,
  /\b2026\b.*\bmidterms?\b.*\bbalance of power\b/i,
  /\bcontrol of the house and senate\b.*\b2026\b.*\bmidterms?\b/i,
  /\bhouse and senate\b.*\b2026\b.*\bmidterms?\b/i
] as const;
const OFFICE_EXIT_TARGET_PATTERNS = [
  /\btrump\b.*\bout\b.*\bpresident\b.*\b2027\b/i,
  /\btrump out as president before 2027\b/i,
  /\bnetanyahu\b.*\bout\b.*\b2027\b/i,
  /\bnetanyahu out by\b/i,
  /\bkeir starmer\b.*\bout\b.*\b(?:july|2026)\b/i,
  /\bstarmer out by\b/i,
  /\bstarmer out in 2026\b/i
] as const;
const OPINION_OFFICE_WINNER_DIRECT_PAGE_URLS = [
  "https://app.opinion.trade/market/2026-busan-mayoral-election-winner",
  "https://app.opinion.trade/market/2026-seoul-mayoral-election-winner"
] as const;
const OPINION_OFFICE_EXIT_DIRECT_PAGE_URLS = [
  "https://app.opinion.trade/market/trump-out-as-president-before-2027",
  "https://app.opinion.trade/market/netanyahu-out-by",
  "https://app.opinion.trade/market/starmer-out-by"
] as const;
const OPINION_PARTY_CONTROL_DIRECT_PAGE_URLS = [
  "https://app.opinion.trade/market/balance-of-power-2026-midterms"
] as const;
const LIMITLESS_OFFICE_WINNER_TARGET_PATHS = [
  "/markets?search=presidential%20election%20winner%202028",
  "/markets?search=2028%20u.s.%20presidential%20election%20winner",
  "/markets?search=colombia%20presidential%20election",
  "/markets?search=2026%20busan%20mayoral%20election%20winner",
  "/markets?search=2026%20seoul%20mayoral%20election%20winner"
] as const;
const LIMITLESS_OFFICE_WINNER_DIRECT_PAGE_URLS = [
  "https://limitless.exchange/markets/presidential-election-winner-2028-1769010522121?rv=7Q4JYY4UXP",
  "https://limitless.exchange/markets/colombia-presidential-election-1769094546695?rv=7Q4JYY4UXP",
  "https://limitless.exchange/markets/2026-busan-mayoral-election-winner-1763484928779?rv=7Q4JYY4UXP",
  "https://limitless.exchange/markets/2026-seoul-mayoral-election-winner-1763484351054?rv=7Q4JYY4UXP"
] as const;
const LIMITLESS_OFFICE_EXIT_DIRECT_PAGE_URLS = [
  "https://limitless.exchange/markets/trump-out-as-president-before-2027-1768933068297?rv=7Q4JYY4UXP",
  "https://limitless.exchange/markets/netanyahu-out-by-end-of-2026-1768997302182?rv=7Q4JYY4UXP"
] as const;
const POLYMARKET_OFFICE_WINNER_DIRECT_PAGE_URLS = [
  "https://polymarket.com/event/presidential-election-winner-2028",
  "https://polymarket.com/event/colombia-presidential-election",
  "https://polymarket.com/event/2026-busan-mayoral-election-winner",
  "https://polymarket.com/event/2026-seoul-mayoral-election-winner"
] as const;
const POLYMARKET_OFFICE_EXIT_DIRECT_PAGE_URLS = [
  "https://polymarket.com/event/trump-out-as-president-before-2027",
  "https://polymarket.com/event/netanyahu-out-before-2027",
  "https://polymarket.com/event/starmer-out-in-2025"
] as const;
const POLYMARKET_PARTY_CONTROL_DIRECT_PAGE_URLS = [
  "https://polymarket.com/event/balance-of-power-2026-midterms"
] as const;
const PREDICT_OFFICE_EXIT_DIRECT_PAGE_URLS = [
  "https://predict.fun/market/trump-out-as-president-before-2027",
  "https://predict.fun/market/netanyahu-out-before-2027",
  "https://predict.fun/market/starmer-out-in-2026-1"
] as const;
const PREDICT_OFFICE_EXIT_TRUMP_EXACT_MARKET_ID_ENV_KEYS = [
  "PREDICT_OFFICE_EXIT_TRUMP_BEFORE_2027_MARKET_ID",
  "PREDICT_TRUMP_OUT_BEFORE_2027_MARKET_ID"
] as const;
const PREDICT_OFFICE_EXIT_NETANYAHU_EXACT_MARKET_ID_ENV_KEYS = [
  "PREDICT_OFFICE_EXIT_NETANYAHU_BEFORE_2027_MARKET_ID",
  "PREDICT_NETANYAHU_OUT_BEFORE_2027_MARKET_ID"
] as const;
const PREDICT_PARTY_CONTROL_DIRECT_PAGE_URLS = [
  "https://predict.fun/market/balance-of-power-2026-midterm-elections"
] as const;
const PREDICT_PARTY_CONTROL_EXACT_MARKET_ID_ENV_KEYS = [
  "PREDICT_PARTY_CONTROL_BALANCE_OF_POWER_MARKET_ID",
  "PREDICT_BALANCE_OF_POWER_2026_MARKET_ID"
] as const;
const PREDICT_PARTY_CONTROL_COMPONENT_MARKET_IDS_ENV_KEYS = [
  "PREDICT_PARTY_CONTROL_BALANCE_OF_POWER_COMPONENT_MARKET_IDS"
] as const;
const PARTY_CONTROL_CANONICAL_OUTCOMES = [
  "Democrats Sweep",
  "Republicans Sweep",
  "D Senate, R House",
  "R Senate, D House",
  "Other"
] as const;
const PARTY_CONTROL_GROUPED_PREDICT_TITLE = "Balance of Power: 2026 Midterms" as const;

const toHistoricalCategory = (value: string): HistoricalCanonicalCategory =>
  (["POLITICS", "CRYPTO", "SPORTS", "ESPORTS", "OTHER"].includes(value) ? value : "OTHER") as HistoricalCanonicalCategory;

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));

const recordIncrement = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const includesNominee2028TopicPattern = (value: string): boolean =>
  NOMINEE_2028_TARGET_PATTERNS.some((pattern) => pattern.test(value));

export const matchesNominee2028TopicTarget = (input: {
  title: string;
  rulesText?: string | null;
  categoryHints?: readonly string[];
  tags?: readonly string[];
}): boolean => {
  const combined = [
    input.title,
    input.rulesText ?? "",
    ...(input.categoryHints ?? []),
    ...(input.tags ?? [])
  ].join(" ");
  return includesNominee2028TopicPattern(combined);
};

export const matchesOfficeWinnerTopicTarget = (input: {
  title: string;
  rulesText?: string | null;
  categoryHints?: readonly string[];
  tags?: readonly string[];
}): boolean => {
  const combined = [
    input.title,
    input.rulesText ?? "",
    ...(input.categoryHints ?? []),
    ...(input.tags ?? [])
  ].join(" ");
  if (OFFICE_WINNER_NEGATIVE_PATTERNS.some((pattern) => pattern.test(combined))) {
    return false;
  }
  return OFFICE_WINNER_TARGET_PATTERNS.some((pattern) => pattern.test(combined));
};

export const matchesPartyControlTopicTarget = (input: {
  title: string;
  rulesText?: string | null;
  categoryHints?: readonly string[];
  tags?: readonly string[];
}): boolean => {
  const combined = [
    input.title,
    input.rulesText ?? "",
    ...(input.categoryHints ?? []),
    ...(input.tags ?? [])
  ].join(" ");
  return PARTY_CONTROL_TARGET_PATTERNS.some((pattern) => pattern.test(combined));
};

export const matchesOfficeExitTopicTarget = (input: {
  title: string;
  rulesText?: string | null;
  categoryHints?: readonly string[];
  tags?: readonly string[];
}): boolean => {
  const combined = [
    input.title,
    input.rulesText ?? "",
    ...(input.categoryHints ?? []),
    ...(input.tags ?? [])
  ].join(" ");
  return OFFICE_EXIT_TARGET_PATTERNS.some((pattern) => pattern.test(combined));
};

const matchesPoliticsCurrentTarget = (input: {
  title: string;
  rulesText?: string | null;
  categoryHints?: readonly string[];
  tags?: readonly string[];
}): boolean =>
  matchesNominee2028TopicTarget(input)
  || matchesOfficeWinnerTopicTarget(input)
  || matchesPartyControlTopicTarget(input)
  || matchesOfficeExitTopicTarget(input);

interface OfficeExitDirectPageTargetSpec {
  canonicalTitle: string;
  canonicalRulesText: string;
  tags: readonly string[];
}

interface PredictOfficeExitApiTargetSpec {
  canonicalTitle: string;
  sourceUrl: string;
  exactMarketIdEnvKeys: readonly string[];
  searchLabels: readonly string[];
}

const hasStrongOfficeExitRuleMatch = (value: string | null | undefined, patterns: readonly RegExp[]): boolean => {
  if (!value) {
    return false;
  }
  return patterns.every((pattern) => pattern.test(value));
};

const inferOfficeExitDirectPageTargetSpec = (input: {
  url: string;
  title: string | null;
  rulesText: string | null;
  html?: string;
}): OfficeExitDirectPageTargetSpec | null => {
  const combined = [input.url, input.title ?? "", input.rulesText ?? "", input.html ?? ""].join(" ");

  if (/\btrump-out-as-president-before-2027\b/i.test(combined) || /\btrump\b.*\bout as president\b.*\b2027\b/i.test(combined)) {
    const fallbackRulesText = "This market resolves to Yes if Donald Trump ceases to be President of the United States for any period of time by December 31, 2026. Otherwise it resolves to No.";
    return {
      canonicalTitle: "Trump out as President before 2027?",
      canonicalRulesText:
        hasStrongOfficeExitRuleMatch(input.rulesText, [/\bDonald Trump\b/i, /\bPresident of the United States\b/i, /\b(?:December 31,\s*2026|before 2027|2026)\b/i])
          ? input.rulesText!
          : fallbackRulesText,
      tags: ["Politics", "Office Exit", "Trump"]
    };
  }

  if ((/\bnetanyahu\b/i.test(combined) && /\bout\b/i.test(combined)) && (/\b2027\b/i.test(combined) || /\bend of 2026\b/i.test(combined) || /\bdec(?:ember)?\s*31\b/i.test(combined))) {
    const fallbackRulesText = "This market resolves to Yes if Benjamin Netanyahu ceases to be Prime Minister of Israel for any period of time by December 31, 2026. Otherwise it resolves to No.";
    return {
      canonicalTitle: "Netanyahu out before 2027?",
      canonicalRulesText:
        hasStrongOfficeExitRuleMatch(input.rulesText, [/\bBenjamin Netanyahu\b/i, /\bPrime Minister of Israel\b/i, /\b(?:December 31,\s*2026|before 2027|2026)\b/i])
          ? input.rulesText!
          : fallbackRulesText,
      tags: ["Politics", "Office Exit", "Netanyahu"]
    };
  }

  if ((/\bstarmer\b/i.test(combined) && /\bout\b/i.test(combined)) && (/\bjuly\b/i.test(combined) || /\bjune\s+30\b/i.test(combined) || /\b2026\b/i.test(combined))) {
    const fallbackRulesText = "This market resolves to Yes if Keir Starmer ceases to be Prime Minister of the United Kingdom for any period of time by June 30, 2026. Otherwise it resolves to No.";
    return {
      canonicalTitle: "Keir Starmer out before July 2026?",
      canonicalRulesText:
        hasStrongOfficeExitRuleMatch(input.rulesText, [/\bKeir Starmer\b/i, /\bPrime Minister of the United Kingdom\b/i, /\b(?:June 30,\s*2026|July|2026)\b/i])
          ? input.rulesText!
          : fallbackRulesText,
      tags: ["Politics", "Office Exit", "Starmer"]
    };
  }

  return null;
};

const extractStringLabels = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) =>
      typeof entry === "string" ? entry
      : typeof entry === "object" && entry !== null
        ? typeof (entry as Record<string, unknown>).label === "string" ? String((entry as Record<string, unknown>).label)
        : typeof (entry as Record<string, unknown>).title === "string" ? String((entry as Record<string, unknown>).title)
        : typeof (entry as Record<string, unknown>).name === "string" ? String((entry as Record<string, unknown>).name)
        : null
      : null
    )
    .filter((entry): entry is string => entry !== null && entry.trim().length > 0);
};

const decodeJsonEscapes = (value: string): string => {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, "\"");
  }
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

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

const toSlugFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
};

const parseOpinionDescriptionCandidates = (description: string): readonly string[] =>
  uniqueStrings(
    description
      .split("|")
      .map((part) => part.split(":")[0]?.trim() ?? "")
      .filter((part) => part.length > 0)
  );

const extractPartyControlOutcomeLabels = (text: string): readonly string[] =>
  PARTY_CONTROL_CANONICAL_OUTCOMES.filter((label) =>
    new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)
  );

const stripLeadingDecorators = (value: string): string =>
  value.replace(/^[^A-Za-z0-9]+/u, "").trim();

const cleanPolymarketPageTitle = (value: string): string =>
  decodeHtmlEntities(value)
    .replace(/\s+Predictions\s*&\s*Odds\s*\|\s*Polymarket$/i, "")
    .trim();

const cleanLimitlessPageTitle = (value: string): string =>
  stripLeadingDecorators(value).replace(/\s+\|\s+Limitless$/i, "").trim();

const normalizeLimitlessDirectPageHtml = (html: string): string =>
  html
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, "\"")
    .replace(/&quot;/g, "\"");

const extractLimitlessOfficeWinnerCandidateTitles = (html: string, cleanedTitle: string): readonly string[] =>
  uniqueStrings(
    [...html.matchAll(/"title":"((?:\\.|[^"\\])*)"\s*,\s*"proxyTitle":/g)]
      .map((match) => stripLeadingDecorators(decodeJsonEscapes(match[1] ?? "")))
      .filter((candidateTitle) =>
        candidateTitle.length > 0
        && candidateTitle !== cleanedTitle
        && !/\b(limitless|predict)\b/i.test(candidateTitle)
        && !/\b(?:election|winner|mayoral|presidential)\b/i.test(candidateTitle)
      )
  );

const extractLimitlessOfficeWinnerRuleText = (html: string): string | null => {
  const descriptions = uniqueStrings(
    [...html.matchAll(/"description":"((?:\\.|[^"\\])*)"/g)]
      .map((match) => decodeJsonEscapes(match[1] ?? ""))
      .map((description) => description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter((description) => description.length > 0)
  );

  const bestSpecificDescription = descriptions
    .filter((description) => /\belection\b/i.test(description) && /\bresolve/i.test(description))
    .sort((left, right) => right.length - left.length)[0];

  return bestSpecificDescription ?? [...descriptions].sort((left, right) => right.length - left.length)[0] ?? null;
};

const extractLimitlessOfficeExitRuleText = (html: string): string | null => {
  const descriptions = uniqueStrings(
    [...html.matchAll(/"description":"((?:\\.|[^"\\])*)"/g)]
      .map((match) => decodeJsonEscapes(match[1] ?? ""))
      .map((description) => description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter((description) => description.length > 0)
  );

  const bestSpecificDescription = descriptions
    .filter((description) =>
      /\b(?:Donald Trump|Benjamin Netanyahu|Keir Starmer)\b/i.test(description)
      && /\b(?:President of the United States|Prime Minister of Israel|Prime Minister of the United Kingdom)\b/i.test(description)
      && /\b(?:ceases to be|resigns?|removed|steps down|out)\b/i.test(description)
    )
    .sort((left, right) => right.length - left.length)[0];

  const ogDescription = extractFirstDecodedMatch(html, [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /<meta\s+property="og:description"\s+content="([^"]+)"/i
  ]);

  return bestSpecificDescription ?? ogDescription ?? [...descriptions].sort((left, right) => right.length - left.length)[0] ?? null;
};

const extractPolymarketOfficeWinnerRuleText = (html: string): string | null => {
  const match = html.match(/<span class="sr-only">([\s\S]*?)<\/span>/i);
  if (!match?.[1]) {
    return null;
  }

  const cleaned = decodeHtmlEntities(match[1])
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
};

const extractPolymarketOfficeWinnerCandidateTitles = (html: string): readonly string[] =>
  uniqueStrings(
    [...html.matchAll(/<p[^>]*class="[^"]*font-semibold[^"]*"[^>]*>([^<]+)<\/p>/gi)]
      .map((match) => decodeHtmlEntities(match[1] ?? "").trim())
      .filter((label) =>
        label.length > 0
        && !/^beware of external links\.?$/i.test(label)
        && !/\b(?:polymarket|politics|trending|popular|ending soon|buy yes|buy no|vol\.?)\b/i.test(label)
        && /[A-Za-z]/.test(label)
        && !/\b(?:presidential election winner|global elections)\b/i.test(label)
      )
  );

export const parseOpinionOfficeWinnerDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = extractFirstDecodedMatch(input.html, [
    /<title>([^<]+)<\/title>/i,
    /<meta\s+property="og:title"\s+content="([^"]+)"/i,
    /"title":"([^"]+)"/i
  ]);
  const description = extractFirstDecodedMatch(input.html, [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /"name":"description","content":"([^"]+)"/i
  ]);
  const venueMarketId = extractFirstDecodedMatch(input.html, [
    /https:\/\/app\.opinion\.trade\/og\/[^/]+\/(\d+)/i
  ]) ?? toSlugFromUrl(input.url);

  if (!title || !venueMarketId || !matchesOfficeWinnerTopicTarget({ title, rulesText: description })) {
    return null;
  }

  const candidateLabels = description ? parseOpinionDescriptionCandidates(description) : [];
  return {
    venue: "OPINION",
    venueMarketId,
    slug: toSlugFromUrl(input.url),
    title,
    rulesText: description ?? "Direct page census from app.opinion.trade office-winner market page.",
    categoryHints: ["Politics", "Opinion", "Office Winner"],
    tags: ["Politics", "Office Winner"],
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: (candidateLabels.length > 0 ? candidateLabels : ["Yes", "No"]).map((label) => ({ label })),
    sourceUrl: input.url,
    rawPayload: {
      title,
      description,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "opinion_direct_market_page_office_winner_targeted"
  };
};

export const parseOpinionPartyControlDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = extractFirstDecodedMatch(input.html, [
    /<title>([^<]+)<\/title>/i,
    /<meta\s+property="og:title"\s+content="([^"]+)"/i
  ]);
  const description = extractFirstDecodedMatch(input.html, [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /"name":"description","content":"([^"]+)"/i,
    /<meta\s+property="og:description"\s+content="([^"]+)"/i
  ]);
  const venueMarketId = extractFirstDecodedMatch(input.html, [
    /https:\/\/app\.opinion\.trade\/og\/[^/]+\/(\d+)/i
  ]) ?? toSlugFromUrl(input.url);

  if (!title || !venueMarketId || !matchesPartyControlTopicTarget({ title, rulesText: description })) {
    return null;
  }

  const outcomeLabels = description ? parseOpinionDescriptionCandidates(description) : [];

  return {
    venue: "OPINION",
    venueMarketId,
    slug: toSlugFromUrl(input.url),
    title,
    rulesText: description ?? "Direct page census from app.opinion.trade party-control market page.",
    categoryHints: ["Politics", "Opinion", "Party Control"],
    tags: ["Politics", "Party Control", "Balance of Power"],
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: (outcomeLabels.length > 0 ? outcomeLabels : ["Yes", "No"]).map((label) => ({ label })),
    sourceUrl: input.url,
    rawPayload: {
      title,
      description,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "opinion_direct_market_page_party_control_targeted"
  };
};

export const parseOpinionOfficeExitDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = extractFirstDecodedMatch(input.html, [
    /<title>([^<]+)<\/title>/i,
    /<meta\s+property="og:title"\s+content="([^"]+)"/i,
    /"title":"([^"]+)"/i
  ]);
  const description = extractFirstDecodedMatch(input.html, [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /<meta\s+property="og:description"\s+content="([^"]+)"/i,
    /"name":"description","content":"([^"]+)"/i
  ]);
  const venueMarketId = extractFirstDecodedMatch(input.html, [
    /https:\/\/app\.opinion\.trade\/og\/[^/]+\/(\d+)/i
  ]) ?? toSlugFromUrl(input.url);
  const spec = inferOfficeExitDirectPageTargetSpec({
    url: input.url,
    title,
    rulesText: description,
    html: input.html
  });

  if (!venueMarketId || !spec || !matchesOfficeExitTopicTarget({ title: spec.canonicalTitle, rulesText: spec.canonicalRulesText })) {
    return null;
  }

  return {
    venue: "OPINION",
    venueMarketId,
    slug: toSlugFromUrl(input.url),
    title: spec.canonicalTitle,
    rulesText: spec.canonicalRulesText,
    categoryHints: ["Politics", "Opinion", "Office Exit"],
    tags: spec.tags,
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: [{ label: "Yes" }, { label: "No" }],
    sourceUrl: input.url,
    rawPayload: {
      title,
      description,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "opinion_direct_market_page_office_exit_targeted"
  };
};

export const parseLimitlessOfficeWinnerDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const searchableHtml = normalizeLimitlessDirectPageHtml(input.html);
  const title = stripLeadingDecorators(
    extractFirstDecodedMatch(searchableHtml, [
      /<title>([^<]+)<\/title>/i,
      /<meta\s+property="og:title"\s+content="([^"]+)"/i
    ]) ?? ""
  );
  const slug = toSlugFromUrl(input.url);
  const rawDescription = extractLimitlessOfficeWinnerRuleText(searchableHtml)
    ?? extractFirstDecodedMatch(searchableHtml, [
    /"description":"((?:\\.|[^"\\])*)"/i,
    /<meta\s+name="description"\s+content="([^"]+)"/i
  ]);

  const cleanedTitle = cleanLimitlessPageTitle(title);

  if (!cleanedTitle || !slug || !matchesOfficeWinnerTopicTarget({ title: cleanedTitle, rulesText: rawDescription })) {
    return null;
  }

  const candidateTitles = extractLimitlessOfficeWinnerCandidateTitles(searchableHtml, cleanedTitle);

  return {
    venue: "LIMITLESS",
    venueMarketId: slug,
    slug,
    title: cleanedTitle,
    rulesText: rawDescription ? decodeJsonEscapes(rawDescription) : "Direct page census from limitless.exchange office-winner market page.",
    categoryHints: ["Politics", "Limitless", "Office Winner"],
    tags: ["Politics", "Office Winner"],
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: (candidateTitles.length > 0 ? candidateTitles : ["Yes", "No"]).map((label) => ({ label })),
    sourceUrl: input.url,
    rawPayload: {
      title,
      description: rawDescription,
      candidateTitles,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "limitless_direct_market_page_office_winner_targeted"
  };
};

export const parseLimitlessOfficeExitDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const searchableHtml = normalizeLimitlessDirectPageHtml(input.html);
  const title = stripLeadingDecorators(
    extractFirstDecodedMatch(searchableHtml, [
      /<title>([^<]+)<\/title>/i,
      /<meta\s+property="og:title"\s+content="([^"]+)"/i
    ]) ?? ""
  );
  const slug = toSlugFromUrl(input.url);
  const description = extractLimitlessOfficeExitRuleText(searchableHtml);
  const spec = inferOfficeExitDirectPageTargetSpec({
    url: input.url,
    title: cleanLimitlessPageTitle(title),
    rulesText: description ? decodeJsonEscapes(description) : null,
    html: searchableHtml
  });

  if (!slug || !spec || !matchesOfficeExitTopicTarget({ title: spec.canonicalTitle, rulesText: spec.canonicalRulesText })) {
    return null;
  }

  return {
    venue: "LIMITLESS",
    venueMarketId: slug,
    slug,
    title: spec.canonicalTitle,
    rulesText: spec.canonicalRulesText,
    categoryHints: ["Politics", "Limitless", "Office Exit"],
    tags: spec.tags,
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: [{ label: "Yes" }, { label: "No" }],
    sourceUrl: input.url,
    rawPayload: {
      title,
      description,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "limitless_direct_market_page_office_exit_targeted"
  };
};

export const parsePolymarketOfficeWinnerDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = cleanPolymarketPageTitle(
    extractFirstDecodedMatch(input.html, [
      /<meta\s+property="og:title"\s+content="([^"]+)"/i,
      /<title[^>]*>([^<]+)<\/title>/i
    ]) ?? ""
  );
  const slug = toSlugFromUrl(input.url);
  const rulesText = extractPolymarketOfficeWinnerRuleText(input.html);

  if (!title || !slug || !matchesOfficeWinnerTopicTarget({ title, rulesText })) {
    return null;
  }

  const candidateTitles = extractPolymarketOfficeWinnerCandidateTitles(input.html);

  return {
    venue: "POLYMARKET",
    venueMarketId: slug,
    slug,
    title,
    rulesText: rulesText ?? "Direct page census from polymarket.com office-winner market page.",
    categoryHints: ["Politics", "Polymarket", "Office Winner"],
    tags: ["Politics", "Office Winner"],
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: (candidateTitles.length > 0 ? candidateTitles : ["Yes", "No"]).map((label) => ({ label })),
    sourceUrl: input.url,
    rawPayload: {
      title,
      rulesText,
      candidateTitles,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "polymarket_direct_market_page_office_winner_targeted"
  };
};

export const parsePolymarketPartyControlDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = cleanPolymarketPageTitle(
    extractFirstDecodedMatch(input.html, [
      /<title>([^<]+)<\/title>/i,
      /<meta\s+property="og:title"\s+content="([^"]+)"/i
    ]) ?? ""
  );
  const slug = toSlugFromUrl(input.url);
  const description = extractFirstDecodedMatch(input.html, [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /<meta\s+property="og:description"\s+content="([^"]+)"/i
  ]);

  if (!title || !slug || !matchesPartyControlTopicTarget({ title, rulesText: description })) {
    return null;
  }

  const outcomes = extractPartyControlOutcomeLabels(input.html);

  return {
    venue: "POLYMARKET",
    venueMarketId: slug,
    slug,
    title,
    rulesText: description ?? "Direct page census from polymarket.com party-control market page.",
    categoryHints: ["Politics", "Polymarket", "Party Control"],
    tags: ["Politics", "Party Control", "Balance of Power"],
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: (outcomes.length > 0 ? outcomes : ["Yes", "No"]).map((label) => ({ label })),
    sourceUrl: input.url,
    rawPayload: {
      title,
      description,
      outcomes,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "polymarket_direct_market_page_party_control_targeted"
  };
};

export const parsePolymarketOfficeExitDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = cleanPolymarketPageTitle(
    extractFirstDecodedMatch(input.html, [
      /<meta\s+property="og:title"\s+content="([^"]+)"/i,
      /<title[^>]*>([^<]+)<\/title>/i
    ]) ?? ""
  );
  const rulesText = extractPolymarketOfficeWinnerRuleText(input.html);
  const slug = toSlugFromUrl(input.url);
  const spec = inferOfficeExitDirectPageTargetSpec({
    url: input.url,
    title,
    rulesText,
    html: input.html
  });

  if (!slug || !spec || !matchesOfficeExitTopicTarget({ title: spec.canonicalTitle, rulesText: spec.canonicalRulesText })) {
    return null;
  }

  return {
    venue: "POLYMARKET",
    venueMarketId: slug,
    slug,
    title: spec.canonicalTitle,
    rulesText: spec.canonicalRulesText,
    categoryHints: ["Politics", "Polymarket", "Office Exit"],
    tags: spec.tags,
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: [{ label: "Yes" }, { label: "No" }],
    sourceUrl: input.url,
    rawPayload: {
      title,
      rulesText,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "polymarket_direct_market_page_office_exit_targeted"
  };
};

export const parsePredictPartyControlDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = extractFirstDecodedMatch(input.html, [
    /<title>([^<]+)<\/title>/i,
    /#\s*([^\n<]+Balance of Power[^\n<]+)/i
  ]);

  if (!title || !matchesPartyControlTopicTarget({ title, rulesText: input.html })) {
    return null;
  }

  const outcomes = extractPartyControlOutcomeLabels(input.html);

  return {
    venue: "PREDICT",
    venueMarketId: toSlugFromUrl(input.url) ?? "balance-of-power-2026-midterm-elections",
    slug: toSlugFromUrl(input.url),
    title,
    rulesText: "Direct page census from predict.fun party-control market page.",
    categoryHints: ["Politics", "Predict", "Party Control"],
    tags: ["Politics", "Party Control", "Balance of Power"],
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: (outcomes.length > 0 ? outcomes : ["Yes", "No"]).map((label) => ({ label })),
    sourceUrl: input.url,
    rawPayload: {
      title,
      outcomes,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "predict_direct_market_page_party_control_targeted"
  };
};

export const parsePredictOfficeExitDirectPage = (input: {
  url: string;
  html: string;
}): FreshPoliticsFetchRow | null => {
  const title = extractFirstDecodedMatch(input.html, [
    /<title>([^<]+)<\/title>/i,
    /#\s*([^\n<]+)/i
  ]);
  const spec = inferOfficeExitDirectPageTargetSpec({
    url: input.url,
    title,
    rulesText: input.html,
    html: input.html
  });

  if (!spec || !matchesOfficeExitTopicTarget({ title: spec.canonicalTitle, rulesText: spec.canonicalRulesText })) {
    return null;
  }

  return {
    venue: "PREDICT",
    venueMarketId: toSlugFromUrl(input.url) ?? spec.canonicalTitle,
    slug: toSlugFromUrl(input.url),
    title: spec.canonicalTitle,
    rulesText: spec.canonicalRulesText,
    categoryHints: ["Politics", "Predict", "Office Exit"],
    tags: spec.tags,
    active: true,
    publishedAt: null,
    expiresAt: null,
    resolvesAt: null,
    outcomes: [{ label: "Yes" }, { label: "No" }],
    sourceUrl: input.url,
    rawPayload: {
      title,
      directPage: true
    },
    fetchTimestamp: new Date().toISOString(),
    discoveryPath: "predict_direct_market_page_office_exit_targeted"
  };
};

const fetchOpinionOfficeWinnerDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of OPINION_OFFICE_WINNER_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parseOpinionOfficeWinnerDirectPage({
      url,
      html
    });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchOpinionOfficeExitDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of OPINION_OFFICE_EXIT_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parseOpinionOfficeExitDirectPage({ url, html });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchOpinionPartyControlDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of OPINION_PARTY_CONTROL_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parseOpinionPartyControlDirectPage({ url, html });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchLimitlessOfficeWinnerDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of LIMITLESS_OFFICE_WINNER_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parseLimitlessOfficeWinnerDirectPage({
      url,
      html
    });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchLimitlessOfficeExitDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of LIMITLESS_OFFICE_EXIT_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parseLimitlessOfficeExitDirectPage({ url, html });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchPolymarketOfficeWinnerDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of POLYMARKET_OFFICE_WINNER_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parsePolymarketOfficeWinnerDirectPage({
      url,
      html
    });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchPolymarketOfficeExitDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of POLYMARKET_OFFICE_EXIT_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parsePolymarketOfficeExitDirectPage({ url, html });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchPolymarketPartyControlDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of POLYMARKET_PARTY_CONTROL_DIRECT_PAGE_URLS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parsePolymarketPartyControlDirectPage({ url, html });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchPredictPartyControlDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of PREDICT_PARTY_CONTROL_DIRECT_PAGE_URLS) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parsePredictPartyControlDirectPage({ url, html });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const fetchPredictOfficeExitDirectPageRows = async (): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const url of PREDICT_OFFICE_EXIT_DIRECT_PAGE_URLS) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      continue;
    }
    const html = await response.text();
    const parsed = parsePredictOfficeExitDirectPage({ url, html });
    if (parsed) {
      rows.set(parsed.venueMarketId, parsed);
    }
  }
  return [...rows.values()];
};

const PREDICT_OFFICE_EXIT_API_TARGETS: readonly PredictOfficeExitApiTargetSpec[] = [
  {
    canonicalTitle: "Trump out as President before 2027?",
    sourceUrl: "https://predict.fun/market/trump-out-as-president-before-2027",
    exactMarketIdEnvKeys: PREDICT_OFFICE_EXIT_TRUMP_EXACT_MARKET_ID_ENV_KEYS,
    searchLabels: [
      "trump out as president before 2027",
      "donald trump out before 2027"
    ]
  },
  {
    canonicalTitle: "Netanyahu out before 2027?",
    sourceUrl: "https://predict.fun/market/netanyahu-out-before-2027",
    exactMarketIdEnvKeys: PREDICT_OFFICE_EXIT_NETANYAHU_EXACT_MARKET_ID_ENV_KEYS,
    searchLabels: [
      "netanyahu out before 2027",
      "benjamin netanyahu out before 2027"
    ]
  }
] as const;

const matchesPredictOfficeExitApiTarget = (target: PredictOfficeExitApiTargetSpec, market: {
  title: string;
  description: string | null;
  categories: readonly string[];
  tags: readonly string[];
}): boolean => {
  if (!matchesOfficeExitTopicTarget({
    title: market.title,
    rulesText: market.description,
    categoryHints: market.categories,
    tags: market.tags
  })) {
    return false;
  }

  const spec = inferOfficeExitDirectPageTargetSpec({
    url: target.sourceUrl,
    title: market.title,
    rulesText: market.description,
    html: market.description ?? ""
  });

  return spec?.canonicalTitle === target.canonicalTitle;
};

export const fetchPredictTargetedOfficeExitApiRows = async (input: {
  client: PredictClient;
  adapter: PredictMarketAdapter;
}): Promise<readonly FreshPoliticsFetchRow[]> => {
  const rows = new Map<string, FreshPoliticsFetchRow>();

  for (const target of PREDICT_OFFICE_EXIT_API_TARGETS) {
    const candidateIds = new Set<string>();

    for (const envKey of target.exactMarketIdEnvKeys) {
      const explicitId = process.env[envKey]?.trim();
      if (explicitId) {
        candidateIds.add(explicitId);
      }
    }

    for (const search of target.searchLabels) {
      try {
        const batch = await input.client.getMarkets({ page: 1, limit: 25, search });
        for (const item of batch) {
          const raw = toRecord(item);
          const title = typeof raw.title === "string" ? raw.title : "";
          const description = typeof raw.description === "string" ? raw.description : null;
          const categories = Array.isArray(raw.categories) ? raw.categories.filter((value): value is string => typeof value === "string") : [];
          const tags = Array.isArray(raw.tags) ? raw.tags.filter((value): value is string => typeof value === "string") : [];
          if (matchesPredictOfficeExitApiTarget(target, { title, description, categories, tags })) {
            candidateIds.add(String(raw.id));
          }
        }
      } catch {
        continue;
      }
    }

    for (const marketId of candidateIds) {
      try {
        const market = await input.adapter.getMarketById(marketId);
        const spec = inferOfficeExitDirectPageTargetSpec({
          url: target.sourceUrl,
          title: market.title,
          rulesText: market.description,
          html: JSON.stringify(market.raw)
        });

        if (!spec || spec.canonicalTitle !== target.canonicalTitle) {
          continue;
        }

        rows.set(market.venueMarketId, {
          venue: "PREDICT",
          venueMarketId: market.venueMarketId,
          slug: toSlugFromUrl(target.sourceUrl),
          title: spec.canonicalTitle,
          rulesText: spec.canonicalRulesText,
          categoryHints: uniqueStrings([...market.categories, ...market.tags, "POLITICS", "Office Exit"]),
          tags: uniqueStrings([...market.tags, ...spec.tags]),
          active: isPredictOpen(market),
          publishedAt: market.createdAt,
          expiresAt: market.closesAt,
          resolvesAt: market.resolvesAt,
          outcomes: [{ label: "Yes" }, { label: "No" }],
          sourceUrl: target.sourceUrl,
          rawPayload: market.raw,
          fetchTimestamp: new Date().toISOString(),
          discoveryPath: "predict_exact_market_api_office_exit_targeted"
        });
      } catch {
        continue;
      }
    }
  }

  return [...rows.values()];
};

const fetchPredictTargetedPartyControlApiRows = async (input: {
  client: PredictClient;
  adapter: PredictMarketAdapter;
}): Promise<readonly FreshPoliticsFetchRow[]> => {
  const candidateIds = new Set<string>();
  const componentMarketIds = new Set<string>();

  for (const envKey of PREDICT_PARTY_CONTROL_EXACT_MARKET_ID_ENV_KEYS) {
    const explicitId = process.env[envKey]?.trim();
    if (explicitId) {
      candidateIds.add(explicitId);
    }
  }
  for (const envKey of PREDICT_PARTY_CONTROL_COMPONENT_MARKET_IDS_ENV_KEYS) {
    const value = process.env[envKey]?.trim();
    if (!value) {
      continue;
    }
    for (const explicitId of value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
      componentMarketIds.add(explicitId);
      candidateIds.add(explicitId);
    }
  }

  for (const search of PARTY_CONTROL_TARGET_QUERY_LABELS) {
    try {
      const batch = await input.client.getMarkets({ page: 1, limit: 25, search });
      for (const item of batch) {
        const raw = toRecord(item);
        const title = typeof raw.title === "string" ? raw.title : "";
        const description = typeof raw.description === "string" ? raw.description : "";
        const categories = Array.isArray(raw.categories) ? raw.categories.filter((value): value is string => typeof value === "string") : [];
        const tags = Array.isArray(raw.tags) ? raw.tags.filter((value): value is string => typeof value === "string") : [];
        if (matchesPartyControlTopicTarget({ title, rulesText: description, categoryHints: categories, tags })) {
          candidateIds.add(String(raw.id));
        }
      }
    } catch {
      continue;
    }
  }

  const rows = new Map<string, FreshPoliticsFetchRow>();
  for (const marketId of candidateIds) {
    try {
      const market = await input.adapter.getMarketById(marketId);
      const row: FreshPoliticsFetchRow = {
        venue: "PREDICT",
        venueMarketId: market.venueMarketId,
        slug: null,
        title: market.title,
        rulesText: market.description,
        categoryHints: uniqueStrings([...market.categories, ...market.tags, "POLITICS"]),
        tags: market.tags,
        active: isPredictOpen(market),
        publishedAt: market.createdAt,
        expiresAt: market.closesAt,
        resolvesAt: market.resolvesAt,
        outcomes: market.outcomes.map((outcome) => ({ label: outcome.label })),
        sourceUrl: null,
        rawPayload: market.raw,
        fetchTimestamp: new Date().toISOString(),
        discoveryPath: "predict_exact_market_api_party_control_targeted"
      };
      rows.set(row.venueMarketId, row);
    } catch {
      continue;
    }
  }

  const componentRows = [...rows.values()].filter((row) => componentMarketIds.has(row.venueMarketId));
  const componentOutcomeLabels = uniqueStrings(componentRows.map((row) => row.title));
  const hasGroupedPredictTopic =
    componentRows.length > 0
    && PARTY_CONTROL_CANONICAL_OUTCOMES.every((label) => componentOutcomeLabels.includes(label));

  if (hasGroupedPredictTopic) {
    return [{
      venue: "PREDICT",
      venueMarketId: "balance-of-power-2026-midterm-elections",
      slug: "balance-of-power-2026-midterm-elections",
      title: PARTY_CONTROL_GROUPED_PREDICT_TITLE,
      rulesText: "Grouped exact-market API rescue from Predict component markets for the 2026 midterms balance of power.",
      categoryHints: ["Politics", "Predict", "Party Control"],
      tags: ["Politics", "Party Control", "Balance of Power"],
      active: componentRows.some((row) => row.active !== false),
      publishedAt: null,
      expiresAt: null,
      resolvesAt: null,
      outcomes: PARTY_CONTROL_CANONICAL_OUTCOMES.map((label) => ({ label })),
      sourceUrl: "https://predict.fun/market/balance-of-power-2026-midterm-elections",
      rawPayload: {
        groupedComponentMarketIds: componentRows.map((row) => row.venueMarketId).sort(),
        groupedComponentTitles: componentRows.map((row) => row.title).sort(),
        groupedPredictTopic: true
      },
      fetchTimestamp: new Date().toISOString(),
      discoveryPath: "predict_grouped_market_api_party_control_targeted"
    }];
  }

  return [...rows.values()];
};

export const extractLimitlessOutcomeLabels = (market: LimitlessLiveMarket): readonly { label: string }[] => {
  const raw = toRecord(market.raw);
  const labels = uniqueStrings([
    ...extractStringLabels(raw.outcomes),
    ...extractStringLabels(raw.options),
    ...extractStringLabels(raw.selections),
    ...extractStringLabels(raw.outcomeLabels)
  ]);
  return labels.length > 0 ? labels.map((label) => ({ label })) : [{ label: "Yes" }, { label: "No" }];
};

const probeLimitlessTargetedPages = async (input: {
  baseUrl: string;
  paths: readonly string[];
  timeoutMs: number;
}): Promise<{
  foundAny: boolean;
  sourceRefs: readonly string[];
  warnings: readonly string[];
}> => {
  const sourceRefs: string[] = [];
  const warnings: string[] = [];
  let foundAny = false;

  for (const route of input.paths) {
    try {
      const response = await fetch(new URL(route, input.baseUrl), {
        signal: AbortSignal.timeout(input.timeoutMs)
      });
      if (!response.ok) {
        warnings.push(`Limitless targeted probe failed for ${route} with HTTP ${response.status}.`);
        continue;
      }
      const text = await response.text();
      sourceRefs.push(`${input.baseUrl}${route}`);
      if (includesNominee2028TopicPattern(text)) {
        foundAny = true;
      }
    } catch (error) {
      warnings.push(`Limitless targeted probe failed for ${route}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    foundAny,
    sourceRefs,
    warnings
  };
};

export const buildFetchStatus = (input: {
  configured: boolean;
  rows: number;
  warnings: readonly string[];
  partial?: boolean;
  degraded?: boolean;
}): PoliticsCurrentFetchStatus => {
  if (!input.configured) {
    return "NOT_CONFIGURED";
  }
  if (input.partial) {
    return "PARTIAL";
  }
  if (input.degraded) {
    return "DEGRADED";
  }
  if (input.rows === 0) {
    return input.warnings.length > 0 ? "UNAVAILABLE" : "EMPTY";
  }
  return "SUCCESS";
};

export const classifyPoliticsCurrentAdmission = (row: FreshPoliticsFetchRow): PoliticsCurrentAdmissionLabel => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.categoryHints.join(" ")} ${row.tags.join(" ")}`.trim();
  if (NON_POLITICS_PATTERNS.test(combined) && !POLITICS_PATTERNS.test(combined)) {
    return "NON_POLITICS_REJECTED";
  }
  if (matchesPoliticsCurrentTarget({
    title: row.title,
    rulesText: row.rulesText,
    categoryHints: row.categoryHints,
    tags: row.tags
  })) {
    return "POLITICS_ADMITTED";
  }
  if (POLITICS_PATTERNS.test(combined)) {
    return "POLITICS_ADMITTED";
  }
  if (row.categoryHints.length > 0 || row.tags.length > 0) {
    return "AMBIGUOUS_HELD";
  }
  return "UNKNOWN_CATEGORY";
};

const isOpinionActivatedMarket = (market: OpinionNormalizedMarket): boolean =>
  market.status?.toUpperCase() === "ACTIVATED" || market.statusCode === 2;

const isPredictOpen = (market: PredictNormalizedMarket): boolean =>
  typeof market.status === "string" ? /open|active|trading/i.test(market.status) : true;

const isPolymarketOpen = (row: PredexonMarket): boolean =>
  typeof row.active === "boolean" ? row.active
  : typeof row.closed === "boolean" ? !row.closed
  : typeof row.archived === "boolean" ? !row.archived
  : true;

export const buildPoliticsCurrentFetchArtifacts = (results: readonly PoliticsCurrentFetchResult[]) => ({
  fetchSummary: {
    observedAt: new Date().toISOString(),
    rowsByVenue: Object.fromEntries(results.map((result) => [result.venue, result.rows.length])),
    statuses: Object.fromEntries(results.map((result) => [result.venue, result.status])),
    primaryPaths: Object.fromEntries(results.map((result) => [result.venue, result.primaryDiscoveryPath ?? result.discoveryPath])),
    broadDiscoveryRowCounts: Object.fromEntries(results.map((result) => [result.venue, result.broadDiscoveryRowCount ?? result.rows.length])),
    targetedDiscoveryRowCounts: Object.fromEntries(results.map((result) => [result.venue, result.targetedDiscoveryRowCount ?? 0]))
  },
  fetchByVenue: Object.fromEntries(results.map((result) => [result.venue, {
    fetchStatus: result.status,
    discoveryPath: result.discoveryPath,
    primaryDiscoveryPath: result.primaryDiscoveryPath ?? result.discoveryPath,
    fallbackDiscoveryPathUsed: result.fallbackDiscoveryPathUsed ?? null,
    primaryPathFailure: result.primaryPathFailure ?? null,
    broadDiscoveryRowCount: result.broadDiscoveryRowCount ?? result.rows.length,
    targetedDiscoveryRowCount: result.targetedDiscoveryRowCount ?? 0,
    targetedDiscoveryPathUsed: result.targetedDiscoveryPathUsed ?? null,
    targetedQueryLabels: result.targetedQueryLabels ?? [],
    rows: result.rows.map((row) => ({
      venueMarketId: row.venueMarketId,
      title: row.title,
      sourceUrl: row.sourceUrl,
      active: row.active,
      expiresAt: row.expiresAt?.toISOString() ?? null
    }))
  }])),
  fetchStatus: Object.fromEntries(results.map((result) => [result.venue, {
    fetchStatus: result.status,
    warnings: result.warnings,
    discoveryPath: result.discoveryPath,
    primaryDiscoveryPath: result.primaryDiscoveryPath ?? result.discoveryPath,
    fallbackDiscoveryPathUsed: result.fallbackDiscoveryPathUsed ?? null,
    primaryPathFailure: result.primaryPathFailure ?? null,
    broadDiscoveryRowCount: result.broadDiscoveryRowCount ?? result.rows.length,
    targetedDiscoveryRowCount: result.targetedDiscoveryRowCount ?? 0,
    targetedDiscoveryPathUsed: result.targetedDiscoveryPathUsed ?? null,
    targetedQueryLabels: result.targetedQueryLabels ?? []
  }]))
});

const buildPolymarketSeed = (row: FreshPoliticsFetchRow): CuratedCanonicalGraphSeed => ({
  canonicalEventId: buildStableUuid(`polymarket-current-politics:${row.venueMarketId}`),
  canonicalMarketId: `polymarket-current-politics-${row.venueMarketId}`,
  canonicalCategory: "POLITICS",
  venue: "POLYMARKET",
  venueMarketId: row.venueMarketId,
  title: row.title,
  description: row.rulesText,
  marketType: "BINARY",
  marketClass: "BINARY",
  outcomes: row.outcomes.map((outcome, index) => ({
    id: `${row.venueMarketId}:${index}`,
    label: outcome.label,
    metadata: { venue: "POLYMARKET" }
  })),
  outcomeSchema: {
    marketShape: row.outcomes.length === 2 ? "binary" : "categorical",
    outcomeLabels: row.outcomes.map((outcome) => outcome.label)
  },
  topics: [...row.categoryHints, ...row.tags],
  publishedAt: row.publishedAt,
  expiresAt: row.expiresAt,
  resolvesAt: row.resolvesAt,
  resolutionSource: "predexon_polymarket_current_politics_refresh",
  resolutionTitle: row.title,
  resolutionRulesText: row.rulesText,
  resolutionAuthorityType: "CENTRAL",
  settlementType: "unknown",
  rawSourcePayload: row.rawPayload,
  normalizedPayload: {
    discoveryPath: row.discoveryPath,
    sourceUrl: row.sourceUrl,
    refreshPass: "politics-current-state-refresh"
  },
  mappingLineage: ["politics-current-state-refresh", "predexon-current-polymarket"],
  sourceMetadataVersion: POLYMARKET_METADATA_VERSION,
  propositionHints: {
    normalizedPropositionText: `${row.title} ${row.rulesText ?? ""}`.trim()
  },
  executableDisplayName: row.title,
  executableMetadata: {
    refreshPass: "politics-current-state-refresh",
    freshCurrentState: true
  }
});

const extractPoliticsPredexonOutcomes = (row: PredexonMarket): readonly { label: string }[] => {
  const raw = toRecord(row.raw);
  const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes : [];
  const labels = outcomes
    .map((outcome) =>
      typeof outcome === "object" && outcome !== null && typeof (outcome as Record<string, unknown>).label === "string"
        ? String((outcome as Record<string, unknown>).label)
        : null
    )
    .filter((value): value is string => value !== null);
  return labels.length > 0 ? labels.map((label) => ({ label })) : [{ label: "Yes" }, { label: "No" }];
};

const isPoliticsPredexonRow = (row: PredexonMarket): boolean => {
  const raw = toRecord(row.raw);
  const text = [
    row.title,
    typeof raw.description === "string" ? raw.description : "",
    typeof row.event_slug === "string" ? row.event_slug : "",
    Array.isArray(raw.tags) ? raw.tags.join(" ") : ""
  ].join(" ");
  return POLITICS_PATTERNS.test(text) && !NON_POLITICS_PATTERNS.test(text.replace(POLITICS_PATTERNS, ""));
};

const fetchOpinionPoliticsCurrentState = async (): Promise<PoliticsCurrentFetchResult> => {
  const client = new OpinionCurrentDiscoveryClient({
    apiKey: process.env.OPINION_API_KEY ?? null,
    baseUrl: process.env.OPINION_CLOB_BASE_URL ?? "https://proxy.opinion.trade:8443/openapi",
    fallbackBaseUrl: process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi",
    maxPages: 20,
    pageSize: 20
  });
  const discovery = await client.listCurrentMarkets(OPINION_METADATA_VERSION);
  const targetedDiscovery = await client.listTargetedMarkets({
    metadataVersion: OPINION_METADATA_VERSION,
    matcher: (market) => matchesPoliticsCurrentTarget({
      title: market.title,
      rulesText: market.rules,
      categoryHints: market.labels
    }),
    maxPages: 40,
    pageSize: 20
  });
  const adapter = new OpinionMarketAdapter({
    client: { listMarkets: async () => [] },
    metadataVersion: OPINION_METADATA_VERSION
  });
  const broadRows = discovery.rows
    .filter((market) => adapter.inferCanonicalCategory(market) === "POLITICS" && isOpinionActivatedMarket(market))
    .map((market) => ({
      venue: "OPINION" as const,
      venueMarketId: market.venueMarketId,
      slug: market.slug,
      title: market.title,
      rulesText: market.rules,
      categoryHints: market.labels,
      tags: [],
      active: true,
      publishedAt: market.createdAt,
      expiresAt: market.cutoffAt,
      resolvesAt: market.resolvedAt,
      outcomes: [{ label: market.yesLabel ?? "Yes" }, { label: market.noLabel ?? "No" }],
      sourceUrl: market.slug ? `https://opinion.trade/markets/${market.slug}` : null,
      rawPayload: market.raw,
      fetchTimestamp: new Date().toISOString(),
      discoveryPath: discovery.fallbackDiscoveryPathUsed ?? discovery.primaryDiscoveryPath
    }));
  const targetedRows = targetedDiscovery.rows
    .filter(isOpinionActivatedMarket)
    .map((market) => ({
      venue: "OPINION" as const,
      venueMarketId: market.venueMarketId,
      slug: market.slug,
      title: market.title,
      rulesText: market.rules,
      categoryHints: market.labels,
      tags: [],
      active: true,
      publishedAt: market.createdAt,
      expiresAt: market.cutoffAt,
      resolvesAt: market.resolvedAt,
      outcomes: [{ label: market.yesLabel ?? "Yes" }, { label: market.noLabel ?? "No" }],
      sourceUrl: market.slug ? `https://opinion.trade/markets/${market.slug}` : null,
      rawPayload: market.raw,
      fetchTimestamp: new Date().toISOString(),
      discoveryPath: targetedDiscovery.fallbackDiscoveryPathUsed ?? targetedDiscovery.primaryDiscoveryPath
    }));
  const directOfficeWinnerRows = await fetchOpinionOfficeWinnerDirectPageRows();
  const directOfficeExitRows = await fetchOpinionOfficeExitDirectPageRows();
  const directPartyControlRows = await fetchOpinionPartyControlDirectPageRows();
  const mergedRows = new Map<string, FreshPoliticsFetchRow>();
  for (const row of [...broadRows, ...targetedRows, ...directOfficeWinnerRows, ...directOfficeExitRows, ...directPartyControlRows]) {
    mergedRows.set(row.venueMarketId, row);
  }
  const rows = [...mergedRows.values()];
  const warnings = uniqueStrings([...discovery.warnings, ...targetedDiscovery.warnings]);
  const targetedSucceeded = targetedRows.length > 0 || directOfficeWinnerRows.length > 0 || directOfficeExitRows.length > 0 || directPartyControlRows.length > 0;
  const status =
    discovery.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED"
    : rows.length > 0 ? "SUCCESS"
    : targetedDiscovery.status === "UNAVAILABLE" ? "UNAVAILABLE"
    : discovery.status === "UNAVAILABLE" ? "UNAVAILABLE"
    : "EMPTY";

  return {
    venue: "OPINION",
    status,
    rows,
    discoveryPath: targetedSucceeded
      ? (targetedDiscovery.fallbackDiscoveryPathUsed ?? targetedDiscovery.primaryDiscoveryPath)
      : (discovery.fallbackDiscoveryPathUsed ?? discovery.primaryDiscoveryPath),
    warnings,
    primaryDiscoveryPath: discovery.primaryDiscoveryPath,
    fallbackDiscoveryPathUsed: targetedSucceeded
      ? targetedDiscovery.fallbackDiscoveryPathUsed
      : discovery.fallbackDiscoveryPathUsed,
    primaryPathFailure: discovery.primaryPathFailure ?? targetedDiscovery.primaryPathFailure,
    broadDiscoveryRowCount: broadRows.length,
    targetedDiscoveryRowCount: targetedRows.length + directOfficeWinnerRows.length + directOfficeExitRows.length + directPartyControlRows.length,
    targetedDiscoveryPathUsed: targetedRows.length > 0
      ? (targetedDiscovery.fallbackDiscoveryPathUsed ?? targetedDiscovery.primaryDiscoveryPath)
      : directOfficeWinnerRows.length > 0
        ? "opinion_direct_market_page_office_winner_targeted"
      : directOfficeExitRows.length > 0
        ? "opinion_direct_market_page_office_exit_targeted"
      : directPartyControlRows.length > 0
        ? "opinion_direct_market_page_party_control_targeted"
      : null,
    targetedQueryLabels: [...NOMINEE_2028_TARGET_QUERY_LABELS, ...OFFICE_WINNER_TARGET_QUERY_LABELS, ...OFFICE_EXIT_TARGET_QUERY_LABELS, ...PARTY_CONTROL_TARGET_QUERY_LABELS]
  };
};

const fetchPolymarketPoliticsCurrentState = async (): Promise<PoliticsCurrentFetchResult> => {
  if (!process.env.PREDEXON_API_KEY) {
    return { venue: "POLYMARKET", status: "NOT_CONFIGURED", rows: [], discoveryPath: "predexon_polymarket_current_events", warnings: ["PREDEXON_API_KEY missing"] };
  }
  const client = new PredexonHistoricalClient({
    baseUrl: process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com",
    apiKey: process.env.PREDEXON_API_KEY
  });
  const rows = new Map<string, FreshPoliticsFetchRow>();
  try {
    const eventSlugs = new Set<string>();
    for (let page = 0; page < 5; page += 1) {
      const events = await client.listEvents({
        status: "open",
        category: "Politics",
        limit: 100,
        offset: page * 100
      });
      if (events.length === 0) {
        break;
      }
      for (const event of events) {
        if (typeof event.slug === "string" && event.slug.length > 0) {
          eventSlugs.add(event.slug);
        }
      }
      if (events.length < 100) {
        break;
      }
    }

    const slugs = [...eventSlugs];
    const chunks: string[][] = [];
    for (let index = 0; index < slugs.length; index += 20) {
      chunks.push(slugs.slice(index, index + 20));
    }

    for (const chunk of chunks.length > 0 ? chunks : [[]]) {
      for (let page = 0; page < 5; page += 1) {
        const markets = await client.listMarkets({
          status: "open",
          ...(chunk.length > 0 ? { event_slug: chunk } : { search: "nominee" }),
          limit: 100,
          offset: page * 100
        });
        if (markets.length === 0) {
          break;
        }
        for (const market of markets) {
          if (!isPolymarketOpen(market) || !isPoliticsPredexonRow(market)) {
            continue;
          }
          const raw = toRecord(market.raw);
          rows.set(market.condition_id, {
            venue: "POLYMARKET",
            venueMarketId: market.condition_id,
            slug: market.market_slug ?? market.event_slug ?? null,
            title: market.title,
            rulesText: typeof raw.description === "string" ? raw.description : null,
            categoryHints: uniqueStrings(
              [
                typeof raw.category === "string" ? raw.category : "",
                typeof raw.event_category === "string" ? raw.event_category : "",
                "POLITICS"
              ].filter((value) => value.length > 0)
            ),
            tags: Array.isArray(raw.tags) ? raw.tags.filter((value): value is string => typeof value === "string") : [],
            active: true,
            publishedAt: typeof raw.created_time === "string" ? new Date(raw.created_time) : null,
            expiresAt: typeof raw.end_time === "string" ? new Date(raw.end_time) : null,
            resolvesAt: typeof raw.close_time === "string" ? new Date(raw.close_time) : null,
            outcomes: extractPoliticsPredexonOutcomes(market),
            sourceUrl: market.market_slug ? `https://polymarket.com/event/${market.market_slug}` : null,
            rawPayload: raw,
            fetchTimestamp: new Date().toISOString(),
            discoveryPath: "predexon_polymarket_current_events"
          });
        }
        if (markets.length < 100) {
          break;
        }
      }
    }
    const directOfficeWinnerRows = await fetchPolymarketOfficeWinnerDirectPageRows();
    const directOfficeExitRows = await fetchPolymarketOfficeExitDirectPageRows();
    const directPartyControlRows = await fetchPolymarketPartyControlDirectPageRows();
    for (const row of [...directOfficeWinnerRows, ...directOfficeExitRows, ...directPartyControlRows]) {
      rows.set(row.venueMarketId, row);
    }
    return {
      venue: "POLYMARKET",
      status: buildFetchStatus({ configured: true, rows: rows.size, warnings: [] }),
      rows: [...rows.values()],
      discoveryPath: directOfficeWinnerRows.length > 0 || directOfficeExitRows.length > 0 || directPartyControlRows.length > 0
        ? directPartyControlRows.length > 0
          ? "polymarket_direct_market_page_party_control_targeted"
          : directOfficeExitRows.length > 0
            ? "polymarket_direct_market_page_office_exit_targeted"
          : "polymarket_direct_market_page_office_winner_targeted"
        : "predexon_polymarket_current_events",
      warnings: [],
      primaryDiscoveryPath: "predexon_polymarket_current_events",
      fallbackDiscoveryPathUsed:
        directPartyControlRows.length > 0 ? "polymarket_direct_market_page_party_control_targeted"
        : directOfficeExitRows.length > 0 ? "polymarket_direct_market_page_office_exit_targeted"
        : directOfficeWinnerRows.length > 0 ? "polymarket_direct_market_page_office_winner_targeted"
        : null,
      primaryPathFailure: null,
      broadDiscoveryRowCount: rows.size - directOfficeWinnerRows.length - directOfficeExitRows.length - directPartyControlRows.length,
      targetedDiscoveryRowCount: directOfficeWinnerRows.length + directOfficeExitRows.length + directPartyControlRows.length,
      targetedDiscoveryPathUsed:
        directPartyControlRows.length > 0 ? "polymarket_direct_market_page_party_control_targeted"
        : directOfficeExitRows.length > 0 ? "polymarket_direct_market_page_office_exit_targeted"
        : directOfficeWinnerRows.length > 0 ? "polymarket_direct_market_page_office_winner_targeted"
        : null,
      targetedQueryLabels:
        directOfficeWinnerRows.length > 0 || directOfficeExitRows.length > 0 || directPartyControlRows.length > 0
          ? [...OFFICE_WINNER_TARGET_QUERY_LABELS, ...OFFICE_EXIT_TARGET_QUERY_LABELS, ...PARTY_CONTROL_TARGET_QUERY_LABELS]
          : []
    };
  } catch (error) {
    return {
      venue: "POLYMARKET",
      status: "UNAVAILABLE",
      rows: [],
      discoveryPath: "predexon_polymarket_current_events",
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
};

const fetchPredictPoliticsCurrentState = async (): Promise<PoliticsCurrentFetchResult & {
  normalizedRows: readonly PredictNormalizedMarket[];
  orderbooks: ReadonlyMap<string, PredictNormalizedOrderbookSnapshot | null>;
}> => {
  if (!process.env.PREDICT_API_KEY) {
    const directOfficeExitRows = await fetchPredictOfficeExitDirectPageRows().catch(() => [] as readonly FreshPoliticsFetchRow[]);
    const directPartyControlRows = await fetchPredictPartyControlDirectPageRows().catch(() => [] as readonly FreshPoliticsFetchRow[]);
    return {
      venue: "PREDICT",
      status: directOfficeExitRows.length > 0 || directPartyControlRows.length > 0 ? "SUCCESS" : "NOT_CONFIGURED",
      rows: [...directOfficeExitRows, ...directPartyControlRows],
      normalizedRows: [],
      orderbooks: new Map(),
      discoveryPath:
        directPartyControlRows.length > 0 ? "predict_direct_market_page_party_control_targeted"
        : directOfficeExitRows.length > 0 ? "predict_direct_market_page_office_exit_targeted"
        : "predict_current_markets",
      warnings: uniqueStrings([
        "PREDICT_API_KEY missing",
        ...(directOfficeExitRows.length === 0 ? ["predict_direct_page_office_exit_not_proven"] : []),
        ...(directPartyControlRows.length === 0 ? ["predict_direct_page_party_control_not_proven"] : [])
      ]),
      fallbackDiscoveryPathUsed:
        directPartyControlRows.length > 0 ? "predict_direct_market_page_party_control_targeted"
        : directOfficeExitRows.length > 0 ? "predict_direct_market_page_office_exit_targeted"
        : null,
      targetedDiscoveryRowCount: directOfficeExitRows.length + directPartyControlRows.length,
      targetedDiscoveryPathUsed:
        directPartyControlRows.length > 0 ? "predict_direct_market_page_party_control_targeted"
        : directOfficeExitRows.length > 0 ? "predict_direct_market_page_office_exit_targeted"
        : null,
      targetedQueryLabels:
        directOfficeExitRows.length > 0 || directPartyControlRows.length > 0
          ? [...OFFICE_EXIT_TARGET_QUERY_LABELS, ...PARTY_CONTROL_TARGET_QUERY_LABELS]
          : []
    };
  }
  const environment: PredictEnvironment = "mainnet";
  const client = new PredictClient({
    environment,
    apiKey: process.env.PREDICT_API_KEY
  });
  const adapter = new PredictMarketAdapter({
    client,
    environment,
    metadataVersion: PREDICT_METADATA_VERSION
  });
  const orderbookAdapter = new PredictOrderbookAdapter({
    client,
    environment
  });
  const candidateIds = new Set<string>();
  try {
    for (let page = 1; page <= 5; page += 1) {
      const batch = await client.getMarkets({ page, limit: 50 });
      if (batch.length === 0) {
        break;
      }
      for (const item of batch) {
        const raw = toRecord(item);
        const text = `${typeof raw.title === "string" ? raw.title : ""} ${typeof raw.description === "string" ? raw.description : ""} ${typeof raw.category === "string" ? raw.category : ""}`;
        if (POLITICS_PATTERNS.test(text) && !NON_POLITICS_PATTERNS.test(text.replace(POLITICS_PATTERNS, ""))) {
          candidateIds.add(String(raw.id));
        }
      }
      if (batch.length < 50) {
        break;
      }
    }

    const normalizedRows = (await Promise.all([...candidateIds].map((marketId) => adapter.getMarketById(marketId))))
      .filter((market) => adapter.inferCanonicalCategory(market) === "POLITICS" && isPredictOpen(market));
    const targetedPartyControlApiRows = await fetchPredictTargetedPartyControlApiRows({
      client,
      adapter
    });
    const targetedOfficeExitApiRows = await fetchPredictTargetedOfficeExitApiRows({
      client,
      adapter
    });
    const targetedOfficeExitDirectRows = await fetchPredictOfficeExitDirectPageRows().catch(() => [] as readonly FreshPoliticsFetchRow[]);
    const targetedPartyControlDirectRows = await fetchPredictPartyControlDirectPageRows().catch(() => [] as readonly FreshPoliticsFetchRow[]);
    const orderbookResults = await Promise.all(
      normalizedRows.map(async (market) => {
        try {
          return [market.venueMarketId, await orderbookAdapter.getOrderbookSnapshot(market.venueMarketId)] as const;
        } catch {
          return [market.venueMarketId, null] as const;
        }
      })
    );
    const orderbooks = new Map(orderbookResults);
    const rows = new Map<string, FreshPoliticsFetchRow>();
    for (const market of normalizedRows) {
      rows.set(market.venueMarketId, {
      venue: "PREDICT",
      venueMarketId: market.venueMarketId,
      slug: null,
      title: market.title,
      rulesText: market.description,
      categoryHints: uniqueStrings([...market.categories, ...market.tags, "POLITICS"]),
      tags: market.tags,
      active: true,
      publishedAt: market.createdAt,
      expiresAt: market.closesAt,
      resolvesAt: market.resolvesAt,
      outcomes: market.outcomes.map((outcome) => ({ label: outcome.label })),
      sourceUrl: null,
      rawPayload: market.raw,
      fetchTimestamp: new Date().toISOString(),
      discoveryPath: "predict_current_markets"
      });
    }
    for (const row of targetedPartyControlApiRows) {
      rows.set(row.venueMarketId, row);
    }
    for (const row of targetedOfficeExitApiRows) {
      rows.set(row.venueMarketId, row);
    }
    for (const row of targetedOfficeExitDirectRows) {
      rows.set(row.venueMarketId, row);
    }
    for (const row of targetedPartyControlDirectRows) {
      rows.set(row.venueMarketId, row);
    }

    return {
      venue: "PREDICT",
      status: buildFetchStatus({ configured: true, rows: rows.size, warnings: [] }),
      rows: [...rows.values()],
      normalizedRows,
      orderbooks,
      discoveryPath:
        targetedPartyControlApiRows.length > 0 ? "predict_exact_market_api_party_control_targeted"
        : targetedOfficeExitApiRows.length > 0 ? "predict_exact_market_api_office_exit_targeted"
        : targetedOfficeExitDirectRows.length > 0 ? "predict_direct_market_page_office_exit_targeted"
        : targetedPartyControlDirectRows.length > 0 ? "predict_direct_market_page_party_control_targeted"
        : "predict_current_markets",
      warnings: [],
      primaryDiscoveryPath: "predict_current_markets",
      fallbackDiscoveryPathUsed:
        targetedPartyControlApiRows.length > 0 ? "predict_exact_market_api_party_control_targeted"
        : targetedOfficeExitApiRows.length > 0 ? "predict_exact_market_api_office_exit_targeted"
        : targetedOfficeExitDirectRows.length > 0 ? "predict_direct_market_page_office_exit_targeted"
        : targetedPartyControlDirectRows.length > 0 ? "predict_direct_market_page_party_control_targeted"
        : null,
      broadDiscoveryRowCount: normalizedRows.length,
      targetedDiscoveryRowCount: targetedPartyControlApiRows.length + targetedOfficeExitApiRows.length + targetedOfficeExitDirectRows.length + targetedPartyControlDirectRows.length,
      targetedDiscoveryPathUsed:
        targetedPartyControlApiRows.length > 0 ? "predict_exact_market_api_party_control_targeted"
        : targetedOfficeExitApiRows.length > 0 ? "predict_exact_market_api_office_exit_targeted"
        : targetedOfficeExitDirectRows.length > 0 ? "predict_direct_market_page_office_exit_targeted"
        : targetedPartyControlDirectRows.length > 0 ? "predict_direct_market_page_party_control_targeted"
        : null,
      targetedQueryLabels:
        targetedPartyControlApiRows.length > 0 || targetedOfficeExitApiRows.length > 0 || targetedOfficeExitDirectRows.length > 0 || targetedPartyControlDirectRows.length > 0
          ? [...OFFICE_EXIT_TARGET_QUERY_LABELS, ...PARTY_CONTROL_TARGET_QUERY_LABELS]
          : []
    };
  } catch (error) {
    return {
      venue: "PREDICT",
      status: "UNAVAILABLE",
      rows: [],
      normalizedRows: [],
      orderbooks: new Map(),
      discoveryPath: "predict_current_markets",
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
};

const fetchLimitlessPoliticsCurrentState = async (repoRoot: string): Promise<PoliticsCurrentFetchResult & {
  liveMarkets: readonly LimitlessLiveMarket[];
}> => {
  const targetedPaths = [
    "/markets",
    "/markets?search=republican%20presidential%20nominee%202028",
    "/markets?search=democratic%20presidential%20nominee%202028",
    "/markets?search=2028%20republican%20presidential%20nomination",
    "/markets?search=2028%20democratic%20presidential%20nomination",
    "/markets?search=jd%20vance",
    "/markets?search=donald%20trump",
    "/markets?search=gavin%20newsom",
    "/markets?search=kamala%20harris",
    ...LIMITLESS_OFFICE_WINNER_TARGET_PATHS
  ] as const;
  const primaryClient = new LimitlessCurrentDiscoveryClient({
    apiKey: process.env.LIMITLESS_API_KEY ?? null,
    baseUrl: process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange",
    requestTimeoutMs: 5_000
  });
  const primary = await primaryClient.listCurrentMarkets();
  const politicsRows = primary.rows.filter((market) => market.canonicalCategory === "POLITICS");
  const targetedBroadRows = politicsRows.filter((market) =>
    matchesPoliticsCurrentTarget({
      title: market.title,
      rulesText: market.description,
      categoryHints: market.categories,
      tags: market.tags
    })
  );

  let targetedFallbackRows: readonly LimitlessLiveMarket[] = [];
  let directOfficeWinnerRows: readonly FreshPoliticsFetchRow[] = [];
  let directOfficeExitRows: readonly FreshPoliticsFetchRow[] = [];
  let targetedFallbackWarnings: readonly string[] = [];
  let targetedDiscoveryPathUsed: string | null = null;
  let fallbackDiscoveryPathUsed: string | null = null;
  let primaryPathFailure: string | null = null;

  if (targetedBroadRows.length === 0) {
    try {
      const probe = await probeLimitlessTargetedPages({
        baseUrl: "https://limitless.exchange",
        paths: targetedPaths,
        timeoutMs: 2_000
      });

      if (probe.foundAny) {
        const loaded = await loadLimitlessLiveMarkets({
          repoRoot,
          fetchRemote: true,
          paths: targetedPaths,
          requestTimeoutMs: 2_000
        });
        targetedFallbackRows = loaded.markets.filter((market) =>
          matchesPoliticsCurrentTarget({
            title: market.title,
            rulesText: market.description,
            categoryHints: market.categories,
            tags: market.tags
          })
        );
        if (targetedFallbackRows.length > 0) {
          targetedDiscoveryPathUsed = "limitless_public_current_surface_politics_targeted";
          fallbackDiscoveryPathUsed = "limitless_public_current_surface_politics_targeted";
        }
        if (!loaded.summary.fetchedFromLiveSurface) {
          targetedFallbackWarnings = ["Targeted HTML discovery fell back to local snapshot evidence."];
        }
      } else {
        targetedFallbackWarnings = probe.warnings;
      }
    } catch (error) {
      targetedFallbackWarnings = [error instanceof Error ? error.message : String(error)];
      primaryPathFailure = primary.warnings[0] ?? null;
    }
  }

  if (politicsRows.length === 0) {
    try {
      directOfficeWinnerRows = await fetchLimitlessOfficeWinnerDirectPageRows();
      if (directOfficeWinnerRows.length > 0 && targetedDiscoveryPathUsed === null) {
        targetedDiscoveryPathUsed = "limitless_direct_market_page_office_winner_targeted";
        fallbackDiscoveryPathUsed = "limitless_direct_market_page_office_winner_targeted";
      }
      directOfficeExitRows = await fetchLimitlessOfficeExitDirectPageRows();
      if (directOfficeExitRows.length > 0 && targetedDiscoveryPathUsed === null) {
        targetedDiscoveryPathUsed = "limitless_direct_market_page_office_exit_targeted";
        fallbackDiscoveryPathUsed = "limitless_direct_market_page_office_exit_targeted";
      }
    } catch (error) {
      targetedFallbackWarnings = uniqueStrings([
        ...targetedFallbackWarnings,
        error instanceof Error ? error.message : String(error)
      ]);
    }
  }

  const mergedMarkets = new Map<string, LimitlessLiveMarket>();
  for (const row of [...politicsRows, ...targetedFallbackRows]) {
    mergedMarkets.set(row.venueMarketId, row);
  }
  const mergedRows = [...mergedMarkets.values()];

  const rows = [
    ...mergedRows.map((market) => ({
    venue: "LIMITLESS" as const,
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
    sourceUrl: market.slug ? `https://limitless.exchange/markets/${market.slug}` : (market.sourceRef.startsWith("http") ? market.sourceRef : null),
    rawPayload: market.raw,
    fetchTimestamp: market.fetchedAt.toISOString(),
    discoveryPath: targetedFallbackRows.some((row) => row.venueMarketId === market.venueMarketId)
      ? "limitless_public_current_surface_politics_targeted"
      : primary.primaryDiscoveryPath
    })),
    ...directOfficeWinnerRows,
    ...directOfficeExitRows
  ];

  const warnings = uniqueStrings([
    ...primary.warnings,
    ...targetedFallbackWarnings
  ]);
  const status =
    primary.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED"
    : rows.length > 0 ? "SUCCESS"
    : primary.status === "UNAVAILABLE" && targetedFallbackWarnings.length > 0 ? "UNAVAILABLE"
    : "EMPTY";

  return {
    venue: "LIMITLESS",
    status,
    rows,
    liveMarkets: mergedRows,
    discoveryPath: targetedDiscoveryPathUsed ?? primary.primaryDiscoveryPath,
    warnings,
    primaryDiscoveryPath: primary.primaryDiscoveryPath,
    fallbackDiscoveryPathUsed,
    primaryPathFailure,
    broadDiscoveryRowCount: politicsRows.length,
    targetedDiscoveryRowCount: targetedFallbackRows.length + directOfficeWinnerRows.length + directOfficeExitRows.length,
    targetedDiscoveryPathUsed,
    targetedQueryLabels: [...NOMINEE_2028_TARGET_QUERY_LABELS, ...OFFICE_WINNER_TARGET_QUERY_LABELS, ...OFFICE_EXIT_TARGET_QUERY_LABELS]
  };
};

const writeGroundedPoliticsArtifacts = (repoRoot: string, artifacts: Awaited<ReturnType<typeof buildPoliticsInventoryGroundedArtifacts>>): void => {
  writeArtifact(repoRoot, "docs/politics-inventory-census-summary.json", artifacts.inventoryCensusSummary);
  writeArtifact(repoRoot, "docs/politics-inventory-by-venue.json", artifacts.inventoryByVenue);
  writeArtifact(repoRoot, "docs/politics-row-shape-samples.json", artifacts.rowShapeSamples);
  writeArtifact(repoRoot, "docs/politics-extraction-failure-summary.json", artifacts.extractionFailureSummary);
  writeArtifact(repoRoot, "docs/politics-derived-family-taxonomy.json", artifacts.familyTaxonomy);
  writeArtifact(repoRoot, "docs/politics-family-proof-summary.json", artifacts.familyProofSummary);
  writeArtifact(repoRoot, "docs/politics-family-example-rows.json", artifacts.familyExampleRows);
  writeArtifact(repoRoot, "docs/politics-family-eligibility-summary.json", artifacts.familyEligibilitySummary);
  writeArtifact(repoRoot, "docs/politics-structural-fingerprint-summary.json", artifacts.structuralFingerprintSummary);
  writeArtifact(repoRoot, "docs/politics-structural-fingerprint-samples.json", artifacts.structuralFingerprintSamples);
  writeArtifact(repoRoot, "docs/politics-family-critical-fields.json", artifacts.familyCriticalFields);
  writeArtifact(repoRoot, "docs/politics-candidate-prefilter-summary.json", artifacts.candidatePrefilterSummary);
  writeArtifact(repoRoot, "docs/politics-prefilter-rejection-breakdown.json", artifacts.prefilterRejectionBreakdown);
  writeArtifact(repoRoot, "docs/politics-prefilter-by-family.json", artifacts.prefilterByFamily);
  writeArtifact(repoRoot, "docs/politics-match-quality-summary.json", artifacts.matchQualitySummary);
  writeArtifact(repoRoot, "docs/politics-family-edge-summary.json", artifacts.familyEdgeSummary);
  writeArtifact(repoRoot, "docs/politics-approved-exact-safe-edges.json", artifacts.approvedExactSafeEdges);
  writeArtifact(repoRoot, "docs/politics-pair-routeability-summary.json", artifacts.pairRouteabilitySummary);
  writeArtifact(repoRoot, "docs/politics-pair-sync-summary.json", artifacts.pairSyncSummary);
  writeArtifact(repoRoot, "docs/politics-tri-routeability-summary.json", artifacts.triRouteabilitySummary);
  writeArtifact(repoRoot, "docs/politics-review-queue-summary.json", artifacts.reviewQueueSummary);
  writeArtifact(repoRoot, "docs/politics-final-decision.json", artifacts.finalDecision);
  writeArtifact(repoRoot, "docs/politics-frontier-comparison-summary.json", artifacts.frontierComparisonSummary);
  writeArtifact(repoRoot, "docs/politics-vs-sports-summary.json", artifacts.vsSportsSummary);
  writeArtifact(repoRoot, "docs/politics-vs-crypto-summary.json", artifacts.vsCryptoSummary);
  writeMarkdownArtifact(repoRoot, "docs/politics-operator-summary.md", `${artifacts.operatorSummary}\n`);
};

const writeNomineeArtifacts = (repoRoot: string, artifacts: Awaited<ReturnType<typeof buildPoliticsNomineeLivePassArtifactsFromRepository>>): void => {
  writeArtifact(repoRoot, "docs/politics-nominee-live-inventory-summary.json", artifacts.liveInventorySummary);
  writeArtifact(repoRoot, "docs/politics-nominee-live-inventory-by-venue.json", artifacts.liveInventoryByVenue);
  writeArtifact(repoRoot, "docs/politics-nominee-live-fetch-status.json", artifacts.liveFetchStatus);
  writeArtifact(repoRoot, "docs/politics-nominee-live-row-samples.json", artifacts.liveRowSamples);
  writeArtifact(repoRoot, "docs/politics-nominee-admission-summary.json", artifacts.admissionSummary);
  writeArtifact(repoRoot, "docs/politics-nominee-admission-rejections.json", artifacts.admissionRejections);
  writeArtifact(repoRoot, "docs/politics-nominee-admitted-rows.json", artifacts.admittedRows);
  writeArtifact(repoRoot, "docs/politics-nominee-basis-schema-summary.json", artifacts.basisSchemaSummary);
  writeArtifact(repoRoot, "docs/politics-nominee-basis-normalization-summary.json", artifacts.basisNormalizationSummary);
  writeArtifact(repoRoot, "docs/politics-nominee-basis-samples.json", artifacts.basisSamples);
  writeArtifact(repoRoot, "docs/politics-nominee-basis-fragmentation-summary.json", artifacts.basisFragmentationSummary);
  writeArtifact(repoRoot, "docs/politics-nominee-fragmentation-by-venue-pair.json", artifacts.fragmentationByVenuePair);
  writeArtifact(repoRoot, "docs/politics-nominee-comparable-clusters.json", artifacts.comparableClusters);
  writeArtifact(repoRoot, "docs/politics-nominee-eligibility-decision.json", artifacts.eligibilityDecision);
  writeArtifact(repoRoot, "docs/politics-nominee-eligibility-rationale.json", artifacts.eligibilityRationale);
  writeArtifact(repoRoot, "docs/politics-nominee-narrow-splits.json", artifacts.narrowSplits);
  writeArtifact(repoRoot, "docs/politics-nominee-prematch-readiness-summary.json", artifacts.prematchReadinessSummary);
  writeArtifact(repoRoot, "docs/politics-nominee-candidate-pair-inputs.json", artifacts.candidatePairInputs);
  writeArtifact(repoRoot, "docs/politics-nominee-exact-safe-subgroup-summary.json", artifacts.exactSafeSubgroupSummary);
  writeArtifact(repoRoot, "docs/politics-nominee-delta-vs-census.json", artifacts.deltaVsCensus);
  writeArtifact(repoRoot, "docs/politics-nominee-live-improvement-summary.json", artifacts.liveImprovementSummary);
  writeArtifact(repoRoot, "docs/politics-nominee-final-decision.json", artifacts.finalDecision);
  writeMarkdownArtifact(repoRoot, "docs/politics-nominee-operator-summary.md", `${artifacts.operatorSummary}\n`);
};

const buildGenericHistoricalState = (input: {
  seed: CuratedCanonicalGraphSeed;
  venue: FreshPoliticsFetchRow["venue"];
  venueMarketId: string;
  timestamp: Date;
  volume?: string | null;
  openInterest?: string | null;
  orderbookSnapshot: Record<string, unknown>;
  marketEvents: Record<string, unknown>;
  metadataVersion: string;
}): CreateHistoricalMarketStateInput => ({
  canonicalEventId: input.seed.canonicalEventId,
  canonicalMarketId: input.seed.canonicalMarketId,
  canonicalCategory: toHistoricalCategory(String(input.seed.canonicalCategory)),
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: input.timestamp,
  volume: input.volume ?? null,
  openInterest: input.openInterest ?? null,
  orderbookSnapshot: input.orderbookSnapshot,
  marketEvents: input.marketEvents,
  metadataVersion: input.metadataVersion,
  sourceTimestamp: input.timestamp
});

const deleteExistingRows = async (pool: Pool, venue: FreshPoliticsFetchRow["venue"], metadataVersion: string, marketIds: readonly string[]): Promise<void> => {
  if (marketIds.length === 0) {
    return;
  }
  await pool.query(
    `DELETE FROM historical_market_states
      WHERE venue = $1
        AND metadata_version = $2
        AND venue_market_id = ANY($3::text[])`,
    [venue, metadataVersion, marketIds]
  );
};

const persistOpinionPoliticsRows = async (input: {
  pool: Pool;
  rows: readonly OpinionNormalizedMarket[];
  fetchedAt: Date;
}): Promise<void> => {
  if (input.rows.length === 0) {
    return;
  }
  const adapter = new OpinionMarketAdapter({
    client: { listMarkets: async () => [] },
    metadataVersion: OPINION_METADATA_VERSION
  });
  const seeds = input.rows.map((market) => adapter.buildCanonicalSeed({ ...market, sourceMetadataVersion: OPINION_METADATA_VERSION }));
  const states = input.rows.map((market, index) =>
    buildGenericHistoricalState({
      seed: seeds[index]!,
      venue: "OPINION",
      venueMarketId: market.venueMarketId,
      timestamp: input.fetchedAt,
      volume: market.volume,
      orderbookSnapshot: {
        source: "opinion_current_politics_refresh",
        title: market.title,
        labels: market.labels,
        status: market.status
      },
      marketEvents: {
        source: "opinion_current_politics_refresh",
        status: market.status,
        statusCode: market.statusCode
      },
      metadataVersion: OPINION_METADATA_VERSION
    })
  );
  await deleteExistingRows(input.pool, "OPINION", OPINION_METADATA_VERSION, input.rows.map((market) => market.venueMarketId));
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool as PgPool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool as PgPool),
      new CompatibilityVersionRepository(input.pool as PgPool)
    )
  );
  await projector.persistAndProject(new CuratedCanonicalGraphSnapshotBuilder().build(seeds));
  await new HistoricalMarketStateRepository(input.pool as PgPool).insertManyIgnoreDuplicates(states);
};

const persistPredictPoliticsRows = async (input: {
  pool: Pool;
  rows: readonly PredictNormalizedMarket[];
  orderbooks: ReadonlyMap<string, PredictNormalizedOrderbookSnapshot | null>;
  fetchedAt: Date;
}): Promise<void> => {
  if (input.rows.length === 0) {
    return;
  }
  const adapter = new PredictMarketAdapter({
    client: {} as unknown as Pick<PredictClient, "getMarkets" | "getMarketById" | "getMarketStatistics" | "getMarketLastSale">,
    environment: "mainnet",
    metadataVersion: PREDICT_METADATA_VERSION
  });
  const seeds = input.rows.map((market) => adapter.buildCanonicalSeed({ market: { ...market, sourceMetadataVersion: PREDICT_METADATA_VERSION } }));
  const states = input.rows.map((market, index) =>
    buildGenericHistoricalState({
      seed: seeds[index]!,
      venue: "PREDICT",
      venueMarketId: market.venueMarketId,
      timestamp: input.fetchedAt,
      volume: market.statistics?.volume ?? null,
      openInterest: market.statistics?.openInterest ?? null,
      orderbookSnapshot: input.orderbooks.get(market.venueMarketId)
        ? {
            source: "predict_current_politics_refresh",
            orderbook: input.orderbooks.get(market.venueMarketId)!.raw
          }
        : {
            source: "predict_current_politics_refresh",
            orderbookUnavailable: true
          },
      marketEvents: {
        source: "predict_current_politics_refresh",
        status: market.status
      },
      metadataVersion: PREDICT_METADATA_VERSION
    })
  );
  await deleteExistingRows(input.pool, "PREDICT", PREDICT_METADATA_VERSION, input.rows.map((market) => market.venueMarketId));
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool as PgPool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool as PgPool),
      new CompatibilityVersionRepository(input.pool as PgPool)
    )
  );
  await projector.persistAndProject(new CuratedCanonicalGraphSnapshotBuilder().build(seeds));
  const bootstrapRepository = new PredictBootstrapRepository(input.pool as PgPool);
  await bootstrapRepository.upsertMarketMetadata(
    input.rows.map((market) => ({ ...market, sourceMetadataVersion: PREDICT_METADATA_VERSION }))
  );
  await bootstrapRepository.insertOrderbookSnapshots(
    [...input.orderbooks.values()]
      .filter((snapshot): snapshot is PredictNormalizedOrderbookSnapshot => snapshot !== null)
      .map((snapshot) => PredictBootstrapRepository.toPersistedOrderbookSnapshot(snapshot))
  );
  await new HistoricalMarketStateRepository(input.pool as PgPool).insertManyIgnoreDuplicates(states);
};

const persistLimitlessPoliticsRows = async (input: {
  pool: Pool;
  rows: readonly LimitlessLiveMarket[];
}): Promise<void> => {
  if (input.rows.length === 0) {
    return;
  }
  const seeds: CuratedCanonicalGraphSeed[] = input.rows.map((market) => ({
    canonicalEventId: buildStableUuid(`limitless-current-politics:${market.venueMarketId}`),
    canonicalMarketId: `limitless-current-politics-${market.venueMarketId}`,
    canonicalCategory: market.canonicalCategory,
    venue: "LIMITLESS",
    venueMarketId: market.venueMarketId,
    title: market.title,
    description: market.description,
    marketType: market.marketType ?? "BINARY",
    marketClass: "BINARY",
    outcomes: [
      { id: "YES", label: "Yes", metadata: { venue: "LIMITLESS" } },
      { id: "NO", label: "No", metadata: { venue: "LIMITLESS" } }
    ],
    outcomeSchema: { marketShape: "binary", yesLabel: "Yes", noLabel: "No" },
    topics: [...market.categories, ...market.tags],
    publishedAt: market.createdAt,
    expiresAt: market.expiresAt,
    resolvesAt: market.expiresAt,
    resolutionSource: "limitless_current_politics_refresh",
    resolutionTitle: market.title,
    resolutionRulesText: market.description,
    resolutionAuthorityType: "CENTRAL",
    settlementType: "unknown",
    rawSourcePayload: market.raw,
    normalizedPayload: {
      sourceRef: market.sourceRef,
      refreshPass: "politics-current-state-refresh"
    },
    mappingLineage: ["politics-current-state-refresh", "limitless-live-market-loader"],
    sourceMetadataVersion: LIMITLESS_METADATA_VERSION,
    propositionHints: {
      normalizedPropositionText: `${market.title} ${market.description ?? ""}`.trim()
    },
    executableDisplayName: market.title,
    executableMetadata: {
      refreshPass: "politics-current-state-refresh",
      freshCurrentState: true
    }
  }));
  const states = input.rows.map((market, index) =>
    buildGenericHistoricalState({
      seed: seeds[index]!,
      venue: "LIMITLESS",
      venueMarketId: market.venueMarketId,
      timestamp: market.fetchedAt,
      volume: market.volume,
      openInterest: market.openInterest,
      orderbookSnapshot: {
        source: "limitless_current_politics_refresh",
        title: market.title,
        slug: market.slug,
        sourceRef: market.sourceRef
      },
      marketEvents: {
        source: "limitless_current_politics_refresh",
        status: market.status,
        updatedAt: market.updatedAt?.toISOString() ?? null
      },
      metadataVersion: LIMITLESS_METADATA_VERSION
    })
  );
  await deleteExistingRows(input.pool, "LIMITLESS", LIMITLESS_METADATA_VERSION, input.rows.map((market) => market.venueMarketId));
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool as PgPool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool as PgPool),
      new CompatibilityVersionRepository(input.pool as PgPool)
    )
  );
  await projector.persistAndProject(new CuratedCanonicalGraphSnapshotBuilder().build(seeds));
  await new HistoricalMarketStateRepository(input.pool as PgPool).insertManyIgnoreDuplicates(states);
};

const persistPolymarketPoliticsRows = async (input: {
  pool: Pool;
  rows: readonly FreshPoliticsFetchRow[];
}): Promise<void> => {
  if (input.rows.length === 0) {
    return;
  }
  const seeds = input.rows.map(buildPolymarketSeed);
  const states = input.rows.map((row, index) =>
    buildGenericHistoricalState({
      seed: seeds[index]!,
      venue: "POLYMARKET",
      venueMarketId: row.venueMarketId,
      timestamp: new Date(row.fetchTimestamp),
      orderbookSnapshot: {
        source: "predexon_polymarket_current_politics_refresh",
        title: row.title,
        sourceUrl: row.sourceUrl
      },
      marketEvents: {
        source: "predexon_polymarket_current_politics_refresh",
        active: row.active
      },
      metadataVersion: POLYMARKET_METADATA_VERSION
    })
  );
  await deleteExistingRows(input.pool, "POLYMARKET", POLYMARKET_METADATA_VERSION, input.rows.map((row) => row.venueMarketId));
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool as PgPool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool as PgPool),
      new CompatibilityVersionRepository(input.pool as PgPool)
    )
  );
  await projector.persistAndProject(new CuratedCanonicalGraphSnapshotBuilder().build(seeds));
  await new HistoricalMarketStateRepository(input.pool as PgPool).insertManyIgnoreDuplicates(states);
};

const countPoliticsInventoryByVenue = async (pool: Pool): Promise<Record<string, number>> => {
  const repository = new PairEdgeRepository(pool as PgPool);
  const markets = await repository.listMatchingMarkets();
  return markets
    .filter((market) => market.category === "POLITICS")
    .reduce<Record<string, number>>((accumulator, market) => {
      recordIncrement(accumulator, market.venue);
      return accumulator;
    }, {});
};

export const listRefreshedPoliticsMarkets = async (pool: Pool): Promise<readonly ReturnType<typeof extractPoliticsInventoryRow>[]> => {
  const repository = new PairEdgeRepository(pool as PgPool);
  const markets = await repository.listMatchingMarkets();
  return markets
    .filter((market) => CURRENT_REFRESH_METADATA_VERSIONS.includes(market.sourceMetadataVersion as (typeof CURRENT_REFRESH_METADATA_VERSIONS)[number]))
    .filter((market) => market.category === "POLITICS")
    .map((market) => extractPoliticsInventoryRow(market));
};

export const buildPoliticsCurrentAdmissionArtifacts = (rows: readonly FreshPoliticsFetchRow[]) => {
  const labels: Record<string, number> = {};
  const admittedRows: FreshPoliticsFetchRow[] = [];
  const rejectedRows: Array<{ venue: string; venueMarketId: string; title: string; label: PoliticsCurrentAdmissionLabel }> = [];

  for (const row of rows) {
    const label = classifyPoliticsCurrentAdmission(row);
    recordIncrement(labels, label);
    if (label === "POLITICS_ADMITTED") {
      admittedRows.push(row);
    } else {
      rejectedRows.push({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        label
      });
    }
  }

  return {
    summary: {
      observedAt: new Date().toISOString(),
      labels,
      admittedCount: admittedRows.length
    },
    admittedRows,
    rejections: rejectedRows
  };
};

export const buildPoliticsCurrentStorageRefreshSummary = (input: {
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  admittedRows: readonly FreshPoliticsFetchRow[];
  rejectedCount: number;
  refreshedRows: readonly PoliticsCurrentInterpretationRow[];
}) => {
  const admittedByVenue = input.admittedRows.reduce<Record<string, number>>((accumulator, row) => {
    recordIncrement(accumulator, row.venue);
    return accumulator;
  }, {});
  const refreshedByVenue = input.refreshedRows.reduce<Record<string, number>>((accumulator, row) => {
    recordIncrement(accumulator, row.venue);
    return accumulator;
  }, {});

  const venueDelta = Object.fromEntries(
    [...new Set([...Object.keys(input.beforeCounts), ...Object.keys(input.afterCounts), ...Object.keys(admittedByVenue)])]
      .sort((left, right) => left.localeCompare(right))
      .map((venue) => {
        const before = input.beforeCounts[venue] ?? 0;
        const after = input.afterCounts[venue] ?? 0;
        const admitted = admittedByVenue[venue] ?? 0;
        const refreshed = refreshedByVenue[venue] ?? 0;
        return [venue, {
          before,
          after,
          inserted: Math.max(after - before, 0),
          updated: Math.min(before, refreshed),
          ignored: Math.max(admitted - refreshed, 0),
          rejected: 0
        }];
      })
  );

  return {
    summary: {
      observedAt: new Date().toISOString(),
      totalPoliticsRowsBefore: Object.values(input.beforeCounts).reduce((sum, value) => sum + value, 0),
      totalPoliticsRowsAfter: Object.values(input.afterCounts).reduce((sum, value) => sum + value, 0),
      admittedRows: input.admittedRows.length,
      interpretedRows: input.refreshedRows.length,
      rejectedRows: input.rejectedCount
    },
    delta: venueDelta
  };
};

export const buildPoliticsCurrentStateFairnessSummary = (input: {
  fetchStatuses: Record<string, PoliticsCurrentFetchStatus>;
  refreshedRowsByVenue: Record<string, number>;
  nomineeAdmittedRows: number;
  nomineeComparableClusters: number;
  nomineeEligibility: string;
}) => {
  const reasoning: string[] = [];
  const stableVenues = Object.entries(input.fetchStatuses).filter(([, status]) => status === "SUCCESS" || status === "EMPTY" || status === "PARTIAL");
  const blockedVenues = Object.entries(input.fetchStatuses).filter(([, status]) => status === "UNAVAILABLE" || status === "NOT_CONFIGURED");
  const totalRefreshedRows = Object.values(input.refreshedRowsByVenue).reduce((sum, value) => sum + value, 0);

  let primaryDecision: PoliticsCurrentFairnessDecision;
  if (totalRefreshedRows === 0) {
    primaryDecision = "POLITICS_REFRESH_INSUFFICIENT";
    reasoning.push("Fresh current-state politics rows did not land in interpreted inventory.");
  } else if (blockedVenues.length >= 2) {
    primaryDecision = "POLITICS_VENUE_DISCOVERY_STILL_BLOCKED";
    reasoning.push("Multiple politics venues still remain discovery-blocked after the refresh pass.");
  } else if (input.nomineeComparableClusters > 0 && (input.nomineeEligibility === "MATCHING_ELIGIBLE" || input.nomineeEligibility === "ELIGIBLE_AFTER_SPLIT")) {
    primaryDecision = "POLITICS_NOW_READY_FOR_NOMINEE_MATCHER_EVAL";
    reasoning.push("Refreshed nominee supply now produces a comparable subgroup worth a later matcher evaluation.");
  } else if (stableVenues.length >= 2) {
    primaryDecision = blockedVenues.length > 0 ? "POLITICS_REFRESH_PARTIAL_BUT_USABLE" : "POLITICS_CURRENT_STATE_REFRESH_SUCCEEDED";
    reasoning.push("Politics is now being evaluated on materially refreshed venue-fed current inventory.");
  } else {
    primaryDecision = "POLITICS_STILL_BELOW_SPORTS_AND_CRYPTO";
    reasoning.push("Refresh landed too little stable multi-venue politics inventory to move politics above the existing frontiers.");
  }

  if (blockedVenues.length > 0) {
    reasoning.push(`Blocked or unconfigured venues: ${blockedVenues.map(([venue, status]) => `${venue}:${status}`).join(", ")}.`);
  }
  if (input.nomineeAdmittedRows <= 1) {
    reasoning.push("Nominee reevaluation still has at most one admitted row, so matcher follow-up is not justified.");
  }

  const matcherFollowUpJustified =
    input.nomineeComparableClusters > 0 && (input.nomineeEligibility === "MATCHING_ELIGIBLE" || input.nomineeEligibility === "ELIGIBLE_AFTER_SPLIT");

  return {
    fairnessSummary: {
      observedAt: new Date().toISOString(),
      primaryDecision,
      politicsNowJudgedFairly: totalRefreshedRows > 0 && stableVenues.length >= 2,
      reasoning
    },
    finalDecision: {
      observedAt: new Date().toISOString(),
      primaryDecision,
      nomineeEligibility: input.nomineeEligibility,
      matcherFollowUpJustified
    }
  };
};

export const loadPoliticsCurrentRefreshEnv = (): void => {
  for (const envPath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
};

export const runPoliticsCurrentStateRefresh = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsCurrentStateRefreshRunResult> => {
  const priorCensus = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, "docs/politics-inventory-census-summary.json");
    } catch {
      return null;
    }
  })();
  const priorFamilyProof = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, "docs/politics-family-proof-summary.json");
    } catch {
      return null;
    }
  })();
  const priorNomineeInventory = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, "docs/politics-nominee-live-inventory-summary.json");
    } catch {
      return null;
    }
  })();
  const priorNomineeAdmission = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, "docs/politics-nominee-admission-summary.json");
    } catch {
      return null;
    }
  })();
  const priorNomineeEligibility = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, "docs/politics-nominee-eligibility-decision.json");
    } catch {
      return null;
    }
  })();
  const beforeCounts = await countPoliticsInventoryByVenue(input.pool);

  const [opinionFetch, polymarketFetch, predictFetch, limitlessFetch] = await Promise.all([
    fetchOpinionPoliticsCurrentState(),
    fetchPolymarketPoliticsCurrentState(),
    fetchPredictPoliticsCurrentState(),
    fetchLimitlessPoliticsCurrentState(input.repoRoot)
  ]);

  const fetchArtifacts = buildPoliticsCurrentFetchArtifacts([opinionFetch, polymarketFetch, predictFetch, limitlessFetch]);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-fetch-summary.json`, fetchArtifacts.fetchSummary);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-fetch-by-venue.json`, fetchArtifacts.fetchByVenue);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-fetch-status.json`, fetchArtifacts.fetchStatus);
  if (opinionFetch.status === "UNAVAILABLE" || opinionFetch.fallbackDiscoveryPathUsed) {
    writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-opinion-fetch-failure-summary.json`, {
      observedAt: new Date().toISOString(),
      venue: "OPINION",
      status: opinionFetch.status,
      primaryDiscoveryPath: opinionFetch.primaryDiscoveryPath ?? opinionFetch.discoveryPath,
      fallbackDiscoveryPathUsed: opinionFetch.fallbackDiscoveryPathUsed ?? null,
      primaryPathFailure: opinionFetch.primaryPathFailure ?? null,
      warnings: opinionFetch.warnings
    });
  }
  if (limitlessFetch.fallbackDiscoveryPathUsed || limitlessFetch.status === "EMPTY") {
    writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-limitless-fetch-path-comparison.json`, {
      observedAt: new Date().toISOString(),
      venue: "LIMITLESS",
      status: limitlessFetch.status,
      primaryDiscoveryPath: limitlessFetch.primaryDiscoveryPath ?? limitlessFetch.discoveryPath,
      fallbackDiscoveryPathUsed: limitlessFetch.fallbackDiscoveryPathUsed ?? null,
      primaryPathFailure: limitlessFetch.primaryPathFailure ?? null,
      warnings: limitlessFetch.warnings,
      rows: limitlessFetch.rows.length
    });
  }

  const allFetchedRows = [...opinionFetch.rows, ...polymarketFetch.rows, ...predictFetch.rows, ...limitlessFetch.rows];
  const admissionArtifacts = buildPoliticsCurrentAdmissionArtifacts(allFetchedRows);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-admission-summary.json`, admissionArtifacts.summary);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-admitted-rows.json`, admissionArtifacts.admittedRows);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-admission-rejections.json`, admissionArtifacts.rejections);

  const admittedVenueEntries = (["OPINION", "POLYMARKET", "LIMITLESS", "PREDICT"] as const).map(
    (venue) => [venue, admissionArtifacts.admittedRows.filter((row) => row.venue === venue)] as const
  );
  const admittedByVenue = new Map<FreshPoliticsFetchRow["venue"], readonly FreshPoliticsFetchRow[]>(admittedVenueEntries);

  await persistOpinionPoliticsRows({
    pool: input.pool,
    rows: (admittedByVenue.get("OPINION") ?? []).map((row) => ({
      venue: "OPINION",
      venueMarketId: row.venueMarketId,
      title: row.title,
      slug: row.slug,
      status: "ACTIVATED",
      statusCode: 2,
      labels: row.categoryHints,
      rules: row.rulesText,
      yesLabel: row.outcomes[0]?.label ?? "Yes",
      noLabel: row.outcomes[1]?.label ?? "No",
      volume: null,
      volume24h: null,
      volume7d: null,
      quoteToken: null,
      chainId: null,
      questionId: null,
      createdAt: row.publishedAt,
      cutoffAt: row.expiresAt,
      resolvedAt: row.resolvesAt,
      sourceMetadataVersion: OPINION_METADATA_VERSION,
      raw: row.rawPayload
    })),
    fetchedAt: new Date()
  });
  await persistPolymarketPoliticsRows({
    pool: input.pool,
    rows: admittedByVenue.get("POLYMARKET") ?? []
  });
  await persistPredictPoliticsRows({
    pool: input.pool,
    rows: predictFetch.normalizedRows.filter((row) => (admittedByVenue.get("PREDICT") ?? []).some((admitted) => admitted.venueMarketId === row.venueMarketId)),
    orderbooks: predictFetch.orderbooks,
    fetchedAt: new Date()
  });
  await persistLimitlessPoliticsRows({
    pool: input.pool,
    rows: limitlessFetch.liveMarkets.filter((row) => (admittedByVenue.get("LIMITLESS") ?? []).some((admitted) => admitted.venueMarketId === row.venueMarketId))
  });

  const refreshedRows = await listRefreshedPoliticsMarkets(input.pool);
  const interpretedRows: PoliticsCurrentInterpretationRow[] = refreshedRows.map((row) => ({
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    familyCandidateSignals: uniqueStrings([row.family, ...row.partyTerms, ...row.candidateNames.slice(0, 3)]),
    jurisdiction: row.jurisdiction,
    office: row.office,
    cycleYear: row.cycleYear,
    candidateNames: row.candidateNames,
    outcomeStructureType: row.outcomeStructureType,
    activeCurrentStatus: true,
    interpretationConfidence: row.extractionConfidence,
    interpretationFailures: row.parseFailures,
    sourceMetadataVersion: row.venue === "OPINION" ? OPINION_METADATA_VERSION
      : row.venue === "PREDICT" ? PREDICT_METADATA_VERSION
      : row.venue === "LIMITLESS" ? LIMITLESS_METADATA_VERSION
      : POLYMARKET_METADATA_VERSION
  }));
  const interpretationSummary = {
    observedAt: new Date().toISOString(),
    interpretedRowsByVenue: interpretedRows.reduce<Record<string, number>>((accumulator, row) => {
      recordIncrement(accumulator, row.venue);
      return accumulator;
    }, {}),
    familySignalsByVenue: interpretedRows.reduce<Record<string, Record<string, number>>>((accumulator, row) => {
      accumulator[row.venue] ??= {};
      for (const signal of row.familyCandidateSignals) {
        recordIncrement(accumulator[row.venue]!, signal);
      }
      return accumulator;
    }, {})
  };
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-interpretation-summary.json`, interpretationSummary);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-interpreted-rows.json`, interpretedRows);

  const afterCounts = await countPoliticsInventoryByVenue(input.pool);
  const storageArtifacts = buildPoliticsCurrentStorageRefreshSummary({
    beforeCounts,
    afterCounts,
    admittedRows: admissionArtifacts.admittedRows,
    rejectedCount: admissionArtifacts.rejections.length,
    refreshedRows: interpretedRows
  });
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-storage-refresh-summary.json`, storageArtifacts.summary);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-storage-delta.json`, storageArtifacts.delta);

  const groundedArtifacts = await buildPoliticsInventoryGroundedArtifacts({
    pool: input.pool,
    repoRoot: input.repoRoot
  });
  writeGroundedPoliticsArtifacts(input.repoRoot, groundedArtifacts);

  const nomineeArtifacts = await buildPoliticsNomineeLivePassArtifactsFromRepository({
    repository: new PairEdgeRepository(input.pool as PgPool),
    repoRoot: input.repoRoot
  });
  writeNomineeArtifacts(input.repoRoot, nomineeArtifacts);

  const deltaVsPriorCensus = {
    observedAt: new Date().toISOString(),
    priorRowsByVenue: priorCensus?.["totalPoliticsRowsByVenue"] ?? {},
    currentRowsByVenue: groundedArtifacts.inventoryCensusSummary.totalPoliticsRowsByVenue,
    priorIdentifiableRows: priorCensus?.["identifiableOfficeJurisdictionCycleRows"] ?? 0,
    currentIdentifiableRows: groundedArtifacts.inventoryCensusSummary.identifiableOfficeJurisdictionCycleRows,
    priorMatchingEligibleFamilies: priorFamilyProof?.["matchingEligibleFamilyCount"] ?? 0,
    currentMatchingEligibleFamilies: groundedArtifacts.familyProofSummary.matchingEligibleFamilyCount
  };
  const deltaVsPriorNomineePass = {
    observedAt: new Date().toISOString(),
    priorLiveNomineeRowsByVenue: priorNomineeInventory?.["liveNomineeRowsByVenue"] ?? {},
    currentLiveNomineeRowsByVenue: nomineeArtifacts.liveInventorySummary.liveNomineeRowsByVenue,
    priorAdmittedNomineeRows: priorNomineeAdmission?.["admittedCount"] ?? 0,
    currentAdmittedNomineeRows: nomineeArtifacts.admissionSummary.admittedCount,
    priorEligibilityState: priorNomineeEligibility?.["state"] ?? "BASIS_FRAGMENTED",
    currentEligibilityState: nomineeArtifacts.eligibilityDecision.state,
    comparableClusters: nomineeArtifacts.comparableClusters.length
  };
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-refresh-delta-vs-prior-census.json`, deltaVsPriorCensus);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-refresh-delta-vs-prior-nominee-pass.json`, deltaVsPriorNomineePass);

  const fairness = buildPoliticsCurrentStateFairnessSummary({
    fetchStatuses: Object.fromEntries(
      [opinionFetch, polymarketFetch, predictFetch, limitlessFetch].map((result) => [result.venue, result.status])
    ) as Record<string, PoliticsCurrentFetchStatus>,
    refreshedRowsByVenue: interpretationSummary.interpretedRowsByVenue,
    nomineeAdmittedRows: nomineeArtifacts.admissionSummary.admittedCount,
    nomineeComparableClusters: nomineeArtifacts.comparableClusters.length,
    nomineeEligibility: nomineeArtifacts.eligibilityDecision.state
  });
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-state-fairness-summary.json`, fairness.fairnessSummary);
  writeArtifact(input.repoRoot, `${REFRESH_DIR}/politics-post-refresh-final-decision.json`, {
    ...fairness.finalDecision,
    opinionPathDecision:
      opinionFetch.status === "SUCCESS" ? "OPINION_PATH_CORRECTED_SUCCESS"
      : opinionFetch.status === "EMPTY" ? "OPINION_PATH_CORRECTED_BUT_EMPTY"
      : "OPINION_PATH_STILL_BLOCKED",
    limitlessPathDecision:
      limitlessFetch.primaryDiscoveryPath === "limitless_sdk_active_markets" && limitlessFetch.status === "SUCCESS" ? "LIMITLESS_PATH_CORRECTED_SUCCESS"
      : limitlessFetch.primaryDiscoveryPath === "limitless_sdk_active_markets" && limitlessFetch.status === "EMPTY" ? "LIMITLESS_PATH_CORRECTED_BUT_EMPTY"
      : "LIMITLESS_PATH_UNCHANGED",
    predictPathDecision: predictFetch.status === "EMPTY" ? "PREDICT_STILL_EMPTY" : predictFetch.status,
    polymarketHealthy: polymarketFetch.status === "SUCCESS",
    nomineeLaneDecision:
      nomineeArtifacts.eligibilityDecision.state === "MATCHING_ELIGIBLE"
        ? "POLITICS_NOMINEE_LANE_STILL_MATCHING_ELIGIBLE"
        : "POLITICS_STILL_SUPPLY_FRAGMENTED",
    nextActionDecision:
      fairness.finalDecision.matcherFollowUpJustified ? "NOMINEE_MATCHER_EVAL_STILL_NEXT" : "VENUE_PATH_AUDIT_STILL_REQUIRED"
  });

  const operatorSummary = [
    "# Politics Current-State Refresh",
    "",
    `- primary decision: \`${fairness.finalDecision.primaryDecision}\``,
    `- opinion path: \`${opinionFetch.primaryDiscoveryPath ?? opinionFetch.discoveryPath}\` -> \`${opinionFetch.status}\``,
    `- limitless path: \`${limitlessFetch.primaryDiscoveryPath ?? limitlessFetch.discoveryPath}\` -> \`${limitlessFetch.status}\``,
    `- refreshed politics rows by venue: ${JSON.stringify(interpretationSummary.interpretedRowsByVenue)}`,
    `- fetch statuses: ${JSON.stringify(fetchArtifacts.fetchStatus)}`,
    `- nominee admitted rows after refresh: ${nomineeArtifacts.admissionSummary.admittedCount}`,
    `- nominee comparable clusters after refresh: ${nomineeArtifacts.comparableClusters.length}`,
    `- matcher follow-up justified: ${fairness.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`
  ].join("\n");
  writeMarkdownArtifact(input.repoRoot, `${REFRESH_DIR}/politics-current-state-operator-summary.md`, `${operatorSummary}\n`);

  return {
    fetchSummary: fetchArtifacts.fetchSummary,
    fetchByVenue: fetchArtifacts.fetchByVenue,
    fetchStatus: fetchArtifacts.fetchStatus,
    admissionSummary: admissionArtifacts.summary,
    admittedRows: admissionArtifacts.admittedRows,
    admissionRejections: admissionArtifacts.rejections,
    interpretationSummary,
    interpretedRows,
    storageRefreshSummary: storageArtifacts.summary,
    storageDelta: storageArtifacts.delta,
    deltaVsPriorCensus,
    deltaVsPriorNomineePass,
    fairnessSummary: fairness.fairnessSummary,
    postRefreshFinalDecision: fairness.finalDecision,
    operatorSummary
  };
};
