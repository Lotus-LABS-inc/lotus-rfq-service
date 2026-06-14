import type { Pool } from "pg";

export interface EventReviewCanonicalRow {
  canonicalEventId: string;
  propositionKey: string;
  title: string;
  frontendDisplayTitle: string | null;
  category: string;
  status: "APPROVED" | "HIDDEN" | "DISABLED" | "PENDING" | "CLOSED";
  canonicalMarketIds: string[];
  venues: string[];
  expiresAt: string | null;
  resolvesAt: string | null;
  updatedAt: string;
}

export interface EventReviewVenueRuleRow {
  canonicalEventId: string;
  venue: string;
  venueMarketId: string;
  marketClass: string;
  rulesText: string | null;
  resolutionSource: string | null;
  resolutionTitle: string | null;
}

export interface EventReviewFilter {
  category?: string | undefined;
  search?: string | undefined;
  status?: "APPROVED" | "HIDDEN" | "DISABLED" | "PENDING" | "CLOSED" | undefined;
  includeExpired?: boolean | undefined;
}

interface CanonicalRow {
  canonical_event_id: string;
  proposition_key: string;
  title: string;
  frontend_display_title: string | null;
  category: string;
  status: EventReviewCanonicalRow["status"];
  canonical_market_ids: string[];
  venues: string[];
  expires_at: string | null;
  resolves_at: string | null;
  updated_at: string;
}

const MAX_EVENTS = 2000;

/**
 * Read-only source for the event-centric matching review. Returns canonical events (with
 * their venues, status, and canonical_market_ids for display-grouping) plus per-venue
 * resolution rules so the reviewer can compare rules side by side.
 */
export class MarketEventReviewRepository {
  public constructor(private readonly pool: Pool) {}

  public async listCanonicalEvents(filter: EventReviewFilter = {}): Promise<EventReviewCanonicalRow[]> {
    const conditions: string[] = [
      `EXISTS (SELECT 1 FROM venue_market_profiles v WHERE v.canonical_event_id = ce.id)`
    ];
    const params: unknown[] = [];
    if (filter.status === "CLOSED") {
      conditions.push(`ce.resolves_at IS NOT NULL AND ce.resolves_at < NOW()`);
    } else if (!filter.includeExpired) {
      conditions.push(`(
        (ce.resolves_at IS NULL OR ce.resolves_at > NOW())
        AND (ce.expires_at IS NULL OR ce.expires_at > NOW())
      )`);
    }
    if (filter.status && filter.status !== "CLOSED") {
      params.push(filter.status);
      conditions.push(`COALESCE(fma.status, 'PENDING') = $${params.length}`);
    }
    if (filter.category?.trim()) {
      params.push(filter.category.trim().toUpperCase());
      conditions.push(`ce.canonical_category = $${params.length}`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim().toLowerCase()}%`);
      conditions.push(`(lower(ce.title) LIKE $${params.length} OR lower(ce.proposition_key) LIKE $${params.length})`);
    }
    const result = await this.pool.query<CanonicalRow>(
      `SELECT
          ce.id::text AS canonical_event_id,
          ce.proposition_key,
          ce.title,
          fma.display_title AS frontend_display_title,
          ce.canonical_category AS category,
          CASE
            WHEN ce.resolves_at IS NOT NULL AND ce.resolves_at < NOW() THEN 'CLOSED'
            ELSE COALESCE(fma.status, 'PENDING')
          END AS status,
          COALESCE(array_agg(DISTINCT cem.id) FILTER (WHERE cem.id IS NOT NULL), '{}') AS canonical_market_ids,
          COALESCE(array_agg(DISTINCT vmp.venue) FILTER (WHERE vmp.venue IS NOT NULL), '{}') AS venues,
          ce.expires_at::text AS expires_at,
          ce.resolves_at::text AS resolves_at,
          ce.updated_at::text AS updated_at
         FROM canonical_events ce
         LEFT JOIN frontend_market_approvals fma ON fma.canonical_event_id = ce.id
         LEFT JOIN canonical_executable_markets cem ON cem.canonical_event_id = ce.id
         LEFT JOIN venue_market_profiles vmp ON vmp.canonical_event_id = ce.id
        WHERE ${conditions.join(" AND ")}
        GROUP BY ce.id, fma.status, fma.display_title
        ORDER BY ce.canonical_category ASC, ce.title ASC
        LIMIT ${MAX_EVENTS}`,
      params
    );
    return result.rows.map((row) => ({
      canonicalEventId: row.canonical_event_id,
      propositionKey: row.proposition_key,
      title: row.title,
      frontendDisplayTitle: row.frontend_display_title,
      category: row.category,
      status: row.status,
      canonicalMarketIds: Array.isArray(row.canonical_market_ids) ? row.canonical_market_ids : [],
      venues: Array.isArray(row.venues) ? row.venues : [],
      expiresAt: row.expires_at,
      resolvesAt: row.resolves_at,
      updatedAt: row.updated_at
    }));
  }

  /** Map of canonicalEventId -> proposition_key, for deriving event grouping keys. */
  public async getPropositionKeys(canonicalEventIds: readonly string[]): Promise<Map<string, string>> {
    if (canonicalEventIds.length === 0) {
      return new Map();
    }
    const result = await this.pool.query<{ id: string; proposition_key: string }>(
      `SELECT id::text AS id, proposition_key FROM canonical_events WHERE id = ANY($1::uuid[])`,
      [canonicalEventIds]
    );
    return new Map(result.rows.map((row) => [row.id, row.proposition_key]));
  }

  public async listVenueRules(canonicalEventIds: readonly string[]): Promise<EventReviewVenueRuleRow[]> {
    if (canonicalEventIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<{
      canonical_event_id: string;
      venue: string;
      venue_market_id: string;
      market_class: string;
      rules_text: string | null;
      resolution_source: string | null;
      resolution_title: string | null;
    }>(
      `SELECT
          vmp.canonical_event_id::text AS canonical_event_id,
          vmp.venue,
          vmp.venue_market_id,
          vmp.market_class,
          COALESCE(vrp.rule_text, vmp.resolution_rules_text) AS rules_text,
          COALESCE(vrp.resolution_source, vmp.resolution_source) AS resolution_source,
          COALESCE(vrp.resolution_title, vmp.resolution_title) AS resolution_title
         FROM venue_market_profiles vmp
         LEFT JOIN venue_resolution_profiles vrp ON vrp.venue_market_profile_id = vmp.id
        WHERE vmp.canonical_event_id = ANY($1::uuid[])
        ORDER BY vmp.venue, vmp.venue_market_id`,
      [canonicalEventIds]
    );
    return result.rows.map((row) => ({
      canonicalEventId: row.canonical_event_id,
      venue: row.venue === "PREDICT" ? "PREDICT_FUN" : row.venue,
      venueMarketId: row.venue_market_id,
      marketClass: row.market_class,
      rulesText: row.rules_text,
      resolutionSource: row.resolution_source,
      resolutionTitle: row.resolution_title
    }));
  }
}
