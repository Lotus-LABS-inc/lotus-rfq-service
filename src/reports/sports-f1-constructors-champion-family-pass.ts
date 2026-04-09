import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  buildSportsF1ConstructorsChampionFamilyArtifacts,
  type SportsF1ConstructorsChampionExtractedRow
} from "../matching/sports/sports-f1-constructors-champion-family-pass.js";

const ARTIFACT_DIR = "artifacts/sports/f1-constructors-champion-family-pass";
const LIMITLESS_URL = "https://limitless.exchange/markets/f1-constructors-champion-1769014616132?rv=7Q4JYY4UXP";
const OPINION_URL = "https://app.opinion.trade/market/f1-constructors-champion";
const POLYMARKET_URL = "https://polymarket.com/event/f1-constructors-champion";

const CONSTRUCTOR_NAMES = [
  "McLaren",
  "Ferrari",
  "Mercedes",
  "Red Bull Racing",
  "Aston Martin",
  "Audi",
  "Williams",
  "Other"
] as const;

const uniqueRows = (
  rows: readonly SportsF1ConstructorsChampionExtractedRow[]
): readonly SportsF1ConstructorsChampionExtractedRow[] => {
  const byVenueAndId = new Map<string, SportsF1ConstructorsChampionExtractedRow>();
  for (const row of rows) {
    byVenueAndId.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  return [...byVenueAndId.values()];
};

const canonicalRulesForConstructor = (constructorLabel: string): string =>
  constructorLabel === "Other"
    ? "This market resolves to Yes if any constructor other than the listed teams wins the 2026 F1 Constructors Championship, or if the season is permanently canceled or not completed by March 31, 2027. Otherwise it resolves to No."
    : `This market resolves to Yes if ${constructorLabel} win the 2026 F1 Constructors Championship. Otherwise it resolves to No. If the season is permanently canceled or not completed by March 31, 2027, the market titled Other resolves to Yes.`;

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

const parseOpinionRows = (html: string): readonly SportsF1ConstructorsChampionExtractedRow[] => {
  const title = extractTitle(html);
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim() ?? null;
  if (!title || !description || !/f1 constructors/i.test(title)) {
    return [];
  }

  return description
    .split("|")
    .map((segment) => segment.split(":")[0]?.trim() ?? "")
    .filter((constructorLabel) => constructorLabel.length > 0)
    .map((constructorLabel) => ({
      interpretedContractId: `opinion-f1-constructors-champion-${constructorLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "OPINION" as const,
      venueMarketId: `f1-constructors-champion:${constructorLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: OPINION_URL,
      title,
      rulesText: canonicalRulesForConstructor(constructorLabel),
      constructorLabel
    }));
};

const parseLimitlessRows = (html: string): readonly SportsF1ConstructorsChampionExtractedRow[] => {
  const matches = [
    ...html.matchAll(/\\"title\\":\\"([^\\"]+)\\",\\"proxyTitle\\":null/g),
    ...html.matchAll(/"title":"([^"]+)","proxyTitle":null/g)
  ]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const constructors = [...new Set(matches)]
    .filter((title) => title !== "F1 Constructors' Champion" && title !== "F1 Constructors Champion")
    .filter((title) => CONSTRUCTOR_NAMES.includes(title as (typeof CONSTRUCTOR_NAMES)[number]));

  return constructors.map((constructorLabel) => ({
    interpretedContractId: `limitless-f1-constructors-champion-${constructorLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    venue: "LIMITLESS" as const,
    venueMarketId: `f1-constructors-champion-1769014616132:${constructorLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceUrl: LIMITLESS_URL,
    title: "F1 Constructors' Champion 2026",
    rulesText: canonicalRulesForConstructor(constructorLabel),
    constructorLabel
  }));
};

const parsePolymarketRows = (html: string): readonly SportsF1ConstructorsChampionExtractedRow[] =>
  CONSTRUCTOR_NAMES
    .filter((constructorLabel) => constructorLabel !== "Other")
    .filter((constructorLabel) => new RegExp(constructorLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(html))
    .map((constructorLabel) => ({
      interpretedContractId: `polymarket-f1-constructors-champion-${constructorLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      venue: "POLYMARKET" as const,
      venueMarketId: `f1-constructors-champion:${constructorLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceUrl: POLYMARKET_URL,
      title: "F1 Constructors' Champion",
      rulesText: canonicalRulesForConstructor(constructorLabel),
      constructorLabel
    }));

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const buildOperatorSummary = (input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: readonly { canonicalTopicKey: string; venuesPresent: readonly string[]; notes: readonly string[] }[];
  finalDecision: { bestCandidateTopicKey: string | null; matcherFollowUpJustified: boolean; singleBestNextAction: string };
}) =>
  [
    "# Sports F1 Constructors Champion Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- comparable topic lanes: ${input.comparabilitySummary.map((topic) => `${topic.canonicalTopicKey}(${topic.venuesPresent.join("|")})`).join(", ") || "none"}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");

export interface SportsF1ConstructorsChampionFamilyPassRunResult {
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsF1ConstructorsChampionFamilyPass = async (input: {
  repoRoot: string;
}): Promise<SportsF1ConstructorsChampionFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(
        input.repoRoot,
        `${ARTIFACT_DIR}/sports-f1-constructors-champion-fetch-summary.json`
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
    ...(limitlessHtml ? parseLimitlessRows(limitlessHtml) : [])
  ]);

  const artifacts = buildSportsF1ConstructorsChampionFamilyArtifacts(rows);

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

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-constructors-champion-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-constructors-champion-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-constructors-champion-normalized-topics.json`, normalizedTopics);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-constructors-champion-comparability-summary.json`, comparabilitySummary);
  writeArtifact(
    input.repoRoot,
    `${ARTIFACT_DIR}/sports-f1-constructors-champion-basis-fragmentation-summary.json`,
    basisFragmentationSummary
  );
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-constructors-champion-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-f1-constructors-champion-operator-summary.md`, operatorSummary);

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
