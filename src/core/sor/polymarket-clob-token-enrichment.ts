export interface PolymarketQuoteProfileForEnrichment {
  profileId: string;
  approvedVenueMarketId: string;
  title?: string | undefined;
  normalizedPayload: unknown;
  rawSourcePayload: unknown;
}

export interface PolymarketQuoteMetadataMarket {
  marketId: string | null;
  conditionId: string;
  marketSlug: string | null;
  title?: string | undefined;
  raw: Record<string, unknown>;
}

export interface PolymarketClobTokenEnrichment {
  profileId: string;
  matchedIdentifier: string;
  quoteMarketId: string;
  quoteTokenId: string;
  quoteOutcomeLabel: "Yes";
  normalizedPayload: Record<string, unknown>;
  rawSourcePayload: Record<string, unknown>;
}

export type PolymarketClobTokenEnrichmentResult =
  | { ok: true; enrichment: PolymarketClobTokenEnrichment }
  | { ok: false; profileId: string; blockers: readonly string[]; matchedIdentifier: string | null };

export const extractPolymarketQuoteIdentifier = (
  profile: Pick<PolymarketQuoteProfileForEnrichment, "approvedVenueMarketId" | "normalizedPayload" | "rawSourcePayload">
): string | null => {
  const normalizedPayload = asRecord(profile.normalizedPayload);
  const rawPayload = asRecord(profile.rawSourcePayload);
  return firstString(
    normalizedPayload.quoteMarketId,
    normalizedPayload.quote_market_id,
    normalizedPayload.conditionId,
    normalizedPayload.condition_id,
    sourceQuoteEvidence(rawPayload).conditionId,
    sourceQuoteEvidence(rawPayload).marketId,
    rawPayload.quoteMarketId,
    rawPayload.quote_market_id,
    rawPayload.conditionId,
    rawPayload.condition_id,
    normalizedPayload.venueMarketId,
    normalizedPayload.venue_market_id,
    rawPayload.venueMarketId,
    rawPayload.venue_market_id,
    stripCuratedVenueMarketId(profile.approvedVenueMarketId, firstString(normalizedPayload.curatedKey, rawPayload.curatedKey))
  );
};

export const classifyPolymarketQuoteIdentifier = (identifier: string): "CONDITION_ID" | "MARKET_ID" | "MARKET_SLUG" =>
  /^0x[0-9a-f]{64}$/i.test(identifier)
    ? "CONDITION_ID"
    : /^\d+$/.test(identifier)
      ? "MARKET_ID"
      : "MARKET_SLUG";

export const polymarketEventSlugFromQuoteIdentifier = (identifier: string): string | null => {
  const trimmed = identifier.trim();
  if (!trimmed || /^\d+$/.test(trimmed) || /^0x[0-9a-f]{64}$/i.test(trimmed)) {
    return null;
  }
  const [eventSlug, outcomeSlug] = trimmed.split(":", 2);
  return eventSlug && outcomeSlug ? eventSlug : null;
};

export const polymarketEventSlugCandidatesFromQuoteIdentifier = (identifier: string): string[] => {
  const eventSlug = polymarketEventSlugFromQuoteIdentifier(identifier);
  if (!eventSlug) {
    return [];
  }
  return [...new Set([
    eventSlug,
    ...(eventSlug === "2026-fifa-world-cup-winner" ? ["2026-fifa-world-cup-winner-595"] : [])
  ])];
};

export const buildPolymarketClobTokenEnrichment = (input: {
  profile: PolymarketQuoteProfileForEnrichment;
  markets: readonly PolymarketQuoteMetadataMarket[];
  generatedAt: string;
  metadataVersion: string;
  source: string;
}): PolymarketClobTokenEnrichmentResult => {
  const matchedIdentifier = extractPolymarketQuoteIdentifier(input.profile);
  if (!matchedIdentifier) {
    return {
      ok: false,
      profileId: input.profile.profileId,
      matchedIdentifier: null,
      blockers: ["POLYMARKET_SOURCE_IDENTIFIER_MISSING"]
    };
  }

  const identifierMatches = input.markets.filter((market) => marketMatchesIdentifier(market, matchedIdentifier));
  const matchedMarkets = identifierMatches.length > 0
    ? identifierMatches
    : input.markets.filter((market) => marketMatchesExactTitle(market, input.profile.title));
  if (matchedMarkets.length === 0) {
    return {
      ok: false,
      profileId: input.profile.profileId,
      matchedIdentifier,
      blockers: ["POLYMARKET_SOURCE_MATCH_MISSING"]
    };
  }
  if (matchedMarkets.length > 1) {
    return {
      ok: false,
      profileId: input.profile.profileId,
      matchedIdentifier,
      blockers: ["POLYMARKET_SOURCE_MATCH_AMBIGUOUS"]
    };
  }

  const matchedMarket = matchedMarkets[0]!;
  const media = extractPolymarketMedia(matchedMarket.raw);
  const metadata = extractPolymarketMarketMetadata(input.profile, matchedMarket.raw);
  const inactiveBlockers = officialMarketActivityBlockers(matchedMarket.raw);
  if (inactiveBlockers.length > 0) {
    return {
      ok: false,
      profileId: input.profile.profileId,
      matchedIdentifier,
      blockers: inactiveBlockers
    };
  }
  const outcomeTokens = extractOutcomeTokens(input.profile, matchedMarket.raw);
  if (!outcomeTokens) {
    return {
      ok: false,
      profileId: input.profile.profileId,
      matchedIdentifier,
      blockers: ["POLYMARKET_OUTCOME_TOKEN_EVIDENCE_MISSING"]
    };
  }

  const normalizedPayload = {
    ...withoutQuoteVerificationBlockers(input.profile.normalizedPayload),
    quoteMarketId: matchedMarket.conditionId,
    quoteTokenId: outcomeTokens.yes,
    quoteOutcomeLabel: "Yes",
    quoteOutcomeTokenIds: {
      YES: outcomeTokens.yes,
      NO: outcomeTokens.no
    },
    quoteSource: input.source,
    quoteMatchedIdentifier: matchedIdentifier,
    quoteMetadataVersion: input.metadataVersion,
    quoteEnrichedAt: input.generatedAt,
    ...(media.imageUrl ? { imageUrl: media.imageUrl } : {}),
    ...(media.iconUrl ? { iconUrl: media.iconUrl } : {}),
    ...metadata
  };
  const rawSourcePayload = {
    ...withoutQuoteVerificationBlockers(input.profile.rawSourcePayload),
    ...(media.imageUrl ? { imageUrl: media.imageUrl } : {}),
    ...(media.iconUrl ? { iconUrl: media.iconUrl } : {}),
    ...metadata,
    quoteEvidence: {
      source: input.source,
      conditionId: matchedMarket.conditionId,
      marketId: matchedMarket.marketId,
      marketSlug: matchedMarket.marketSlug,
      matchedIdentifier,
      outcomeLabels: ["Yes", "No"],
      metadataVersion: input.metadataVersion,
      enrichedAt: input.generatedAt
    }
  };

  return {
    ok: true,
    enrichment: {
      profileId: input.profile.profileId,
      matchedIdentifier,
      quoteMarketId: matchedMarket.conditionId,
      quoteTokenId: outcomeTokens.yes,
      quoteOutcomeLabel: "Yes",
      normalizedPayload,
      rawSourcePayload
    }
  };
};

const officialMarketActivityBlockers = (raw: Record<string, unknown>): string[] => {
  const blockers: string[] = [];
  if (raw.closed === true) {
    blockers.push("POLYMARKET_OFFICIAL_MARKET_CLOSED");
  }
  if (raw.active === false) {
    blockers.push("POLYMARKET_OFFICIAL_MARKET_INACTIVE");
  }
  if (raw.archived === true) {
    blockers.push("POLYMARKET_OFFICIAL_MARKET_ARCHIVED");
  }
  if (raw.acceptingOrders === false || raw.accepting_orders === false) {
    blockers.push("POLYMARKET_OFFICIAL_MARKET_NOT_ACCEPTING_ORDERS");
  }
  if (raw.enableOrderBook === false || raw.enable_order_book === false) {
    blockers.push("POLYMARKET_OFFICIAL_ORDERBOOK_DISABLED");
  }
  return [...new Set(blockers)];
};

const extractPolymarketMedia = (raw: Record<string, unknown>): { imageUrl: string | null; iconUrl: string | null } => {
  const imageUrl = firstSafeHttpsUrl(
    raw.imageUrl,
    raw.image_url,
    raw.image,
    raw.twitterCardImage,
    raw.thumbnailUrl,
    raw.thumbnail,
    raw.banner
  );
  const iconUrl = firstSafeHttpsUrl(
    raw.iconUrl,
    raw.icon_url,
    raw.icon,
    raw.logoUrl,
    raw.logo,
    imageUrl
  );
  return { imageUrl, iconUrl };
};

const extractPolymarketMarketMetadata = (
  profile: PolymarketQuoteProfileForEnrichment,
  raw: Record<string, unknown>
): Record<string, string> => {
  const metadata: Record<string, string> = {};
  const closeDate = curatedCloseDate(profile) ?? firstSafeIsoTimestamp(
    raw.endDateIso,
    raw.end_date_iso,
    raw.endDate,
    raw.end_date,
    raw.expiration,
    raw.expirationTimestamp,
    raw.expiresAt,
    raw.expires_at,
    raw.closeTime,
    raw.close_time
  );
  if (closeDate) {
    metadata.expiresAt = closeDate;
    metadata.resolvesAt = closeDate;
  }
  const volume = firstFiniteNumberString(raw.volume, raw.volumeNum, raw.volume_num, raw.totalVolume, raw.total_volume);
  if (volume) {
    metadata.volume = volume;
  }
  const volume24h = firstFiniteNumberString(
    raw.volume24h,
    raw.volume24hr,
    raw.volume_24h,
    raw.volume24hUsd,
    raw.volume_24h_usd,
    raw.volume1d,
    raw.volume_1d
  );
  if (volume24h) {
    metadata.volume24h = volume24h;
  }
  const liquidity = firstFiniteNumberString(raw.liquidity, raw.liquidityNum, raw.liquidity_num, raw.openInterest, raw.open_interest);
  if (liquidity) {
    metadata.liquidity = liquidity;
  }
  const change24h = firstFiniteNumberString(
    raw.oneDayPriceChange,
    raw.one_day_price_change,
    raw.priceChange24h,
    raw.price_change_24h,
    raw.change24h,
    raw.change_24h
  );
  if (change24h) {
    metadata.change24h = change24h;
  }
  const changePercent24h = firstFiniteNumberString(
    raw.oneDayPriceChangePercent,
    raw.one_day_price_change_percent,
    raw.priceChangePercent24h,
    raw.price_change_percent_24h,
    raw.changePercent24h,
    raw.change_percent_24h
  );
  if (changePercent24h) {
    metadata.changePercent24h = changePercent24h;
  }
  return metadata;
};

const marketMatchesIdentifier = (market: PolymarketQuoteMetadataMarket, identifier: string): boolean =>
  [market.conditionId, market.marketId, market.marketSlug]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .some((value) => value.trim() === identifier)
  || marketMatchesEventOutcomeSlug(market, identifier);

const marketMatchesEventOutcomeSlug = (market: PolymarketQuoteMetadataMarket, identifier: string): boolean => {
  const [, outcomeSlug] = identifier.split(":", 2);
  if (!outcomeSlug || !market.marketSlug) {
    return false;
  }
  const normalizedOutcome = normalizeKnownAlias(normalizeSlug(outcomeSlug));
  const normalizedMarketSlug = normalizeKnownAlias(normalizeSlug(market.marketSlug));
  return normalizedMarketSlug.includes(normalizedOutcome);
};

const marketMatchesExactTitle = (market: PolymarketQuoteMetadataMarket, title: string | undefined): boolean =>
  Boolean(title && market.title && (
    normalizeTitle(market.title) === normalizeTitle(title)
    || titleSubjectCandidates(title).some((subject) => normalizeTitle(market.title ?? "").includes(subject))
    || titleSubjectCandidates(title).some((subject) => normalizeKnownAlias(normalizeSlug(market.marketSlug ?? "")).includes(normalizeKnownAlias(normalizeSlug(subject))))
  ));

const normalizeTitle = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const normalizeKnownAlias = (value: string): string => {
  const aliases: Readonly<Record<string, string>> = {
    "gen-g-esports": "geng-esports",
    "anyone-s-legend": "anyones-legend",
    "united-states": "usa",
    "paris-saint-germain": "psg",
    "borussia-dortmund": "dortmund",
    "inter-milan": "inter",
    "democrats-sweep": "d-senate-d-house",
    "republicans-sweep": "r-senate-r-house"
  };
  return aliases[value] ?? value;
};

const titleSubjectCandidates = (title: string): string[] => {
  const afterColon = title.includes(":") ? title.split(":").slice(1).join(":").trim() : "";
  const beforeKnownSuffix = title
    .replace(/^Seoul Mayor 2026 Winner:\s*/i, "")
    .replace(/^Fifa World Cup 2026 Winner:\s*/i, "")
    .replace(/^Uefa Champions League 2025 2026 Winner:\s*/i, "")
    .replace(/^LCK 2026 Winner:\s*/i, "")
    .replace(/^LPL 2026 Winner:\s*/i, "")
    .trim();
  const dateAliases = title.includes("2026-12-31") ? ["end of 2026"] : [];
  return [...new Set([afterColon, beforeKnownSuffix]
    .concat(dateAliases)
    .map((value) => normalizeTitle(value))
    .filter((value) => value.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(value)))];
};

const extractOutcomeTokens = (
  profile: PolymarketQuoteProfileForEnrichment,
  raw: Record<string, unknown>
): { yes: string; no: string } | null =>
  extractBinaryOutcomeTokens(raw) ?? extractFirstToThresholdOutcomeTokens(profile, raw);

const extractBinaryOutcomeTokens = (raw: Record<string, unknown>): { yes: string; no: string } | null => {
  if (!Array.isArray(raw.outcomes)) {
    return null;
  }
  const byLabel = new Map<string, string>();
  for (const outcome of raw.outcomes) {
    const record = asRecord(outcome);
    const label = normalizeOutcomeLabel(record.label);
    const tokenId = firstString(record.token_id);
    if (!label || !tokenId) {
      continue;
    }
    if (byLabel.has(label)) {
      return null;
    }
    byLabel.set(label, tokenId);
  }
  const yes = byLabel.get("YES");
  const no = byLabel.get("NO");
  return yes && no && byLabel.size === 2 ? { yes, no } : null;
};

const extractFirstToThresholdOutcomeTokens = (
  profile: PolymarketQuoteProfileForEnrichment,
  raw: Record<string, unknown>
): { yes: string; no: string } | null => {
  const normalizedPayload = asRecord(profile.normalizedPayload);
  const rawPayload = asRecord(profile.rawSourcePayload);
  const curatedKey = firstString(normalizedPayload.curatedKey, rawPayload.curatedKey);
  const parts = curatedKey?.split("|") ?? [];
  const familyIndex = parts.indexOf("FIRST_TO_THRESHOLD_BY_DATE");
  if (familyIndex < 0 || parts.length < familyIndex + 5 || !Array.isArray(raw.outcomes)) {
    return null;
  }
  const firstThreshold = normalizeNumericOutcome(parts[familyIndex + 2]);
  const secondThreshold = normalizeNumericOutcome(parts[familyIndex + 3]);
  if (!firstThreshold || !secondThreshold) {
    return null;
  }
  const byNumericLabel = new Map<string, string>();
  for (const outcome of raw.outcomes) {
    const record = asRecord(outcome);
    const tokenId = firstString(record.token_id);
    const numericLabel = normalizeNumericOutcome(record.label);
    if (!tokenId || !numericLabel) {
      continue;
    }
    if (byNumericLabel.has(numericLabel)) {
      return null;
    }
    byNumericLabel.set(numericLabel, tokenId);
  }
  const yes = byNumericLabel.get(firstThreshold);
  const no = byNumericLabel.get(secondThreshold);
  return yes && no ? { yes, no } : null;
};

const normalizeOutcomeLabel = (value: unknown): "YES" | "NO" | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized === "YES" || normalized === "NO" ? normalized : null;
};

const normalizeNumericOutcome = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const raw = String(value).trim().toLowerCase().replace(/[$,\s]/g, "");
  const match = raw.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const multiplier = match[2] === "k"
    ? 1_000
    : match[2] === "m"
      ? 1_000_000
      : match[2] === "b"
        ? 1_000_000_000
        : 1;
  return String(amount * multiplier);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const sourceQuoteEvidence = (value: Record<string, unknown>): Record<string, unknown> =>
  asRecord(value.quoteEvidence);

const withoutQuoteVerificationBlockers = (value: unknown): Record<string, unknown> => {
  const record = { ...asRecord(value) };
  for (const key of [
    "quoteVerificationBlockers",
    "quote_verification_blockers",
    "quoteVerificationSource",
    "quote_verification_source",
    "quoteVerificationCheckedAt",
    "quote_verification_checked_at"
  ]) {
    delete record[key];
  }
  return record;
};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const firstSafeHttpsUrl = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    const candidate = firstString(value);
    if (!candidate) {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && !url.username && !url.password) {
        return url.toString();
      }
    } catch {
      continue;
    }
  }
  return null;
};

const curatedCloseDate = (profile: PolymarketQuoteProfileForEnrichment): string | null => {
  const normalizedPayload = asRecord(profile.normalizedPayload);
  const rawPayload = asRecord(profile.rawSourcePayload);
  const curatedKey = firstString(normalizedPayload.curatedKey, rawPayload.curatedKey);
  if (!curatedKey) {
    return null;
  }
  const date = curatedKey.split("|").find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
  return date ? `${date}T12:00:00.000Z` : null;
};

const firstSafeIsoTimestamp = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    const candidate = firstString(value);
    if (!candidate) {
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return `${candidate}T12:00:00.000Z`;
    }
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
};

const firstFiniteNumberString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,%\s,]/g, ""))
        : NaN;
    if (Number.isFinite(parsed)) {
      return String(parsed);
    }
  }
  return null;
};

const stripCuratedVenueMarketId = (venueMarketId: string, curatedKey: string | null): string | null => {
  const prefix = "POLYMARKET:";
  if (!venueMarketId.startsWith(prefix)) {
    return venueMarketId || null;
  }
  const withoutPrefix = venueMarketId.slice(prefix.length);
  if (curatedKey) {
    const suffix = `:${curatedKey}`;
    return withoutPrefix.endsWith(suffix)
      ? withoutPrefix.slice(0, -suffix.length)
      : withoutPrefix;
  }
  return withoutPrefix;
};
