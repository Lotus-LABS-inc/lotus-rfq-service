import type { Pool } from "pg";

// Source tag the public market catalog requires (MarketCatalogRepository filters on
// fma.metadata->>'source' = this value). Resuming/approving an event sets it so the
// market actually becomes visible to users; pausing only flips status to HIDDEN.
export const FRONTEND_CURATED_CATALOG_SOURCE = "frontend-curated-catalog";

// DB-level statuses on frontend_market_approvals. "PENDING" is synthetic: it means no
// approval row exists yet for the event. "CLOSED" is derived at query time when
// canonical_events.resolves_at < NOW() — it is never written to the DB.
export type FrontendApprovalDbStatus = "APPROVED" | "HIDDEN" | "DISABLED" | "PENDING";
export type FrontendApprovalStatus = FrontendApprovalDbStatus | "CLOSED";

export interface AdminCatalogEventRow {
  canonicalEventId: string;
  title: string;
  propositionKey: string;
  category: string;
  status: FrontendApprovalStatus;
  displayTitle: string | null;
  sortPriority: number | null;
  approvedBy: string | null;
  approvalReason: string | null;
  approvedAt: string | null;
  venues: string[];
  venueMarketCount: number;
  executableMarketCount: number;
  hasCrossVenue: boolean;
  expiresAt: string | null;
  resolvesAt: string | null;
  updatedAt: string;
}

export interface AdminCatalogListFilter {
  status?: FrontendApprovalStatus | undefined;
  category?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

interface CatalogRow {
  canonical_event_id: string;
  title: string;
  proposition_key: string;
  category: string;
  status: FrontendApprovalStatus;
  display_title: string | null;
  sort_priority: number | null;
  approved_by: string | null;
  approval_reason: string | null;
  approved_at: string | null;
  venues: string[];
  venue_market_count: string;
  executable_market_count: string;
  expires_at: string | null;
  resolves_at: string | null;
  updated_at: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const clampLimit = (limit?: number): number => {
  if (!Number.isFinite(limit) || limit === undefined) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
};

const clampOffset = (offset?: number): number => {
  if (!Number.isFinite(offset) || offset === undefined) {
    return 0;
  }
  return Math.max(0, Math.floor(offset));
};

const toEvent = (row: CatalogRow): AdminCatalogEventRow => {
  const venues = Array.isArray(row.venues) ? row.venues.filter((value): value is string => typeof value === "string") : [];
  return {
    canonicalEventId: row.canonical_event_id,
    title: row.title,
    propositionKey: row.proposition_key,
    category: row.category,
    status: row.status,
    displayTitle: row.display_title,
    sortPriority: row.sort_priority,
    approvedBy: row.approved_by,
    approvalReason: row.approval_reason,
    approvedAt: row.approved_at,
    venues,
    venueMarketCount: Number(row.venue_market_count),
    executableMarketCount: Number(row.executable_market_count),
    hasCrossVenue: venues.length > 1,
    expiresAt: row.expires_at,
    resolvesAt: row.resolves_at,
    updatedAt: row.updated_at
  };
};

/**
 * Admin-facing read/write access to per-event frontend visibility. Unlike
 * MarketCatalogRepository (which only serves APPROVED + curated markets to users), this
 * surfaces every real canonical event with its current status — including PENDING events
 * that have no approval row yet — and lets an operator pause/resume them.
 */
export class FrontendMarketApprovalRepository {
  public constructor(private readonly pool: Pool) {}

  public async listEventCatalog(filter: AdminCatalogListFilter = {}): Promise<AdminCatalogEventRow[]> {
    const limit = clampLimit(filter.limit);
    const offset = clampOffset(filter.offset);
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Only real events: at least one venue market or executable market.
    conditions.push(`(
      EXISTS (SELECT 1 FROM venue_market_profiles vmp2 WHERE vmp2.canonical_event_id = ce.id)
      OR EXISTS (SELECT 1 FROM canonical_executable_markets cem2 WHERE cem2.canonical_event_id = ce.id)
    )`);

    if (filter.status === "CLOSED") {
      conditions.push(`(ce.resolves_at IS NOT NULL AND ce.resolves_at < NOW())`);
    } else if (filter.status) {
      params.push(filter.status);
      conditions.push(`(ce.resolves_at IS NULL OR ce.resolves_at >= NOW()) AND COALESCE(fma.status, 'PENDING') = $${params.length}`);
    } else {
      // Default: exclude closed markets so they don't clutter other tabs.
      conditions.push(`(ce.resolves_at IS NULL OR ce.resolves_at >= NOW())`);
    }
    if (filter.category?.trim()) {
      params.push(filter.category.trim().toUpperCase());
      conditions.push(`ce.canonical_category = $${params.length}`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim().toLowerCase()}%`);
      conditions.push(`(lower(ce.title) LIKE $${params.length} OR lower(ce.proposition_key) LIKE $${params.length})`);
    }

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<CatalogRow>(
      `SELECT
          ce.id::text AS canonical_event_id,
          ce.title,
          ce.proposition_key,
          ce.canonical_category AS category,
          CASE
            WHEN ce.resolves_at IS NOT NULL AND ce.resolves_at < NOW() THEN 'CLOSED'
            ELSE COALESCE(fma.status, 'PENDING')
          END AS status,
          fma.display_title,
          fma.sort_priority,
          fma.approved_by,
          fma.approval_reason,
          fma.approved_at::text AS approved_at,
          ce.expires_at::text AS expires_at,
          ce.resolves_at::text AS resolves_at,
          ce.updated_at::text AS updated_at,
          COALESCE(array_agg(DISTINCT vmp.venue) FILTER (WHERE vmp.venue IS NOT NULL), '{}') AS venues,
          COUNT(DISTINCT vmp.id)::text AS venue_market_count,
          COUNT(DISTINCT cem.id)::text AS executable_market_count
         FROM canonical_events ce
         LEFT JOIN frontend_market_approvals fma ON fma.canonical_event_id = ce.id
         LEFT JOIN venue_market_profiles vmp ON vmp.canonical_event_id = ce.id
         LEFT JOIN canonical_executable_markets cem ON cem.canonical_event_id = ce.id
         ${where}
         GROUP BY ce.id, fma.status, fma.display_title, fma.sort_priority, fma.approved_by, fma.approval_reason, fma.approved_at
         ORDER BY COALESCE(fma.sort_priority, 1000) ASC,
                  COALESCE(ce.expires_at, ce.resolves_at, ce.updated_at) DESC,
                  ce.title ASC
         LIMIT ${limitParam}
         OFFSET ${offsetParam}`,
      params
    );
    return result.rows.map(toEvent);
  }

  public async getStatusCounts(): Promise<Record<FrontendApprovalStatus, number>> {
    const result = await this.pool.query<{ status: FrontendApprovalStatus; count: string }>(
      `SELECT
          CASE
            WHEN ce.resolves_at IS NOT NULL AND ce.resolves_at < NOW() THEN 'CLOSED'
            ELSE COALESCE(fma.status, 'PENDING')
          END AS status,
          COUNT(*)::text AS count
         FROM canonical_events ce
         LEFT JOIN frontend_market_approvals fma ON fma.canonical_event_id = ce.id
        WHERE EXISTS (SELECT 1 FROM venue_market_profiles vmp WHERE vmp.canonical_event_id = ce.id)
           OR EXISTS (SELECT 1 FROM canonical_executable_markets cem WHERE cem.canonical_event_id = ce.id)
        GROUP BY 1`
    );
    const counts: Record<FrontendApprovalStatus, number> = { APPROVED: 0, HIDDEN: 0, DISABLED: 0, PENDING: 0, CLOSED: 0 };
    for (const row of result.rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  public async getEvent(canonicalEventId: string): Promise<AdminCatalogEventRow | null> {
    const result = await this.pool.query<CatalogRow>(
      `SELECT
          ce.id::text AS canonical_event_id,
          ce.title,
          ce.proposition_key,
          ce.canonical_category AS category,
          CASE
            WHEN ce.resolves_at IS NOT NULL AND ce.resolves_at < NOW() THEN 'CLOSED'
            ELSE COALESCE(fma.status, 'PENDING')
          END AS status,
          fma.display_title,
          fma.sort_priority,
          fma.approved_by,
          fma.approval_reason,
          fma.approved_at::text AS approved_at,
          ce.expires_at::text AS expires_at,
          ce.resolves_at::text AS resolves_at,
          ce.updated_at::text AS updated_at,
          COALESCE(array_agg(DISTINCT vmp.venue) FILTER (WHERE vmp.venue IS NOT NULL), '{}') AS venues,
          COUNT(DISTINCT vmp.id)::text AS venue_market_count,
          COUNT(DISTINCT cem.id)::text AS executable_market_count
         FROM canonical_events ce
         LEFT JOIN frontend_market_approvals fma ON fma.canonical_event_id = ce.id
         LEFT JOIN venue_market_profiles vmp ON vmp.canonical_event_id = ce.id
         LEFT JOIN canonical_executable_markets cem ON cem.canonical_event_id = ce.id
        WHERE ce.id::text = $1
        GROUP BY ce.id, fma.status, fma.display_title, fma.sort_priority, fma.approved_by, fma.approval_reason, fma.approved_at`,
      [canonicalEventId]
    );
    const [row] = result.rows;
    return row ? toEvent(row) : null;
  }

  /**
   * Upsert an event's visibility status. APPROVED additionally stamps the curated source
   * tag so the public catalog will surface it; other statuses preserve existing metadata.
   */
  public async setStatus(input: {
    canonicalEventId: string;
    status: "APPROVED" | "HIDDEN" | "DISABLED";
    approvedBy: string;
    reason: string;
  }): Promise<AdminCatalogEventRow | null> {
    const metadataMerge = input.status === "APPROVED"
      ? `jsonb_build_object('source', '${FRONTEND_CURATED_CATALOG_SOURCE}')`
      : `'{}'::jsonb`;
    const result = await this.pool.query<{ canonical_event_id: string }>(
      `INSERT INTO frontend_market_approvals
          (canonical_event_id, status, approved_by, approval_reason, metadata, approved_at, updated_at)
        VALUES ($1, $2, $3, $4, ${metadataMerge}, now(), now())
        ON CONFLICT (canonical_event_id) DO UPDATE
          SET status = EXCLUDED.status,
              approved_by = EXCLUDED.approved_by,
              approval_reason = EXCLUDED.approval_reason,
              metadata = frontend_market_approvals.metadata || ${metadataMerge},
              updated_at = now()
        RETURNING canonical_event_id::text AS canonical_event_id`,
      [input.canonicalEventId, input.status, input.approvedBy, input.reason]
    );
    if (result.rowCount === 0) {
      return null;
    }
    return this.getEvent(input.canonicalEventId);
  }
}
