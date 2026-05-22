import type { OpinionNormalizedMarket } from "../../integrations/opinion/opinion-types.js";

export interface OpinionQuoteProfileForEnrichment {
  profileId: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  approvedVenueMarketId: string;
  title: string;
  outcomes: unknown;
  normalizedPayload: unknown;
  rawSourcePayload: unknown;
}

export interface OpinionTokenEnrichment {
  profileId: string;
  matchedIdentifier: string | null;
  quoteMarketId: string;
  quoteOutcomeLabel: string | null;
  quoteOutcomeTokenIds: { YES: string; NO: string };
  normalizedPayload: Record<string, unknown>;
  rawSourcePayload: Record<string, unknown>;
}

export type OpinionTokenEnrichmentResult =
  | { ok: true; profileId: string; enrichment: OpinionTokenEnrichment }
  | { ok: false; profileId: string; matchedIdentifier: string | null; blockers: string[] };

const SOURCE = "opinion_openapi_market_detail";

export const extractOpinionQuoteIdentifier = (profile: OpinionQuoteProfileForEnrichment): string | null => {
  const normalized = asRecord(profile.normalizedPayload);
  const raw = asRecord(profile.rawSourcePayload);
  return firstString(
    normalized.quoteMarketId,
    normalized.quote_market_id,
    normalized.executableMarketId,
    normalized.executable_market_id,
    normalized.venueMarketId,
    normalized.venue_market_id,
    normalized.marketId,
    normalized.market_id,
    raw.quoteMarketId,
    raw.quote_market_id,
    raw.executableMarketId,
    raw.executable_market_id,
    raw.venueMarketId,
    raw.venue_market_id,
    raw.marketId,
    raw.market_id,
    stripCuratedOpinionVenueMarketId(profile.approvedVenueMarketId)
  );
};

export const opinionLookupCandidatesFromIdentifier = (identifier: string): readonly string[] => {
  const cleaned = identifier.trim();
  if (!cleaned) {
    return [];
  }
  if (/^\d+$/.test(cleaned)) {
    return [cleaned];
  }
  const candidates = [cleaned];
  const parts = cleaned.split(":").filter(Boolean);
  for (let length = parts.length - 1; length > 0; length -= 1) {
    candidates.push(parts.slice(0, length).join(":"));
  }
  return [...new Set(candidates)];
};

export const buildOpinionTokenEnrichment = (input: {
  profile: OpinionQuoteProfileForEnrichment;
  market: OpinionNormalizedMarket | null;
  matchedIdentifier: string | null;
  generatedAt: string;
  metadataVersion: string;
}): OpinionTokenEnrichmentResult => {
  if (!input.market) {
    return failed(input.profile, input.matchedIdentifier, ["OPINION_SOURCE_MATCH_MISSING"]);
  }

  const candidate = selectExecutableMarket(input.profile, input.market);
  if (!candidate) {
    return failed(input.profile, input.matchedIdentifier, ["OPINION_EXECUTABLE_CHILD_MARKET_AMBIGUOUS"]);
  }
  if (!candidate.yesTokenId || !candidate.noTokenId) {
    return failed(input.profile, input.matchedIdentifier, ["OPINION_TOKEN_ID_MISSING"]);
  }

  const normalizedPayload = withoutQuoteEvidence(input.profile.normalizedPayload);
  const rawSourcePayload = withoutQuoteEvidence(input.profile.rawSourcePayload);
  const quoteOutcomeTokenIds = {
    YES: candidate.yesTokenId,
    NO: candidate.noTokenId
  };

  Object.assign(normalizedPayload, {
    quoteMarketId: candidate.venueMarketId,
    quoteTokenId: candidate.yesTokenId,
    quoteOutcomeTokenIds,
    quoteSource: SOURCE,
    quoteMatchedIdentifier: input.matchedIdentifier,
    quoteMetadataVersion: input.metadataVersion,
    quoteEnrichedAt: input.generatedAt,
    quoteEvidence: {
      source: SOURCE,
      marketId: candidate.venueMarketId,
      parentMarketId: input.market.venueMarketId,
      ...(candidate.conditionId ? { conditionId: candidate.conditionId } : {}),
      ...(candidate.resultTokenId ? { resultTokenId: candidate.resultTokenId } : {}),
      ...(candidate.slug ? { slug: candidate.slug } : {})
    },
    outcomes: [
      { id: "YES", label: candidate.yesLabel ?? "Yes", tokenId: candidate.yesTokenId },
      { id: "NO", label: candidate.noLabel ?? "No", tokenId: candidate.noTokenId }
    ]
  });

  return {
    ok: true,
    profileId: input.profile.profileId,
    enrichment: {
      profileId: input.profile.profileId,
      matchedIdentifier: input.matchedIdentifier,
      quoteMarketId: candidate.venueMarketId,
      quoteOutcomeLabel: candidate.title,
      quoteOutcomeTokenIds,
      normalizedPayload,
      rawSourcePayload
    }
  };
};

export const withoutOpinionQuoteEvidence = (value: unknown): Record<string, unknown> => withoutQuoteEvidence(value);

const selectExecutableMarket = (
  profile: OpinionQuoteProfileForEnrichment,
  market: OpinionNormalizedMarket
): OpinionNormalizedMarket | null => {
  if ((market.childMarkets ?? []).length === 0) {
    return market;
  }
  const outcomeHints = outcomeHintsForProfile(profile);
  const scored = (market.childMarkets ?? [])
    .map((child) => ({ child, score: scoreMarketChild(child, outcomeHints) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) {
    return null;
  }
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) {
    return null;
  }
  return scored[0]!.child;
};

const outcomeHintsForProfile = (profile: OpinionQuoteProfileForEnrichment): string[] => {
  const hints = [
    profile.title,
    suffixAfterLastPipe(profile.canonicalMarketId),
    suffixAfterLastPipe(profile.approvedVenueMarketId),
    lastColonSegment(stripCuratedOpinionVenueMarketId(profile.approvedVenueMarketId)),
    ...outcomeLabels(profile.outcomes)
  ];
  return [...new Set(hints.map(normalizeText).filter(Boolean))];
};

const scoreMarketChild = (market: OpinionNormalizedMarket, normalizedHints: readonly string[]): number => {
  const candidateValues = [
    market.title,
    market.yesLabel,
    market.noLabel,
    market.slug,
    ...market.labels
  ].map(normalizeText).filter(Boolean);
  let score = 0;
  for (const hint of normalizedHints) {
    for (const value of candidateValues) {
      if (value === hint) score += 8;
      else if (value.includes(hint) || hint.includes(value)) score += 2;
    }
  }
  return score;
};

const failed = (
  profile: OpinionQuoteProfileForEnrichment,
  matchedIdentifier: string | null,
  blockers: string[]
): OpinionTokenEnrichmentResult => ({
  ok: false,
  profileId: profile.profileId,
  matchedIdentifier,
  blockers: [...new Set(blockers)]
});

const withoutQuoteEvidence = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  for (const key of [
    "quoteMarketId",
    "quote_market_id",
    "quoteTokenId",
    "quote_token_id",
    "quoteOutcomeId",
    "quote_outcome_id",
    "quoteOutcomeLabel",
    "quoteOutcomeTokenIds",
    "quote_outcome_token_ids",
    "quoteSource",
    "quoteMatchedIdentifier",
    "quoteMetadataVersion",
    "quoteEnrichedAt",
    "quoteEvidence",
    "quoteVerificationBlockers",
    "quoteVerificationSource",
    "quoteVerificationCheckedAt"
  ]) {
    delete record[key];
  }
  return record;
};

const stripCuratedOpinionVenueMarketId = (venueMarketId: string | null): string | null => {
  if (!venueMarketId) return null;
  const prefix = "OPINION:";
  const withoutPrefix = venueMarketId.startsWith(prefix) ? venueMarketId.slice(prefix.length) : venueMarketId;
  const marker = ":FRONTEND_CURATED:";
  const frontendIndex = withoutPrefix.indexOf(marker);
  if (frontendIndex >= 0) return withoutPrefix.slice(0, frontendIndex);
  const parts = withoutPrefix.split(":");
  const canonicalIndex = parts.findIndex((part) => part.includes("|"));
  return canonicalIndex >= 0 ? parts.slice(0, canonicalIndex).join(":") : withoutPrefix;
};

const suffixAfterLastPipe = (value: string | null): string | null => {
  if (!value) return null;
  const parts = value.split("|");
  return parts.length > 1 ? parts.at(-1) ?? null : null;
};

const lastColonSegment = (value: string | null): string | null => {
  if (!value) return null;
  const parts = value.split(":").filter(Boolean);
  return parts.at(-1) ?? null;
};

const outcomeLabels = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
      const record = asRecord(entry);
      return [
        firstString(record.id),
        firstString(record.label),
        firstString(record.name),
        firstString(record.outcome),
        firstString(record.outcomeId),
        firstString(record.outcome_id)
      ].filter((item): item is string => item !== null);
    })
    : [];

const normalizeText = (value: string | null): string =>
  (value ?? "")
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(YES|NO|OPINION|POLYMARKET|LIMITLESS|PREDICT|FUN|FRONTEND|CURATED)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if ((typeof value === "string" || typeof value === "number") && String(value).trim().length > 0) {
      return String(value).trim();
    }
  }
  return null;
};
