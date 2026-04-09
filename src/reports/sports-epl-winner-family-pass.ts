import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildSportsEplWinnerFamilyArtifacts,
  type SportsEplWinnerExtractedRow
} from "../matching/sports/sports-epl-winner-family-pass.js";

const ARTIFACT_DIR = "artifacts/sports/epl-winner-family-pass";
const TARGET_TOPIC_KEY = "SPORTS|LEAGUE_WINNER|EPL|2025_2026" as const;
const LIMITLESS_URL = "https://limitless.exchange/markets/english-premier-league-winner-1765295467473?rv=7Q4JYY4UXP";
const OPINION_URL = "https://app.opinion.trade/market/english-premier-league-winner-2026";
const POLYMARKET_URL = "https://polymarket.com/event/english-premier-league-winner";
const PREDICT_SLUG_URL = "https://predict.fun/market/english-premier-league-winner";
const PREDICT_ANCHOR_MARKET_ID = "1560";

const CLUB_SLUG_MAP: Record<string, string> = {
  arsenal: "Arsenal",
  "aston-villa": "Aston Villa",
  bournemouth: "Bournemouth",
  brentford: "Brentford",
  brighton: "Brighton",
  burnley: "Burnley",
  chelsea: "Chelsea",
  "crystal-palace": "Crystal Palace",
  everton: "Everton",
  fulham: "Fulham",
  leeds: "Leeds United",
  liverpool: "Liverpool",
  "man-city": "Manchester City",
  "manchester-city": "Manchester City",
  "man-united": "Manchester United",
  "manchester-united": "Manchester United",
  newcastle: "Newcastle United",
  "nottm-forest": "Nottingham Forest",
  sunderland: "Sunderland",
  tottenham: "Tottenham Hotspur",
  "west-ham": "West Ham United",
  wolves: "Wolverhampton Wanderers"
};

const uniqueRows = (rows: readonly SportsEplWinnerExtractedRow[]): readonly SportsEplWinnerExtractedRow[] => {
  const byVenueAndId = new Map<string, SportsEplWinnerExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const canonicalRulesForClub = (clubLabel: string): string =>
  clubLabel === "Other"
    ? "This market resolves to Yes if none of the listed clubs win the 2025–26 English Premier League, or if the season is canceled or not completed by October 1, 2026. Otherwise it resolves to No."
    : `This market resolves to Yes if ${clubLabel} officially win the 2025–26 English Premier League. Otherwise it resolves to No. If the season is canceled or not completed by October 1, 2026, the market resolves to Other.`;

const extractTitle = (html: string): string | null => {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() ?? null;
};

const fetchHtml = async (url: string, userAgent = false): Promise<string | null> => {
  try {
    const init: RequestInit = { signal: AbortSignal.timeout(15_000) };
    if (userAgent) {
      init.headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" };
    }
    const response = await fetch(url, init);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
};

const parseOpinionRows = (html: string): readonly SportsEplWinnerExtractedRow[] => {
  const title = extractTitle(html);
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() ?? null;
  if (!title || !description || !/premier league winner/i.test(title)) {
    return [];
  }

  return description
    .split("|")
    .map((segment) => segment.split(":")[0]?.trim() ?? "")
    .filter((clubLabel) => clubLabel.length > 0)
    .map((clubLabel) => ({
      interpretedContractId: `opinion-epl-${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "OPINION" as const,
      venueMarketId: `english-premier-league-winner-2026:${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: OPINION_URL,
      title,
      rulesText: canonicalRulesForClub(clubLabel),
      clubLabel
    }));
};

const parseLimitlessRows = (html: string): readonly SportsEplWinnerExtractedRow[] => {
  const matches = [
    ...html.matchAll(/\\"title\\":\\"([^\\"]+)\\",\\"proxyTitle\\":null/g),
    ...html.matchAll(/"title":"([^"]+)","proxyTitle":null/g)
  ]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const clubs = [...new Set(matches)]
    .filter((title) => title !== "💠 English Premier League Winner")
    .filter((title) => title === "Other" || /^[A-Z][A-Za-z.\- ]+$/.test(title));

  return clubs.map((clubLabel) => ({
    interpretedContractId: `limitless-epl-${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "LIMITLESS" as const,
    venueMarketId: `english-premier-league-winner-1765295467473:${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: LIMITLESS_URL,
    title: "English Premier League Winner",
    rulesText: canonicalRulesForClub(clubLabel),
    clubLabel
  }));
};

const parsePolymarketRows = (html: string): readonly SportsEplWinnerExtractedRow[] => {
  const slugMatches = [...html.matchAll(/will-([a-z0-9-]+)-win-the-202526-english-premier-league/gi)]
    .map((match) => match[1]?.toLowerCase() ?? "")
    .filter((value) => value.length > 0);
  const clubLabels = [...new Set(slugMatches)]
    .map((slug) => CLUB_SLUG_MAP[slug] ?? null)
    .filter((value): value is string => value !== null);

  return clubLabels.map((clubLabel) => ({
    interpretedContractId: `polymarket-epl-${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "POLYMARKET" as const,
    venueMarketId: `english-premier-league-winner:${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: POLYMARKET_URL,
    title: "English Premier League Winner",
    rulesText: canonicalRulesForClub(clubLabel),
    clubLabel
  }));
};

interface PredictMarketEnvelope {
  success: boolean;
  data?: {
    id: number;
    title: string;
    question: string;
    description: string;
    categorySlug: string;
    outcomes: readonly { name: string }[];
  };
}

const fetchPredictMarket = async (marketId: string, apiKey: string): Promise<PredictMarketEnvelope | null> => {
  try {
    const response = await fetch(`https://api.predict.fun/v1/markets/${encodeURIComponent(marketId)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "x-api-key": apiKey }
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as PredictMarketEnvelope;
  } catch {
    return null;
  }
};

const parsePredictRows = async (): Promise<readonly SportsEplWinnerExtractedRow[]> => {
  const apiKey = process.env.PREDICT_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const anchor = await fetchPredictMarket(PREDICT_ANCHOR_MARKET_ID, apiKey);
  const categorySlug = anchor?.success ? anchor.data?.categorySlug ?? null : null;
  if (categorySlug !== "english-premier-league-winner") {
    return [];
  }

  const discoveredRows: SportsEplWinnerExtractedRow[] = [];
  for (let id = 1555; id <= 1568; id += 1) {
    const envelope = await fetchPredictMarket(String(id), apiKey);
    if (!envelope?.success || !envelope.data || envelope.data.categorySlug !== categorySlug) {
      continue;
    }
    const outcomeNames = envelope.data.outcomes.map((outcome) => outcome.name.toLowerCase());
    if (outcomeNames.length !== 2 || !outcomeNames.includes("yes") || !outcomeNames.includes("no")) {
      continue;
    }
    discoveredRows.push({
      interpretedContractId: `predict-epl-${envelope.data.id}`,
      venue: "PREDICT",
      venueMarketId: String(envelope.data.id),
      sourceUrl: PREDICT_SLUG_URL,
      title: envelope.data.question,
      rulesText: envelope.data.description,
      clubLabel: envelope.data.title
    });
  }

  return discoveredRows;
};

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const buildOperatorSummary = (input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: readonly { canonicalTopicKey: string; venuesPresent: readonly string[]; notes: readonly string[] }[];
  finalDecision: { bestCandidateTopicKey: string | null; matcherFollowUpJustified: boolean; singleBestNextAction: string };
}) =>
  [
    "# Sports EPL Winner Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface SportsEplWinnerFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsEplWinnerFamilyPass = async (input: {
  repoRoot: string;
}): Promise<SportsEplWinnerFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-fetch-summary.json`);
    } catch {
      return null;
    }
  })();

  const [opinionHtml, polymarketHtml, limitlessHtml] = await Promise.all([
    fetchHtml(OPINION_URL),
    fetchHtml(POLYMARKET_URL, true),
    fetchHtml(LIMITLESS_URL)
  ]);

  const rows = uniqueRows([
    ...(opinionHtml ? parseOpinionRows(opinionHtml) : []),
    ...(polymarketHtml ? parsePolymarketRows(polymarketHtml) : []),
    ...(limitlessHtml ? parseLimitlessRows(limitlessHtml) : []),
    ...await parsePredictRows()
  ]);

  const artifacts = buildSportsEplWinnerFamilyArtifacts(rows);
  const priorAdmittedByVenue = toJsonCounts(priorFetchSummary?.["rowsAdmittedByVenue"]);
  const currentAdmittedByVenue = artifacts.fetchSummaryInput.rowsAdmittedByVenue;
  const fetchSummary = {
    observedAt: new Date().toISOString(),
    rowsFetchedByVenue: artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: currentAdmittedByVenue,
    familySupplyChangedMaterially: JSON.stringify(priorAdmittedByVenue) !== JSON.stringify(currentAdmittedByVenue),
    admittedTopicCandidates: artifacts.admissionSummary.rowsAdmittedByTopicCandidate
  };

  const admissionSummary = {
    observedAt: new Date().toISOString(),
    totalAdmittedLeagueWinnerRows: artifacts.admissionSummary.totalAdmittedLeagueWinnerRows,
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

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-epl-winner-operator-summary.md`, `${operatorSummary}\n`);

  return {
    fetchSummary,
    admissionSummary,
    normalizedTopics: artifacts.normalizedTopicRows,
    comparabilitySummary: artifacts.comparabilitySummary,
    basisFragmentationSummary,
    finalDecision,
    operatorSummary
  };
};
