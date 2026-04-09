import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import { parseStructuredProposition } from "../../simulation/proposition-matching.js";
import type { MatchingMarketRecord } from "../matching-types.js";
import {
  politicsTargetVenueValues,
  type PoliticsDerivedFamily,
  type PoliticsExtractedRow,
  type PoliticsTargetVenue
} from "./politics-types.js";

const PARTY_TERMS = ["democrat", "democratic", "republican", "gop", "labour", "conservative", "liberal", "green", "socialist"];
const JURISDICTION_PATTERNS: readonly [string, RegExp][] = [
  ["usa", /\b(?:u\.?s\.?a?|united states|us election|white house|senate|house of representatives)\b/i],
  ["china", /\bchina|chinese\b/i],
  ["uk", /\b(?:uk|united kingdom|britain|british|westminster|parliament)\b/i],
  ["canada", /\bcanada|canadian\b/i],
  ["colombia", /\bcolombia|colombian\b/i],
  ["france", /\bfrance|french\b/i],
  ["germany", /\bgermany|german\b/i],
  ["mexico", /\bmexico|mexican\b/i],
  ["seoul", /\bseoul\b/i],
  ["busan", /\bbusan\b/i],
  ["south_korea", /\b(?:south korea|korean market|korean)\b/i],
  ["ukraine", /\bukraine|ukrainian\b/i],
  ["russia", /\brussia|russian|kremlin\b/i],
  ["israel", /\bisrael|israeli\b/i],
  ["gaza", /\bgaza|hamas\b/i]
] as const;

const OFFICE_PATTERNS: readonly [string, RegExp][] = [
  ["president", /\bpresident|presidential\b/i],
  ["prime_minister", /\bprime minister\b/i],
  ["governor", /\bgovernor|gubernatorial\b/i],
  ["mayor", /\bmayor|mayoral\b/i],
  ["senate_control", /\bsenate control|control of the senate|senate majority\b/i],
  ["house_control", /\bhouse control|control of the house|house majority\b/i],
  ["parliament_control", /\bparliament control|parliament majority\b/i],
  ["supreme_court", /\bsupreme court|scotus\b/i],
  ["cabinet", /\bcabinet\b/i]
] as const;

const normalizeCandidate = (value: string): string =>
  normalizeFreeText(value)
    .replace(/\b(?:will|the|next|by|before|on|candidate|win|wins|be|become|secure|secured|nomination|election)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isLikelyCandidateName = (value: string): boolean =>
  value.length > 2
  && !/\b20\d{2}\b/.test(value)
  && !/^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(value)
  && !/\b(?:mayoral|gubernatorial|presidential|election|winner|province|governor|mayor)\b/.test(value);

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));

const detectJurisdiction = (text: string): string | null => {
  if (/\bbalance of power\b/i.test(text) && /\bmidterms?\b/i.test(text)) {
    return "usa";
  }
  if (/\b(?:democratic|republican|gop)\s+presidential\b/i.test(text)) {
    return "usa";
  }
  for (const [jurisdiction, pattern] of JURISDICTION_PATTERNS) {
    if (pattern.test(text)) {
      return jurisdiction;
    }
  }
  return null;
};

const detectOffice = (text: string): string | null => {
  for (const [office, pattern] of OFFICE_PATTERNS) {
    if (pattern.test(text)) {
      return office;
    }
  }
  return null;
};

const detectInstitution = (text: string): string | null => {
  if (/\bsenate\b/i.test(text)) {
    return "senate";
  }
  if (/\bhouse\b/i.test(text)) {
    return "house";
  }
  if (/\bparliament\b/i.test(text)) {
    return "parliament";
  }
  if (/\bsupreme court|scotus|court\b/i.test(text)) {
    return "court";
  }
  if (/\bcabinet\b/i.test(text)) {
    return "cabinet";
  }
  if (/\bwhite house|president\b/i.test(text)) {
    return "executive";
  }
  return null;
};

const detectChamber = (text: string): string | null =>
  /\bsenate\b/i.test(text) ? "senate"
  : /\bhouse\b/i.test(text) ? "house"
  : /\bparliament\b/i.test(text) ? "parliament"
  : null;

const detectBranch = (text: string): string | null =>
  /\bcourt|scotus|judge\b/i.test(text) ? "judicial"
  : /\bsenate|house|parliament|congress|legislature\b/i.test(text) ? "legislative"
  : /\bpresident|prime minister|governor|mayor|cabinet|white house\b/i.test(text) ? "executive"
  : null;

const detectStage = (text: string): string | null =>
  /\bprimary\b/i.test(text) ? "primary"
  : /\brunoff\b/i.test(text) ? "runoff"
  : /\bgeneral\b/i.test(text) ? "general"
  : /\bnomination|nominee|nominate\b/i.test(text) ? "nomination"
  : /\bconfirm|confirmation|approved|approval\b/i.test(text) ? "confirmation"
  : null;

const detectEventType = (text: string): string | null =>
  /\bceasefire|truce\b/i.test(text) ? "ceasefire"
  : /\bcoup\b/i.test(text) ? "coup"
  : /\bregime|government fall|government collapse\b/i.test(text) ? "regime_change"
  : /\bvisit\b.*\bchina\b|\bchina\b.*\bvisit\b/i.test(text) ? "diplomatic_visit"
  : /\bsanctions\b/i.test(text) ? "sanctions"
  : /\bacquir(?:e|es|ed|ing)|annex(?:es|ed|ing)?|buy\b.*\bgreenland|greenland\b/i.test(text) ? "territorial_acquisition"
  : /\bconfirm|confirmation|appointment|approve|approval|court ruling\b/i.test(text) ? "confirmation_or_appointment"
  : /\bresign|removed|impeached|leave office|out of office|ousted\b/i.test(text) ? "office_exit"
  : null;

const detectPartyTerms = (text: string): readonly string[] =>
  uniqueSorted(PARTY_TERMS.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(text)));

const detectCycleYear = (text: string, parsedDeadline: string | null): string | null => {
  const deadlineYear = parsedDeadline?.match(/\b(20\d{2})\b/)?.[1] ?? null;
  if (deadlineYear) {
    return deadlineYear;
  }
  return text.match(/\b(20\d{2})\b/i)?.[1] ?? null;
};

const isYesNo = (labels: readonly string[]): boolean =>
  labels.length === 2
  && labels.every((label) => {
    const normalized = normalizeFreeText(label);
    return normalized === "yes" || normalized === "no";
  });

const detectOutcomeStructureType = (labels: readonly string[]): PoliticsExtractedRow["outcomeStructureType"] => {
  if (isYesNo(labels)) {
    return "YES_NO";
  }
  if (labels.length === 2) {
    return "BINARY_NAMED";
  }
  const candidateLike = labels.filter((label) => normalizeCandidate(label).length > 0);
  return candidateLike.length >= 2 ? "MULTI_CANDIDATE" : "MULTI_OTHER";
};

const extractCandidateNames = (market: MatchingMarketRecord, text: string): readonly string[] => {
  const fromOutcomes = market.outcomes
    .map((outcome) => (typeof outcome["label"] === "string" ? normalizeCandidate(outcome["label"]) : ""))
    .filter((value) => value.length > 0 && value !== "yes" && value !== "no" && isLikelyCandidateName(value));
  if (fromOutcomes.length > 0) {
    return uniqueSorted(fromOutcomes);
  }

  const nameMatches = [...text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)].map((match) => normalizeCandidate(match[1] ?? ""));
  const likelyNames = uniqueSorted(
    nameMatches.filter((value) =>
      isLikelyCandidateName(value)
      && !["united states", "white house", "supreme court", "prime minister", "resolves", "french"].includes(value)
    )
  );
  if (likelyNames.length > 0) {
    return likelyNames;
  }

  const parsed = parseStructuredProposition({
    category: "POLITICS",
    title: market.title,
    rules: market.rulesText,
    boundaryReferenceAt: market.resolvesAt ?? market.expiresAt ?? market.publishedAt
  });
  if (parsed.subject.normalized) {
    const parsedSubject = normalizeCandidate(parsed.subject.normalized);
    if (parsedSubject.length > 0 && isLikelyCandidateName(parsedSubject)) {
      return [parsedSubject];
    }
  }
  return [];
};

const deriveFamily = (
  text: string,
  office: string | null,
  eventType: string | null,
  threshold: string | null,
  stage: string | null,
  dateBoundary: string | null
): PoliticsDerivedFamily => {
  if (eventType === "confirmation_or_appointment") {
    return "CONFIRMATION_APPOINTMENT";
  }
  if (eventType === "office_exit") {
    return "OFFICE_EXIT_BY_DATE";
  }
  if (
    eventType === "ceasefire"
    || eventType === "coup"
    || eventType === "regime_change"
    || eventType === "sanctions"
    || eventType === "territorial_acquisition"
    || eventType === "diplomatic_visit"
  ) {
    return dateBoundary ? "GEOPOLITICAL_EVENT_BY_DATE" : "GEOPOLITICAL_EVENT";
  }
  if (stage === "nomination" || /\bprimary|caucus|nominee\b/i.test(text)) {
    return "NOMINEE_WINNER";
  }
  if (
    office === "senate_control"
    || office === "house_control"
    || office === "parliament_control"
    || /\bcontrol\b/i.test(text)
    || /\bbalance of power\b/i.test(text)
    || (/\bsenate\b/i.test(text) && /\bhouse\b/i.test(text) && /\bsweep\b/i.test(text))
  ) {
    return "PARTY_CONTROL";
  }
  if (threshold && /\bby|before|on|end of\b/i.test(text)) {
    return "THRESHOLD_BY_DATE";
  }
  if (office) {
    return "OFFICE_WINNER";
  }
  if (/\bwill\b/i.test(text)) {
    return "DIRECTIONAL_RESIDUAL";
  }
  return "OUT_OF_SCOPE";
};

export const isPoliticsCandidateMarket = (market: MatchingMarketRecord): boolean => {
  if (market.category === "POLITICS" && politicsTargetVenueValues.includes(market.venue as PoliticsTargetVenue)) {
    return true;
  }
  const combined = `${market.title} ${market.rulesText ?? ""}`;
  return politicsTargetVenueValues.includes(market.venue as PoliticsTargetVenue)
    && /\belection|president|senate|house|parliament|nominee|nomination|prime minister|governor|mayor|confirm|ceasefire|sanctions|cabinet|supreme court\b/i.test(combined);
};

export const extractPoliticsInventoryRow = (market: MatchingMarketRecord): PoliticsExtractedRow => {
  const outcomeLabels = market.outcomes
    .map((outcome) => (typeof outcome["label"] === "string" ? String(outcome["label"]) : ""))
    .filter((value) => value.length > 0);
  const combinedText = `${market.title} ${market.rulesText ?? ""} ${outcomeLabels.join(" ")}`.trim();
  const parsed = parseStructuredProposition({
    category: "POLITICS",
    title: market.title,
    rules: market.rulesText,
    yesLabel: typeof market.outcomes[0]?.["label"] === "string" ? String(market.outcomes[0]?.["label"]) : null,
    noLabel: typeof market.outcomes[1]?.["label"] === "string" ? String(market.outcomes[1]?.["label"]) : null,
    boundaryReferenceAt: market.resolvesAt ?? market.expiresAt ?? market.publishedAt
  });
  const normalizedText = normalizeFreeText(combinedText);
  const jurisdiction = detectJurisdiction(combinedText) ?? parsed.competitionOrContext.normalized;
  const office = detectOffice(combinedText);
  const institution = detectInstitution(combinedText);
  const chamber = detectChamber(combinedText);
  const branch = detectBranch(combinedText);
  const contestStage = detectStage(combinedText);
  const candidateNames = extractCandidateNames(market, combinedText);
  const partyTerms = detectPartyTerms(normalizedText);
  const thresholdSemantics = parsed.threshold.normalized;
  const dateBoundarySemantics = parsed.deadlineOrSeason.normalized;
  const eventType = detectEventType(combinedText);
  const family = deriveFamily(combinedText, office, eventType, thresholdSemantics, contestStage, dateBoundarySemantics);
  const parseFailures: string[] = [];
  if (!jurisdiction) {
    parseFailures.push("MISSING_JURISDICTION");
  }
  if (!office && family === "OFFICE_WINNER") {
    parseFailures.push("MISSING_OFFICE");
  }
  if (!dateBoundarySemantics && (family === "THRESHOLD_BY_DATE" || family === "OFFICE_EXIT_BY_DATE" || family === "GEOPOLITICAL_EVENT_BY_DATE")) {
    parseFailures.push("MISSING_DATE_BOUNDARY");
  }
  if (candidateNames.length === 0 && (family === "NOMINEE_WINNER" || family === "OFFICE_WINNER")) {
    parseFailures.push("MISSING_CANDIDATE_SET");
  }

  const extractionConfidence =
    parseFailures.length === 0 ? "HIGH"
    : parseFailures.length <= 2 ? "MEDIUM"
    : "LOW";

  return {
    interpretedContractId: market.interpretedContractId,
    venue: market.venue as PoliticsTargetVenue,
    venueMarketId: market.venueMarketId,
    sourceMarketSlug: typeof market.rawLineageReferences["slug"] === "string" ? market.rawLineageReferences["slug"] as string : null,
    canonicalEventId: market.canonicalEventId,
    title: market.title,
    rulesText: market.rulesText,
    category: market.category,
    marketClass: market.marketClass,
    tags: [],
    outcomeCount: outcomeLabels.length,
    outcomeLabels,
    publishedAt: market.publishedAt?.toISOString() ?? null,
    expiresAt: market.expiresAt?.toISOString() ?? null,
    resolvesAt: market.resolvesAt?.toISOString() ?? null,
    jurisdiction: typeof jurisdiction === "string" ? jurisdiction : null,
    office,
    institution,
    chamber,
    branch,
    cycleYear: detectCycleYear(combinedText, dateBoundarySemantics),
    contestStage,
    candidateNames,
    candidateSetFingerprint: candidateNames.length > 0 ? candidateNames.join("|") : null,
    partyTerms,
    partyStructureFingerprint: partyTerms.length > 0 ? partyTerms.join("|") : null,
    thresholdSemantics,
    dateBoundarySemantics,
    eventType,
    outcomeStructureType: detectOutcomeStructureType(outcomeLabels),
    resolutionBasisHints: parsed.resolutionSourceType.normalized === "UNKNOWN" ? [] : [parsed.resolutionSourceType.normalized],
    family,
    extractionConfidence,
    parseFailures,
    inventoryTemporalBasis: market.inventoryTemporalBasis
  };
};
