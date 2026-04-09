import { PredictClient } from "../integrations/predict/predict-client.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildSportsNbaChampionFamilyArtifacts,
  type SportsNbaChampionExtractedRow
} from "../matching/sports/sports-nba-champion-family-pass.js";

const ARTIFACT_DIR = "artifacts/sports/nba-champion-family-pass";
const LIMITLESS_URL = "https://limitless.exchange/markets/2026-nba-champion-1766486796462?rv=7Q4JYY4UXP";
const OPINION_URL = "https://app.opinion.trade/market/2026-nba-champion";
const POLYMARKET_URL = "https://polymarket.com/event/2026-nba-champion";
const PREDICT_SLUG_URL = "https://predict.fun/market/2026-nba-champion";
const PREDICT_ANCHOR_MARKET_ID = "1469";

const TEAM_SLUG_MAP: Record<string, string> = {
  "the-atlanta-hawks": "Atlanta Hawks",
  "the-boston-celtics": "Boston Celtics",
  "the-brooklyn-nets": "Brooklyn Nets",
  "the-charlotte-hornets": "Charlotte Hornets",
  "the-chicago-bulls": "Chicago Bulls",
  "the-cleveland-cavaliers": "Cleveland Cavaliers",
  "the-dallas-mavericks": "Dallas Mavericks",
  "the-denver-nuggets": "Denver Nuggets",
  "the-detroit-pistons": "Detroit Pistons",
  "the-golden-state-warriors": "Golden State Warriors",
  "the-houston-rockets": "Houston Rockets",
  "the-indiana-pacers": "Indiana Pacers",
  "the-los-angeles-clippers": "Los Angeles Clippers",
  "the-los-angeles-lakers": "Los Angeles Lakers",
  "the-memphis-grizzlies": "Memphis Grizzlies",
  "the-miami-heat": "Miami Heat",
  "the-milwaukee-bucks": "Milwaukee Bucks",
  "the-minnesota-timberwolves": "Minnesota Timberwolves",
  "the-new-orleans-pelicans": "New Orleans Pelicans",
  "the-new-york-knicks": "New York Knicks",
  "the-oklahoma-city-thunder": "Oklahoma City Thunder",
  "the-orlando-magic": "Orlando Magic",
  "the-philadelphia-76ers": "Philadelphia 76ers",
  "the-phoenix-suns": "Phoenix Suns",
  "the-portland-trail-blazers": "Portland Trail Blazers",
  "the-sacramento-kings": "Sacramento Kings",
  "the-san-antonio-spurs": "San Antonio Spurs",
  "the-toronto-raptors": "Toronto Raptors",
  "the-utah-jazz": "Utah Jazz",
  "the-washington-wizards": "Washington Wizards"
};

const uniqueRows = (
  rows: readonly SportsNbaChampionExtractedRow[]
): readonly SportsNbaChampionExtractedRow[] => {
  const byVenueAndId = new Map<string, SportsNbaChampionExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const canonicalRulesForTeam = (teamLabel: string): string =>
  teamLabel === "Other"
    ? "This market resolves to Yes if none of the listed teams win the 2026 NBA Finals, or if the NBA Finals are canceled or not completed by June 30, 2026. Otherwise it resolves to No."
    : `This market resolves to Yes if ${teamLabel} win the 2026 NBA Finals. Otherwise it resolves to No. If the NBA Finals are canceled or not completed by June 30, 2026, the market resolves to Other.`;

const extractTitle = (html: string): string | null => {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() ?? null;
};

const fetchHtml = async (url: string, userAgent = false): Promise<string | null> => {
  try {
    const init: RequestInit = { signal: AbortSignal.timeout(15_000) };
    if (userAgent) {
      init.headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
      };
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

const parseOpinionRows = (html: string): readonly SportsNbaChampionExtractedRow[] => {
  const title = extractTitle(html);
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() ?? null;
  if (!title || !description || !/nba champion/i.test(title)) {
    return [];
  }

  return description
    .split("|")
    .map((segment) => segment.split(":")[0]?.trim() ?? "")
    .filter((teamLabel) => teamLabel.length > 0)
    .map((teamLabel) => ({
      interpretedContractId: `opinion-nba-champion-${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "OPINION" as const,
      venueMarketId: `2026-nba-champion:${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: OPINION_URL,
      title,
      rulesText: canonicalRulesForTeam(teamLabel),
      teamLabel
    }));
};

const parseLimitlessRows = (html: string): readonly SportsNbaChampionExtractedRow[] => {
  const matches = [
    ...html.matchAll(/\\"title\\":\\"([^\\"]+)\\",\\"proxyTitle\\":null/g),
    ...html.matchAll(/"title":"([^"]+)","proxyTitle":null/g)
  ]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const teams = [...new Set(matches)]
    .filter((title) => title !== "2026 NBA Champion")
    .filter((title) => title === "Other" || /^[A-Z][A-Za-z0-9.\- ]+$/.test(title));

  return teams.map((teamLabel) => ({
    interpretedContractId: `limitless-nba-champion-${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "LIMITLESS" as const,
    venueMarketId: `2026-nba-champion-1766486796462:${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: LIMITLESS_URL,
    title: "2026 NBA Champion",
    rulesText: canonicalRulesForTeam(teamLabel.trim()),
    teamLabel: teamLabel.trim()
  }));
};

const parsePolymarketRows = (html: string): readonly SportsNbaChampionExtractedRow[] => {
  const slugMatches = [
    ...html.matchAll(/will-([a-z0-9-]+)-win-the-2026-nba-finals/gi),
    ...html.matchAll(/\/event\/[^"' ]*\/will-([a-z0-9-]+)-win-the-2026-nba-finals/gi)
  ]
    .map((match) => match[1]?.toLowerCase() ?? "")
    .filter((value) => value.length > 0);
  const teamLabels = [...new Set(slugMatches)]
    .map((slug) => TEAM_SLUG_MAP[slug] ?? null)
    .filter((value): value is string => value !== null);

  return teamLabels.map((teamLabel) => ({
    interpretedContractId: `polymarket-nba-champion-${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "POLYMARKET" as const,
    venueMarketId: `2026-nba-champion:${teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: POLYMARKET_URL,
    title: "2026 NBA Champion",
    rulesText: canonicalRulesForTeam(teamLabel),
    teamLabel
  }));
};

const parsePredictRows = async (): Promise<readonly SportsNbaChampionExtractedRow[]> => {
  const apiKey = process.env.PREDICT_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const client = new PredictClient({ environment: "mainnet", apiKey });
  const anchor = await client.getMarketById(PREDICT_ANCHOR_MARKET_ID).catch(() => null);
  const categorySlug = anchor?.categorySlug ?? null;
  if (categorySlug !== "2026-nba-champion") {
    return [];
  }

  const discoveredRows: SportsNbaChampionExtractedRow[] = [];
  const anchorId = Number.parseInt(PREDICT_ANCHOR_MARKET_ID, 10);
  for (let id = anchorId - 30; id <= anchorId + 40; id += 1) {
    const market = await client.getMarketById(String(id)).catch(() => null);
    if (!market || market.categorySlug !== categorySlug) {
      continue;
    }
    const outcomeNames = (market.outcomes ?? [])
      .map((outcome) => typeof outcome.name === "string" ? outcome.name.toLowerCase() : null)
      .filter((outcomeName): outcomeName is string => outcomeName !== null);
    if (outcomeNames.length !== 2 || !outcomeNames.includes("yes") || !outcomeNames.includes("no")) {
      continue;
    }
    const marketTitle = typeof market.title === "string" ? market.title : null;
    const marketQuestion = typeof market.question === "string" ? market.question : null;
    if (!marketTitle || !marketQuestion) {
      continue;
    }
    discoveredRows.push({
      interpretedContractId: `predict-nba-champion-${market.id}`,
      venue: "PREDICT",
      venueMarketId: String(market.id),
      sourceUrl: PREDICT_SLUG_URL,
      title: marketQuestion,
      rulesText: typeof market.description === "string" ? market.description : null,
      teamLabel: marketTitle
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
    "# Sports NBA Champion Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface SportsNbaChampionFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsNbaChampionFamilyPass = async (input: {
  repoRoot: string;
}): Promise<SportsNbaChampionFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(
        input.repoRoot,
        `${ARTIFACT_DIR}/sports-nba-champion-fetch-summary.json`
      );
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

  const artifacts = buildSportsNbaChampionFamilyArtifacts(rows);
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
    totalAdmittedTournamentWinnerRows: artifacts.admissionSummary.totalAdmittedTournamentWinnerRows,
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
    comparabilitySummary: artifacts.comparabilitySummary.map((topic) => ({
      canonicalTopicKey: topic.canonicalTopicKey,
      venuesPresent: topic.venuesPresent,
      notes: topic.notes
    })),
    finalDecision: artifacts.finalDecision
  });

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-nba-champion-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-nba-champion-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-nba-champion-normalized-topics.json`, {
    observedAt: new Date().toISOString(),
    rows: artifacts.normalizedTopicRows
  });
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-nba-champion-comparability-summary.json`, {
    observedAt: new Date().toISOString(),
    topics: artifacts.comparabilitySummary
  });
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-nba-champion-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-nba-champion-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-nba-champion-operator-summary.md`, operatorSummary);

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
