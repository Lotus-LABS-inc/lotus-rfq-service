import { PredictClient } from "../integrations/predict/predict-client.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildSportsLaLigaWinnerFamilyArtifacts,
  type SportsLaLigaWinnerExtractedRow
} from "../matching/sports/sports-la-liga-winner-family-pass.js";

const ARTIFACT_DIR = "artifacts/sports/la-liga-winner-family-pass";
const TARGET_TOPIC_KEY = "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026" as const;
const LIMITLESS_URL = "https://limitless.exchange/markets/la-liga-winner-1765290337005?rv=7Q4JYY4UXP";
const OPINION_URL = "https://app.opinion.trade/market/la-liga-winner-2026";
const POLYMARKET_URL = "https://polymarket.com/event/la-liga-winner-114";
const PREDICT_SLUG_URL = "https://predict.fun/market/la-liga-winner";
const PREDICT_ANCHOR_MARKET_ID = "1571";

const CLUB_SLUG_MAP: Record<string, string> = {
  barcelona: "Barcelona",
  "real-madrid": "Real Madrid",
  "atletico-madrid": "Atletico Madrid",
  "athletic-bilbao": "Athletic Bilbao",
  "athletic-club": "Athletic Bilbao",
  villarreal: "Villarreal",
  girona: "Girona",
  betis: "Real Betis",
  "real-betis": "Real Betis",
  "real-sociedad": "Real Sociedad",
  sevilla: "Sevilla",
  valencia: "Valencia"
};

const uniqueRows = (rows: readonly SportsLaLigaWinnerExtractedRow[]): readonly SportsLaLigaWinnerExtractedRow[] => {
  const byVenueAndId = new Map<string, SportsLaLigaWinnerExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const canonicalRulesForClub = (clubLabel: string): string =>
  clubLabel === "Other"
    ? "This market resolves to Yes if none of the listed clubs win the 2025–26 La Liga, or if the season is canceled or not completed by October 1, 2026. Otherwise it resolves to No."
    : `This market resolves to Yes if ${clubLabel} officially win the 2025–26 La Liga. Otherwise it resolves to No. If the season is canceled or not completed by October 1, 2026, the market resolves to Other.`;

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

const parseOpinionRows = (html: string): readonly SportsLaLigaWinnerExtractedRow[] => {
  const title = extractTitle(html);
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() ?? null;
  if (!title || !description || !/la liga winner/i.test(title)) {
    return [];
  }

  return description
    .split("|")
    .map((segment) => segment.split(":")[0]?.trim() ?? "")
    .filter((clubLabel) => clubLabel.length > 0)
    .map((clubLabel) => ({
      interpretedContractId: `opinion-la-liga-${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "OPINION" as const,
      venueMarketId: `la-liga-winner-2026:${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: OPINION_URL,
      title,
      rulesText: canonicalRulesForClub(clubLabel),
      clubLabel
    }));
};

const parseLimitlessRows = (html: string): readonly SportsLaLigaWinnerExtractedRow[] => {
  const matches = [
    ...html.matchAll(/\\"title\\":\\"([^\\"]+)\\",\\"proxyTitle\\":null/g),
    ...html.matchAll(/"title":"([^"]+)","proxyTitle":null/g)
  ]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const clubs = [...new Set(matches)]
    .filter((title) => title !== "💠 La Liga Winner")
    .filter((title) => title === "Other" || /^[A-Z][A-Za-z.\- ]+$/.test(title));

  return clubs.map((clubLabel) => ({
    interpretedContractId: `limitless-la-liga-${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "LIMITLESS" as const,
    venueMarketId: `la-liga-winner-1765290337005:${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: LIMITLESS_URL,
    title: "La Liga Winner",
    rulesText: canonicalRulesForClub(clubLabel),
    clubLabel
  }));
};

const parsePolymarketRows = (html: string): readonly SportsLaLigaWinnerExtractedRow[] => {
  const slugMatches = [...html.matchAll(/will-([a-z0-9-]+)-win-the-202526-la-liga/gi)]
    .map((match) => match[1]?.toLowerCase() ?? "")
    .filter((value) => value.length > 0);
  const clubLabels = [...new Set(slugMatches)]
    .map((slug) => CLUB_SLUG_MAP[slug] ?? null)
    .filter((value): value is string => value !== null);

  return clubLabels.map((clubLabel) => ({
    interpretedContractId: `polymarket-la-liga-${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "POLYMARKET" as const,
    venueMarketId: `la-liga-winner-114:${clubLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: POLYMARKET_URL,
    title: "La Liga Winner",
    rulesText: canonicalRulesForClub(clubLabel),
    clubLabel
  }));
};

const parsePredictRows = async (): Promise<readonly SportsLaLigaWinnerExtractedRow[]> => {
  const apiKey = process.env.PREDICT_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const client = new PredictClient({ environment: "mainnet", apiKey });
  const anchor = await client.getMarketById(PREDICT_ANCHOR_MARKET_ID).catch(() => null);
  const categorySlug = anchor?.categorySlug ?? null;
  if (categorySlug !== "la-liga-winner") {
    return [];
  }

  const discoveredRows: SportsLaLigaWinnerExtractedRow[] = [];
  const startId = Number.parseInt(PREDICT_ANCHOR_MARKET_ID, 10) - 6;
  const endId = Number.parseInt(PREDICT_ANCHOR_MARKET_ID, 10) + 10;

  for (let id = startId; id <= endId; id += 1) {
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
      interpretedContractId: `predict-la-liga-${market.id}`,
      venue: "PREDICT",
      venueMarketId: String(market.id),
      sourceUrl: PREDICT_SLUG_URL,
      title: marketQuestion,
      rulesText: typeof market.description === "string" ? market.description : null,
      clubLabel: marketTitle
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
    "# Sports La Liga Winner Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface SportsLaLigaWinnerFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsLaLigaWinnerFamilyPass = async (input: {
  repoRoot: string;
}): Promise<SportsLaLigaWinnerFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-fetch-summary.json`);
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

  const artifacts = buildSportsLaLigaWinnerFamilyArtifacts(rows);
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

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-operator-summary.md`, `${operatorSummary}\n`);

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
