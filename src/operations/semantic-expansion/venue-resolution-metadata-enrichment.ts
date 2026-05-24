import type { Pool } from "pg";

import { PolymarketGammaClient } from "../../integrations/polymarket/polymarket-gamma-client.js";
import { LimitlessHistoricalClient } from "../../integrations/limitless/limitless-client.js";
import { PredictClient } from "../../integrations/predict/predict-client.js";
import type { PredictEnvironment } from "../../integrations/predict/predict-types.js";
import { PredictMarketAdapter } from "../../integrations/predict/predict-market-adapter.js";
import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import { MyriadClient } from "../../integrations/myriad/myriad-client.js";

export type VenueResolutionMetadataVenue = "POLYMARKET" | "LIMITLESS" | "PREDICT" | "PREDICT_FUN" | "OPINION" | "MYRIAD";
export type VenueResolutionMetadataMode = "DRY_RUN" | "APPLY";
export type VenueResolutionMetadataStatus = "UPDATED" | "PLANNED" | "SKIPPED" | "UNRESOLVED";

export interface VenueResolutionMetadataRow {
  profile_id: string;
  canonical_event_id: string;
  canonical_market_id: string | null;
  venue: string;
  venue_market_id: string;
  title: string;
  description: string | null;
  resolution_source: string | null;
  resolution_title: string | null;
  resolution_rules_text: string | null;
  normalized_payload: unknown;
  raw_source_payload: unknown;
}

export interface VenueResolutionMetadata {
  title: string | null;
  rulesText: string;
  sourceText: string | null;
  sourceUrl: string | null;
  fetchedBy: string;
  rawSourcePatch: Record<string, unknown>;
  normalizedPatch: Record<string, unknown>;
}

export interface VenueResolutionMetadataArtifactRow {
  profileId: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  venue: string;
  venueMarketId: string;
  title: string;
  status: VenueResolutionMetadataStatus;
  fetchedBy: string | null;
  rulePreview: string | null;
  sourcePreview: string | null;
  blockers: string[];
}

export interface VenueResolutionMetadataSummary {
  artifactSchemaVersion: 1;
  generatedAt: string;
  mode: VenueResolutionMetadataMode;
  status: "PASSED" | "FAILED";
  source: "venue_resolution_metadata_enrichment";
  summary: {
    profilesScanned: number;
    plannedOrUpdated: number;
    skipped: number;
    unresolved: number;
    blockerCounts: Record<string, number>;
  };
  safety: {
    approvedMarketsOnly: true;
    displayMetadataOnly: true;
    noExecutionChanges: true;
    noRawProviderPayloadsInArtifact: true;
    noSecretsInArtifact: true;
  };
  rows: VenueResolutionMetadataArtifactRow[];
}

export interface VenueResolutionMetadataEnrichmentOptions {
  apply: boolean;
  limit: number;
  concurrency: number;
  approvalSource: string;
  profileId?: string | null | undefined;
  venue?: string | null | undefined;
  venueMarketId?: string | null | undefined;
  includeAll?: boolean | undefined;
}

export interface VenueResolutionMetadataClients {
  polymarket?: Pick<PolymarketGammaClient, "getMarketByIdentifier" | "getEventMarketsBySlug" | "getEventBySlug"> | undefined;
  limitless?: Pick<LimitlessHistoricalClient, "getMarketDetail"> | undefined;
  predict?: Pick<PredictMarketAdapter, "getMarketById"> | undefined;
  opinion?: Pick<OpinionClient, "getMarketById" | "getMarketBySlug" | "getCategoricalMarketById"> | undefined;
  myriad?: Pick<MyriadClient, "getMarket"> | undefined;
}

const SUPPORTED_VENUES = ["POLYMARKET", "LIMITLESS", "PREDICT", "PREDICT_FUN", "OPINION", "MYRIAD"] as const;
const SOURCE = "venue_resolution_metadata_enrichment";

const RULE_TEXT_FIELDS = [
  "value",
  "resolutionRules",
  "resolution_rules",
  "resolutionRule",
  "resolution_rule",
  "resolutionRulesText",
  "resolution_rules_text",
  "rules",
  "rule",
  "description",
  "resolveDescription",
  "resolutionCriteria",
  "settlementRules",
  "settlement_rules"
] as const;

const SOURCE_TEXT_FIELDS = [
  "resolutionSource",
  "resolution_source",
  "resolutionSourceUrl",
  "resolution_source_url",
  "source",
  "sourceName",
  "source_name",
  "resolver",
  "oracle",
  "oracleName",
  "oracle_name"
] as const;

export const createVenueResolutionMetadataClients = (env: NodeJS.ProcessEnv): VenueResolutionMetadataClients => {
  const clients: VenueResolutionMetadataClients = {
    polymarket: new PolymarketGammaClient({
      baseUrl: env.POLYMARKET_GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com",
      clobHost: env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com"
    }),
    limitless: new LimitlessHistoricalClient({
      baseUrl: env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange",
      apiKey: env.LIMITLESS_API_KEY?.trim() ?? ""
    }),
    myriad: new MyriadClient({
      baseUrl: env.MYRIAD_BASE_URL ?? "https://api-v2.myriadprotocol.com/",
      ...(env.MYRIAD_API_KEY?.trim() ? { apiKey: env.MYRIAD_API_KEY.trim() } : {})
    })
  };

  const predictApiKey = env.PREDICT_API_KEY?.trim();
  if (predictApiKey) {
    clients.predict = new PredictMarketAdapter({
      client: new PredictClient({
        environment: (env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet") as PredictEnvironment,
        apiKey: predictApiKey
      }),
      environment: (env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet") as PredictEnvironment,
      metadataVersion: "venue-resolution-metadata-enrichment-v1"
    });
  }

  const opinionApiKey = env.OPINION_BUILDER_API_KEY?.trim() ?? env.OPINION_API_KEY?.trim();
  if (opinionApiKey) {
    clients.opinion = new OpinionClient({
      baseUrl: env.OPINION_OPENAPI_BASE_URL ?? env.OPINION_CLOB_BASE_URL ?? "https://openapi.opinion.trade/openapi",
      apiKey: opinionApiKey,
      requestTimeoutMs: 8_000
    });
  }

  return clients;
};

export const runVenueResolutionMetadataEnrichment = async (input: {
  pool: Pool;
  clients: VenueResolutionMetadataClients;
  options: VenueResolutionMetadataEnrichmentOptions;
  generatedAt?: string | undefined;
}): Promise<VenueResolutionMetadataSummary> => {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const mode: VenueResolutionMetadataMode = input.options.apply ? "APPLY" : "DRY_RUN";
  const candidates = await listCandidateRows(input.pool, input.options);
  const scopedCandidates = candidates.filter((row) => input.options.includeAll || needsVenueResolutionHydration(row));
  const resolved = await mapConcurrent(scopedCandidates, input.options.concurrency, async (row) => ({
    row,
    result: await resolveVenueResolutionMetadata(row, input.clients)
  }));
  const rows: VenueResolutionMetadataArtifactRow[] = [];
  const blockerCounts = new Map<string, number>();

  if (input.options.apply) {
    await input.pool.query("BEGIN");
  }
  try {
    for (const { row, result } of resolved) {
      if (result.ok) {
        if (input.options.apply) {
          await applyVenueResolutionMetadata(input.pool, row, result.metadata, generatedAt);
        }
        rows.push(toArtifactRow(row, input.options.apply ? "UPDATED" : "PLANNED", result.metadata, []));
      } else {
        incrementBlockers(blockerCounts, result.blockers);
        rows.push(toArtifactRow(row, "UNRESOLVED", null, result.blockers));
      }
    }

    const skipped = candidates.filter((row) => !scopedCandidates.includes(row));
    for (const row of skipped) {
      rows.push(toArtifactRow(row, "SKIPPED", null, ["RULE_TEXT_ALREADY_TRUSTED"]));
    }

    if (input.options.apply) {
      await input.pool.query("COMMIT");
    }
  } catch (error) {
    if (input.options.apply) {
      await input.pool.query("ROLLBACK");
    }
    throw error;
  }

  const plannedOrUpdated = rows.filter((row) => row.status === "PLANNED" || row.status === "UPDATED").length;
  const unresolved = rows.filter((row) => row.status === "UNRESOLVED").length;
  return {
    artifactSchemaVersion: 1,
    generatedAt,
    mode,
    status: unresolved > 0 ? "FAILED" : "PASSED",
    source: SOURCE,
    summary: {
      profilesScanned: candidates.length,
      plannedOrUpdated,
      skipped: rows.filter((row) => row.status === "SKIPPED").length,
      unresolved,
      blockerCounts: Object.fromEntries([...blockerCounts.entries()].sort(([left], [right]) => left.localeCompare(right)))
    },
    safety: {
      approvedMarketsOnly: true,
      displayMetadataOnly: true,
      noExecutionChanges: true,
      noRawProviderPayloadsInArtifact: true,
      noSecretsInArtifact: true
    },
    rows
  };
};

export const resolveVenueResolutionMetadata = async (
  row: VenueResolutionMetadataRow,
  clients: VenueResolutionMetadataClients
): Promise<{ ok: true; metadata: VenueResolutionMetadata } | { ok: false; blockers: string[] }> => {
  const persisted = buildMetadataFromPayloads(row, [row.raw_source_payload, row.normalized_payload], "persisted_payload");
  if (persisted) {
    return { ok: true, metadata: persisted };
  }

  const venue = normalizeVenue(row.venue);
  try {
    if (venue === "LIMITLESS" && clients.limitless) {
      return await resolveLimitlessMetadata(row, clients.limitless);
    }
    if (venue === "POLYMARKET" && clients.polymarket) {
      return await resolvePolymarketMetadata(row, clients.polymarket);
    }
    if (venue === "PREDICT_FUN" && clients.predict) {
      return await resolvePredictMetadata(row, clients.predict);
    }
    if (venue === "OPINION" && clients.opinion) {
      return await resolveOpinionMetadata(row, clients.opinion);
    }
    if (venue === "MYRIAD" && clients.myriad) {
      return await resolveMyriadMetadata(row, clients.myriad);
    }
  } catch {
    return { ok: false, blockers: [`${venue}_METADATA_FETCH_FAILED`] };
  }

  return { ok: false, blockers: [`${venue}_METADATA_CLIENT_UNAVAILABLE`] };
};

export const needsVenueResolutionHydration = (row: VenueResolutionMetadataRow): boolean => {
  const hasTrustedRules =
    isTrustedVenueRuleText(row.resolution_rules_text, row.title)
    || isTrustedVenueRuleText(row.description, row.title);
  if (!hasTrustedRules) {
    return true;
  }
  return sanitizeVenueSourceText(row.resolution_source, row.venue) === null;
};

export const extractPrefixedVenueMarketSegments = (
  venue: string,
  venueMarketId: string
): readonly string[] => {
  const [prefix, ...segments] = venueMarketId.split(":");
  if (!prefix || normalizeVenue(prefix) !== normalizeVenue(venue)) {
    return [];
  }
  return segments;
};

const listCandidateRows = async (
  pool: Pool,
  options: VenueResolutionMetadataEnrichmentOptions
): Promise<VenueResolutionMetadataRow[]> => {
  const params: unknown[] = [options.approvalSource, Math.max(1, Math.min(1000, options.limit))];
  const conditions = [
    `vmp.venue = ANY($${params.push([...SUPPORTED_VENUES])}::text[])`,
    `(fma.canonical_event_id IS NOT NULL OR mem.venue_market_profile_id IS NOT NULL)`
  ];
  if (options.profileId) {
    conditions.push(`vmp.id = $${params.push(options.profileId)}`);
  }
  if (options.venue) {
    conditions.push(`vmp.venue = $${params.push(normalizeVenue(options.venue))}`);
  }
  if (options.venueMarketId) {
    conditions.push(`vmp.venue_market_id = $${params.push(options.venueMarketId)}`);
  }
  if (!options.includeAll) {
    conditions.push(`(
      vmp.resolution_rules_text IS NULL
      OR vmp.description IS NULL
      OR lower(vmp.resolution_rules_text) = lower(vmp.title)
      OR lower(vmp.description) = lower(vmp.title)
      OR length(vmp.resolution_rules_text) < 80
      OR vmp.resolution_source IS NULL
      OR upper(vmp.resolution_source) = upper(vmp.venue)
    )`);
  }

  const result = await pool.query<VenueResolutionMetadataRow>(
    `SELECT
       vmp.id::text AS profile_id,
       ce.id::text AS canonical_event_id,
       cem.id AS canonical_market_id,
       vmp.venue,
       vmp.venue_market_id,
       vmp.title,
       vmp.description,
       vmp.resolution_source,
       vmp.resolution_title,
       vmp.resolution_rules_text,
       vmp.normalized_payload,
       vmp.raw_source_payload
     FROM venue_market_profiles vmp
     JOIN canonical_events ce
       ON ce.id = vmp.canonical_event_id
     LEFT JOIN frontend_market_approvals fma
       ON fma.canonical_event_id = ce.id
      AND fma.status = 'APPROVED'
      AND fma.metadata->>'source' = $1
     LEFT JOIN canonical_executable_market_members mem
       ON mem.venue_market_profile_id = vmp.id
     LEFT JOIN canonical_executable_markets cem
       ON cem.id = mem.canonical_executable_market_id
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY COALESCE(fma.sort_priority, 1000), ce.updated_at DESC, vmp.venue, vmp.title
    LIMIT $2`,
    params
  );
  return result.rows;
};

const resolveLimitlessMetadata = async (
  row: VenueResolutionMetadataRow,
  client: Pick<LimitlessHistoricalClient, "getMarketDetail">
): Promise<{ ok: true; metadata: VenueResolutionMetadata } | { ok: false; blockers: string[] }> => {
  const identifiers = limitlessIdentifiers(row);
  for (const identifier of identifiers) {
    try {
      const detail = await client.getMarketDetail(identifier);
      const metadata = buildMetadataFromPayloads(row, [detail], `limitless_market_detail:${identifier}`);
      if (metadata) return { ok: true, metadata };
    } catch {
      continue;
    }
  }
  return { ok: false, blockers: ["LIMITLESS_RULE_METADATA_NOT_FOUND"] };
};

const resolvePolymarketMetadata = async (
  row: VenueResolutionMetadataRow,
  client: Pick<PolymarketGammaClient, "getMarketByIdentifier" | "getEventMarketsBySlug" | "getEventBySlug">
): Promise<{ ok: true; metadata: VenueResolutionMetadata } | { ok: false; blockers: string[] }> => {
  for (const identifier of genericIdentifiers(row)) {
    try {
      const markets = await client.getMarketByIdentifier(identifier);
      for (const market of markets) {
        const metadata = buildMetadataFromPayloads(row, [market.raw], `polymarket_gamma:${identifier}`);
        if (metadata) return { ok: true, metadata };
      }
    } catch {
      continue;
    }
  }
  const [eventSlug, outcomeSlug] = extractPrefixedVenueMarketSegments(row.venue, row.venue_market_id);
  if (eventSlug && /^[a-z0-9-]+$/i.test(eventSlug)) {
    try {
      const markets = await client.getEventMarketsBySlug(eventSlug);
      const matched = markets.filter((market) => polymarketEventMarketMatchesRow(row, market, outcomeSlug));
      for (const market of matched) {
        const metadata = buildMetadataFromPayloads(row, [market.raw], `polymarket_gamma_event:${eventSlug}`);
        if (metadata) return { ok: true, metadata };
      }
      const event = await client.getEventBySlug(eventSlug);
      const eventMetadata = buildMetadataFromPayloads(row, [event], `polymarket_gamma_event:${eventSlug}`);
      if (eventMetadata) return { ok: true, metadata: eventMetadata };
    } catch {
      // Continue to the normal unresolved blocker below.
    }
  }
  return { ok: false, blockers: ["POLYMARKET_RULE_METADATA_NOT_FOUND"] };
};

const resolvePredictMetadata = async (
  row: VenueResolutionMetadataRow,
  adapter: Pick<PredictMarketAdapter, "getMarketById">
): Promise<{ ok: true; metadata: VenueResolutionMetadata } | { ok: false; blockers: string[] }> => {
  for (const identifier of predictIdentifiers(row)) {
    try {
      const market = await adapter.getMarketById(identifier);
      const metadata = buildMetadataFromPayloads(row, [market.raw, market], `predict_market_detail:${identifier}`);
      if (metadata) return { ok: true, metadata };
    } catch {
      continue;
    }
  }
  return { ok: false, blockers: ["PREDICT_RULE_METADATA_NOT_FOUND"] };
};

const resolveOpinionMetadata = async (
  row: VenueResolutionMetadataRow,
  client: Pick<OpinionClient, "getMarketById" | "getMarketBySlug" | "getCategoricalMarketById">
): Promise<{ ok: true; metadata: VenueResolutionMetadata } | { ok: false; blockers: string[] }> => {
  for (const identifier of genericIdentifiers(row)) {
    try {
      const detail = /^\d+$/.test(identifier)
        ? await client.getMarketById({ marketId: identifier })
        : await client.getMarketBySlug({ slug: identifier });
      const metadata = buildMetadataFromPayloads(row, [detail], `opinion_market_detail:${identifier}`);
      if (metadata) return { ok: true, metadata };
    } catch {
      try {
        if (/^\d+$/.test(identifier)) {
          const detail = await client.getCategoricalMarketById({ marketId: identifier });
          const metadata = buildMetadataFromPayloads(row, [detail], `opinion_categorical_market_detail:${identifier}`);
          if (metadata) return { ok: true, metadata };
        }
      } catch {
        continue;
      }
    }
  }
  return { ok: false, blockers: ["OPINION_RULE_METADATA_NOT_FOUND"] };
};

const resolveMyriadMetadata = async (
  row: VenueResolutionMetadataRow,
  client: Pick<MyriadClient, "getMarket">
): Promise<{ ok: true; metadata: VenueResolutionMetadata } | { ok: false; blockers: string[] }> => {
  for (const identifier of genericIdentifiers(row)) {
    try {
      const detail = await client.getMarket({ idOrSlug: identifier });
      const metadata = buildMetadataFromPayloads(row, [detail], `myriad_market_detail:${identifier}`);
      if (metadata) return { ok: true, metadata };
    } catch {
      continue;
    }
  }
  return { ok: false, blockers: ["MYRIAD_RULE_METADATA_NOT_FOUND"] };
};

export const buildMetadataFromPayloads = (
  row: Pick<VenueResolutionMetadataRow, "venue" | "title" | "venue_market_id">,
  payloads: readonly unknown[],
  fetchedBy: string
): VenueResolutionMetadata | null => {
  for (const payload of payloads) {
    const record = asRecord(payload);
    const rulesText = selectVenueRuleText(record, row.title);
    if (!rulesText) {
      continue;
    }
    const sourceText = selectVenueSourceText(record, row.venue) ?? extractResolutionSourceParagraph(rulesText);
    return {
      title: firstString(record.title, record.question, record.proxyTitle),
      rulesText,
      sourceText,
      sourceUrl: extractFirstUrl(sourceText ?? rulesText),
      fetchedBy,
      rawSourcePatch: {
        venueResolutionMetadata: sanitizePersistedMetadata(record, row.venue)
      },
      normalizedPatch: {
        venueResolutionMetadataSource: SOURCE,
        venueResolutionMetadataFetchedBy: fetchedBy
      }
    };
  }
  return null;
};

const applyVenueResolutionMetadata = async (
  pool: Pool,
  row: VenueResolutionMetadataRow,
  metadata: VenueResolutionMetadata,
  generatedAt: string
): Promise<void> => {
  const rawSourcePayload = {
    ...asRecord(row.raw_source_payload),
    ...metadata.rawSourcePatch
  };
  const normalizedPayload = {
    ...asRecord(row.normalized_payload),
    ...metadata.normalizedPatch,
    venueResolutionMetadataHydratedAt: generatedAt,
    ...(metadata.sourceUrl ? { sourceUrl: metadata.sourceUrl } : {})
  };
  const metadataPatch = {
    officialVenueRules: {
      fetchedBy: metadata.fetchedBy,
      sourceUrl: metadata.sourceUrl,
      hydratedAt: generatedAt
    }
  };

  await pool.query(
    `UPDATE venue_market_profiles
        SET description = $2,
            resolution_title = COALESCE($3, resolution_title),
            resolution_rules_text = $2,
            resolution_source = COALESCE($4, resolution_source),
            raw_source_payload = $5::jsonb,
            normalized_payload = $6::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [
      row.profile_id,
      metadata.rulesText,
      metadata.title,
      metadata.sourceText,
      JSON.stringify(rawSourcePayload),
      JSON.stringify(normalizedPayload)
    ]
  );

  await pool.query(
    `UPDATE venue_resolution_profiles
        SET resolution_title = COALESCE($2, resolution_title),
            resolution_source = COALESCE($3, resolution_source),
            rule_text = $4,
            metadata = metadata || $5::jsonb,
            updated_at = now()
      WHERE venue_market_profile_id = $1`,
    [row.profile_id, metadata.title, metadata.sourceText, metadata.rulesText, JSON.stringify(metadataPatch)]
  );

  await pool.query(
    `UPDATE resolution_profiles
        SET primary_resolution_text = $2,
            supplemental_rules_text = COALESCE($3, supplemental_rules_text),
            metadata = metadata || $4::jsonb,
            updated_at = now()
      WHERE venue = $1
        AND venue_market_id = $5`,
    [row.venue, metadata.rulesText, metadata.sourceText, JSON.stringify(metadataPatch), row.venue_market_id]
  );
};

const toArtifactRow = (
  row: VenueResolutionMetadataRow,
  status: VenueResolutionMetadataStatus,
  metadata: VenueResolutionMetadata | null,
  blockers: readonly string[]
): VenueResolutionMetadataArtifactRow => ({
  profileId: row.profile_id,
  canonicalEventId: row.canonical_event_id,
  canonicalMarketId: row.canonical_market_id,
  venue: normalizeVenue(row.venue),
  venueMarketId: row.venue_market_id,
  title: row.title,
  status,
  fetchedBy: metadata?.fetchedBy ?? null,
  rulePreview: metadata ? preview(metadata.rulesText) : null,
  sourcePreview: metadata?.sourceText ? preview(metadata.sourceText) : null,
  blockers: [...blockers]
});

const sanitizePersistedMetadata = (payload: Record<string, unknown>, venue: string): Record<string, unknown> => {
  const sourceUrl = extractFirstUrl(selectVenueSourceText(payload, venue) ?? selectVenueRuleText(payload, "") ?? null);
  return {
    venue,
    title: firstString(payload.title, payload.question, payload.proxyTitle),
    slug: firstString(payload.slug, payload.marketSlug, payload.market_slug),
    description: selectVenueRuleText(payload, ""),
    resolutionSource: selectVenueSourceText(payload, venue),
    ...(sourceUrl ? { sourceUrl } : {})
  };
};

const selectVenueRuleText = (payload: Record<string, unknown>, title: string): string | null => {
  const normalizedTitle = normalizeComparableText(title);
  for (const candidate of collectStringFields(payload, RULE_TEXT_FIELDS, 4)) {
    const sanitized = sanitizeRuleText(candidate);
    if (!sanitized) continue;
    const normalized = normalizeComparableText(sanitized);
    if (!normalized || (normalizedTitle && normalized === normalizedTitle) || looksLikeGeneratedPlaceholderRule(normalized)) {
      continue;
    }
    if (looksLikeVenueResolutionRule(sanitized)) {
      return sanitized;
    }
  }
  return null;
};

const selectVenueSourceText = (payload: Record<string, unknown>, venue: string): string | null => {
  for (const candidate of collectStringFields(payload, SOURCE_TEXT_FIELDS, 4)) {
    const sanitized = sanitizeVenueSourceText(candidate, venue);
    if (sanitized) return sanitized;
  }
  return null;
};

const isTrustedVenueRuleText = (value: string | null | undefined, title: string | null | undefined): boolean =>
  selectVenueRuleText({ value }, title ?? "") !== null;

const sanitizeRuleText = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const stripped = stripHtml(value);
  if (!stripped || stripped.length < 40) return null;
  return stripped;
};

const sanitizeVenueSourceText = (value: string | null | undefined, venue: string): string | null => {
  if (!value) return null;
  const stripped = stripHtml(value);
  if (!stripped) return null;
  const normalized = normalizeComparableText(stripped);
  if (venueSourceAliases(venue).has(normalized) || SOURCE_LABEL_BLOCKLIST.has(normalized)) {
    return null;
  }
  if (extractFirstUrl(stripped)) return stripped;
  return /\b(source|oracle|resolver|according|official|resolution|settlement|rules)\b/i.test(stripped)
    ? stripped
    : null;
};

const SOURCE_LABEL_BLOCKLIST = new Set([
  "opinion openapi market",
  "predict market metadata",
  "limitless public market surface",
  "limitless public market detail",
  "limitless persisted market detail"
]);

const extractResolutionSourceParagraph = (rulesText: string): string | null => {
  const paragraphs = rulesText
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const matched = paragraphs.filter((paragraph) =>
    /\b(resolution source|source for this market|according to|official source|settlement source|oracle)\b/i.test(paragraph)
  );
  return matched.length > 0 ? matched.join("\n\n") : null;
};

const stripHtml = (value: string): string | null => {
  const stripped = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, "\"")
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/\u00e2\u20ac[\u0153\u009d]/g, "\"")
    .replace(/\u00e2\u20ac[\u02dc\u2122]/g, "'")
    .replace(/\u00e2\u20ac[\u201c\u201d]/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped.length > 0 ? stripped : null;
};

const collectStringFields = (
  value: unknown,
  fieldNames: readonly string[],
  depth: number
): string[] => {
  if (depth < 0 || typeof value === "string") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringFields(entry, fieldNames, depth - 1));
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return [];
  const direct = fieldNames.flatMap((field) => {
    const candidate = record[field];
    return typeof candidate === "string" && candidate.trim().length > 0 ? [candidate] : [];
  });
  const nested = Object.values(record).flatMap((entry) => collectStringFields(entry, fieldNames, depth - 1));
  return [...direct, ...nested];
};

const genericIdentifiers = (row: VenueResolutionMetadataRow): string[] => uniqueNonEmptyStrings([
  ...extractPrefixedVenueMarketSegments(row.venue, row.venue_market_id),
  row.venue_market_id.includes(":") ? null : row.venue_market_id,
  firstString(asRecord(row.normalized_payload).marketId, asRecord(row.raw_source_payload).marketId),
  firstString(asRecord(row.normalized_payload).slug, asRecord(row.raw_source_payload).slug),
  firstString(asRecord(row.normalized_payload).marketSlug, asRecord(row.raw_source_payload).marketSlug)
]);

const limitlessIdentifiers = (row: VenueResolutionMetadataRow): string[] => uniqueNonEmptyStrings([
  ...genericIdentifiers(row),
  firstString(asRecord(asRecord(row.raw_source_payload).marketDetail).slug),
  firstString(asRecord(asRecord(row.raw_source_payload).limitlessMarketDetail).slug),
  firstString(asRecord(asRecord(row.normalized_payload).marketDetail).slug),
  firstString(asRecord(asRecord(row.normalized_payload).limitlessMarketDetail).slug),
  firstString(asRecord(row.normalized_payload).marketDetailSlug, asRecord(row.raw_source_payload).marketDetailSlug),
  firstString(asRecord(row.normalized_payload).address, asRecord(row.raw_source_payload).address)
]);

const predictIdentifiers = (row: VenueResolutionMetadataRow): string[] => uniqueNonEmptyStrings([
  ...genericIdentifiers(row).filter((identifier) => !identifier.includes("|")),
  row.venue_market_id.match(/^PREDICT(?::FUN)?:([^:]+)/i)?.[1] ?? null
]);

const polymarketEventMarketMatchesRow = (
  row: VenueResolutionMetadataRow,
  market: { title: string; marketSlug: string | null },
  outcomeSlug: string | null | undefined
): boolean => {
  const marketText = normalizeComparableText(`${market.title} ${market.marketSlug ?? ""}`);
  const rowText = normalizeComparableText(`${row.title} ${row.venue_market_id}`);
  const outcomeText = normalizeComparableText(outcomeSlug ?? "");
  if (outcomeText && allWordsIncluded(marketText, outcomeText)) {
    return true;
  }
  const titleSuffix = normalizeComparableText(row.title.split(":").slice(1).join(":"));
  if (titleSuffix && allWordsIncluded(marketText, titleSuffix)) {
    return true;
  }
  return Boolean(marketText && rowText.includes(marketText));
};

const uniqueNonEmptyStrings = (values: readonly (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
};

const normalizeVenue = (value: string): VenueResolutionMetadataVenue => {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized as VenueResolutionMetadataVenue;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const normalizeComparableText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const allWordsIncluded = (haystack: string, needle: string): boolean => {
  const words = needle.split(/\s+/).filter((word) => word.length > 1);
  return words.length > 0 && words.every((word) => haystack.includes(word));
};

const looksLikeVenueResolutionRule = (value: string): boolean =>
  /\b(resolve|resolves|resolution|source|oracle|settle|settlement|outcome|according|will be considered|will not be considered|if|unless|void|cancel|refund)\b/i.test(value);

const looksLikeGeneratedPlaceholderRule = (normalized: string): boolean =>
  /^(ath|fdv|token launch|first to hit|price|winner|nominee|champion|launch) by date\b/.test(normalized)
  || /^(ath|fdv|token launch|first to hit|price|winner|nominee|champion|launch)\b(?: [a-z0-9]+){0,8} \d{4} \d{2} \d{2}(?: \d{4} \d{2} \d{2})?$/.test(normalized);

const venueSourceAliases = (venue: string): ReadonlySet<string> => {
  const normalized = normalizeComparableText(venue);
  const aliases = new Set([normalized]);
  if (normalized === "predict" || normalized === "predict fun" || normalized === "predict_fun") {
    aliases.add("predict");
    aliases.add("predict fun");
  }
  return aliases;
};

const extractFirstUrl = (text: string | null): string | null => {
  const match = text?.match(/https?:\/\/[^\s"',)]+/i);
  return match?.[0] ?? null;
};

const preview = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 240);

const incrementBlockers = (counts: Map<string, number>, blockers: readonly string[]): void => {
  for (const blocker of blockers) {
    counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
  }
};

const mapConcurrent = async <T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const output: R[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index]!);
    }
  }));
  return output;
};
