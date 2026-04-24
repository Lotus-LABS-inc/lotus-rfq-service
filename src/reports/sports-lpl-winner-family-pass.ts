import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildSportsLplWinnerFamilyArtifacts,
  type SportsLplWinnerExtractedRow
} from "../matching/sports/sports-lpl-winner-family-pass.js";

const ARTIFACT_DIR = "artifacts/sports/lpl-winner-family-pass";
const LIMITLESS_URL = "https://limitless.exchange/markets/lol-lpl-2026-season-winner-1769165526999?rv=7Q4JYY4UXP";
const OPINION_URL = "https://app.opinion.trade/market/lol-lpl-2026-season-winner";
const POLYMARKET_URL = "https://polymarket.com/event/lol-lpl-2026-season-winner";

const TEAM_NAMES = [
  "Bilibili Gaming",
  "Anyone's Legend",
  "JD Gaming",
  "Top Esports",
  "Weibo Gaming",
  "Invictus Gaming",
  "LNG Esports",
  "Ninjas in Pyjamas"
] as const;

const uniqueRows = (rows: readonly SportsLplWinnerExtractedRow[]): readonly SportsLplWinnerExtractedRow[] => {
  const byVenueAndId = new Map<string, SportsLplWinnerExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const canonicalRulesForTeam = (teamLabel: string): string =>
  `This market resolves to Yes if ${teamLabel} win the 2026 LPL season. Otherwise it resolves to No.`;

const extractTitle = (html: string): string | null => {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() ?? null;
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

const parseOpinionRows = (html: string): readonly SportsLplWinnerExtractedRow[] => {
  const title = extractTitle(html);
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() ?? null;
  if (!title || !description || !/\blpl\b/i.test(title)) {
    return [];
  }

  return description
    .split("|")
    .map((segment) => segment.split(":")[0]?.replace(/&#x27;/g, "'").trim() ?? "")
    .filter((teamLabel) => TEAM_NAMES.includes(teamLabel as (typeof TEAM_NAMES)[number]))
    .map((teamLabel) => ({
      interpretedContractId: `opinion-lpl-winner-${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "OPINION" as const,
      venueMarketId: `lol-lpl-2026-season-winner:${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: OPINION_URL,
      title,
      rulesText: canonicalRulesForTeam(teamLabel),
      teamLabel
    }));
};

const parseLimitlessRows = (html: string): readonly SportsLplWinnerExtractedRow[] => {
  const matches = [
    ...html.matchAll(/\\"title\\":\\"([^\\"]+)\\",\\"proxyTitle\\":null/g),
    ...html.matchAll(/"title":"([^"]+)","proxyTitle":null/g)
  ]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const teams = [...new Set(matches)]
    .filter((teamLabel) => TEAM_NAMES.includes(teamLabel as (typeof TEAM_NAMES)[number]));

  return teams.map((teamLabel) => ({
    interpretedContractId: `limitless-lpl-winner-${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "LIMITLESS" as const,
    venueMarketId: `lol-lpl-2026-season-winner-1769165526999:${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: LIMITLESS_URL,
    title: "LoL: LPL 2026 Season Winner",
    rulesText: canonicalRulesForTeam(teamLabel),
    teamLabel
  }));
};

const parsePolymarketRows = (html: string): readonly SportsLplWinnerExtractedRow[] =>
  TEAM_NAMES
    .filter((teamLabel) => new RegExp(teamLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(html))
    .map((teamLabel) => ({
      interpretedContractId: `polymarket-lpl-winner-${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "POLYMARKET" as const,
      venueMarketId: `lol-lpl-2026-season-winner:${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: POLYMARKET_URL,
      title: "LPL 2026 Season Winner",
      rulesText: canonicalRulesForTeam(teamLabel),
      teamLabel
    }));

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const buildOperatorSummary = (input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: readonly { canonicalTopicKey: string; venuesPresent: readonly string[]; notes: readonly string[] }[];
  finalDecision: { bestCandidateTopicKey: string | null; matcherFollowUpJustified: boolean; singleBestNextAction: string };
}) =>
  [
    "# Sports LPL Winner Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface SportsLplWinnerFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsLplWinnerFamilyPass = async (input: {
  repoRoot: string;
}): Promise<SportsLplWinnerFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(
        input.repoRoot,
        `${ARTIFACT_DIR}/sports-lpl-winner-fetch-summary.json`
      );
    } catch {
      return null;
    }
  })();

  const [opinionHtml, polymarketHtml, limitlessHtml] = await Promise.all([
    fetchHtml(OPINION_URL),
    fetchHtml(POLYMARKET_URL),
    fetchHtml(LIMITLESS_URL)
  ]);

  const rows = uniqueRows([
    ...(opinionHtml ? parseOpinionRows(opinionHtml) : []),
    ...(polymarketHtml ? parsePolymarketRows(polymarketHtml) : []),
    ...(limitlessHtml ? parseLimitlessRows(limitlessHtml) : [])
  ]);

  const artifacts = buildSportsLplWinnerFamilyArtifacts(rows);

  const fetchSummary = {
    rowsFetchedByVenue: artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: artifacts.fetchSummaryInput.rowsAdmittedByVenue,
    priorRowsFetchedByVenue: toJsonCounts(priorFetchSummary?.["rowsFetchedByVenue"]),
    priorRowsAdmittedByVenue: toJsonCounts(priorFetchSummary?.["rowsAdmittedByVenue"])
  };
  const admissionSummary = artifacts.admissionSummary;
  const normalizedTopics = artifacts.normalizedTopicRows;
  const comparabilitySummary = artifacts.comparabilitySummary;
  const basisFragmentationSummary = artifacts.basisFragmentationSummary;
  const finalDecision = artifacts.finalDecision;
  const operatorSummary = buildOperatorSummary({
    fetchSummary,
    comparabilitySummary,
    finalDecision
  });

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-normalized-topics.json`, normalizedTopics);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-comparability-summary.json`, comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-operator-summary.md`, operatorSummary);

  return {
    fetchSummary,
    admissionSummary,
    normalizedTopics,
    comparabilitySummary,
    basisFragmentationSummary,
    finalDecision: finalDecision as unknown as Record<string, unknown>,
    operatorSummary
  };
};
