import { PredictClient } from "../integrations/predict/predict-client.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildSportsF1DriversChampionFamilyArtifacts,
  type SportsF1DriversChampionExtractedRow
} from "../matching/sports/sports-f1-drivers-champion-family-pass.js";

const ARTIFACT_DIR = "artifacts/sports/f1-drivers-champion-family-pass";
const LIMITLESS_URL = "https://limitless.exchange/markets/f1-drivers-champion-1769015228907?rv=7Q4JYY4UXP";
const OPINION_URL = "https://app.opinion.trade/market/f1-world-drivers-champion-2026";
const POLYMARKET_URL = "https://polymarket.com/event/2026-f1-drivers-champion";
const PREDICT_SLUG_URL = "https://predict.fun/market/2026-f1-drivers-champion";
const PREDICT_ANCHOR_MARKET_ID = "4835";

const DRIVER_SLUG_MAP: Record<string, string> = {
  "charles-leclerc": "Charles Leclerc",
  "fernando-alonso": "Fernando Alonso",
  "george-russell": "George Russell",
  "kimi-antonelli": "Kimi Antonelli",
  "lando-norris": "Lando Norris",
  "lewis-hamilton": "Lewis Hamilton",
  "max-verstappen": "Max Verstappen",
  "oscar-piastri": "Oscar Piastri"
};

const uniqueRows = (
  rows: readonly SportsF1DriversChampionExtractedRow[]
): readonly SportsF1DriversChampionExtractedRow[] => {
  const byVenueAndId = new Map<string, SportsF1DriversChampionExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const canonicalRulesForDriver = (driverLabel: string): string =>
  driverLabel === "Other"
    ? "This market resolves to Yes if any driver other than the listed drivers wins the 2026 F1 Drivers Championship, or if the season is permanently canceled or not completed by March 31, 2027. Otherwise it resolves to No."
    : `This market resolves to Yes if ${driverLabel} win the 2026 F1 Drivers Championship. Otherwise it resolves to No. If the season is permanently canceled or not completed by March 31, 2027, the market titled Other resolves to Yes.`;

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

const parseOpinionRows = (html: string): readonly SportsF1DriversChampionExtractedRow[] => {
  const title = extractTitle(html);
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() ?? null;
  if (!title || !description || !/f1 world drivers['’]?\s+champion|f1 drivers['’]?\s+championship|f1 world drivers['’]?\s+champion/i.test(title)) {
    return [];
  }

  return description
    .split("|")
    .map((segment) => segment.split(":")[0]?.trim() ?? "")
    .filter((driverLabel) => driverLabel.length > 0)
    .map((driverLabel) => ({
      interpretedContractId: `opinion-f1-drivers-champion-${driverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "OPINION" as const,
      venueMarketId: `f1-world-drivers-champion-2026:${driverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: OPINION_URL,
      title,
      rulesText: canonicalRulesForDriver(driverLabel),
      driverLabel
    }));
};

const parseLimitlessRows = (html: string): readonly SportsF1DriversChampionExtractedRow[] => {
  const matches = [
    ...html.matchAll(/\\"title\\":\\"([^\\"]+)\\",\\"proxyTitle\\":null/g),
    ...html.matchAll(/"title":"([^"]+)","proxyTitle":null/g)
  ]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const drivers = [...new Set(matches)]
    .filter((title) => title !== "F1 Drivers' Champion" && title !== "F1 Drivers Champion")
    .filter((title) => title === "Other" || /^[A-Z][A-Za-z0-9.'\- ]+$/.test(title));

  return drivers.map((driverLabel) => ({
    interpretedContractId: `limitless-f1-drivers-champion-${driverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "LIMITLESS" as const,
    venueMarketId: `f1-drivers-champion-1769015228907:${driverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: LIMITLESS_URL,
    title: "F1 Drivers' Champion 2026",
    rulesText: canonicalRulesForDriver(driverLabel.trim()),
    driverLabel: driverLabel.trim()
  }));
};

const parsePolymarketRows = (html: string): readonly SportsF1DriversChampionExtractedRow[] => {
  const slugMatches = [
    ...html.matchAll(/will-([a-z0-9-]+)-be-the-2026-f1-drivers-champion/gi),
    ...html.matchAll(/\/event\/[^"' ]*\/will-([a-z0-9-]+)-be-the-2026-f1-drivers-champion/gi)
  ]
    .map((match) => match[1]?.toLowerCase() ?? "")
    .filter((value) => value.length > 0);
  const driverLabels = [...new Set(slugMatches)]
    .map((slug) => DRIVER_SLUG_MAP[slug] ?? null)
    .filter((value): value is string => value !== null);

  return driverLabels.map((driverLabel) => ({
    interpretedContractId: `polymarket-f1-drivers-champion-${driverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "POLYMARKET" as const,
    venueMarketId: `2026-f1-drivers-champion:${driverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: POLYMARKET_URL,
    title: "2026 F1 Drivers' Champion",
    rulesText: canonicalRulesForDriver(driverLabel),
    driverLabel
  }));
};

const parsePredictRows = async (): Promise<readonly SportsF1DriversChampionExtractedRow[]> => {
  const apiKey = process.env.PREDICT_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const client = new PredictClient({ environment: "mainnet", apiKey });
  const anchor = await client.getMarketById(PREDICT_ANCHOR_MARKET_ID).catch(() => null);
  const categorySlug = anchor?.categorySlug ?? null;
  if (categorySlug !== "2026-f1-drivers-champion") {
    return [];
  }

  const discoveredRows: SportsF1DriversChampionExtractedRow[] = [];
  const anchorId = Number.parseInt(PREDICT_ANCHOR_MARKET_ID, 10);
  for (let id = anchorId - 25; id <= anchorId + 25; id += 1) {
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
      interpretedContractId: `predict-f1-drivers-champion-${market.id}`,
      venue: "PREDICT",
      venueMarketId: String(market.id),
      sourceUrl: PREDICT_SLUG_URL,
      title: marketQuestion,
      rulesText: typeof market.description === "string" ? market.description : null,
      driverLabel: marketTitle
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
    "# Sports F1 Drivers Champion Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface SportsF1DriversChampionFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsF1DriversChampionFamilyPass = async (input: {
  repoRoot: string;
}): Promise<SportsF1DriversChampionFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(
        input.repoRoot,
        `${ARTIFACT_DIR}/sports-f1-drivers-champion-fetch-summary.json`
      );
    } catch {
      return null;
    }
  })();

  const [opinionHtml, polymarketHtml, limitlessHtml] = await Promise.all([
    fetchHtml(OPINION_URL, true),
    fetchHtml(POLYMARKET_URL, true),
    fetchHtml(LIMITLESS_URL)
  ]);

  const rows = uniqueRows([
    ...(opinionHtml ? parseOpinionRows(opinionHtml) : []),
    ...(polymarketHtml ? parsePolymarketRows(polymarketHtml) : []),
    ...(limitlessHtml ? parseLimitlessRows(limitlessHtml) : []),
    ...await parsePredictRows()
  ]);

  const artifacts = buildSportsF1DriversChampionFamilyArtifacts(rows);

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

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-drivers-champion-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-drivers-champion-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-drivers-champion-normalized-topics.json`, normalizedTopics);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-drivers-champion-comparability-summary.json`, comparabilitySummary);
  writeArtifact(
    input.repoRoot,
    `${ARTIFACT_DIR}/sports-f1-drivers-champion-basis-fragmentation-summary.json`,
    basisFragmentationSummary
  );
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-drivers-champion-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-drivers-champion-operator-summary.md`, operatorSummary);

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
