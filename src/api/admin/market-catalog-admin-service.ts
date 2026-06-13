import {
  FrontendMarketApprovalRepository,
  type AdminCatalogEventRow,
  type FrontendApprovalStatus
} from "../../repositories/frontend-market-approval.repository.js";
import { deriveCuratedEventGroup } from "../../repositories/market-catalog.repository.js";

export class MarketCatalogAdminServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketCatalogAdminServiceError";
  }
}

// Operator-facing status labels. LIVE = visible to users; PAUSED = temporarily hidden;
// DISABLED = explicitly turned off; PENDING = no approval decision yet;
// CLOSED = past resolves_at (derived, never written to DB).
export type MarketCatalogStatus = "LIVE" | "PAUSED" | "DISABLED" | "PENDING" | "CLOSED";

const DB_TO_FRIENDLY: Record<FrontendApprovalStatus, MarketCatalogStatus> = {
  APPROVED: "LIVE",
  HIDDEN: "PAUSED",
  DISABLED: "DISABLED",
  PENDING: "PENDING",
  CLOSED: "CLOSED"
};

const FRIENDLY_TO_DB: Record<Exclude<MarketCatalogStatus, "CLOSED">, FrontendApprovalStatus> = {
  LIVE: "APPROVED",
  PAUSED: "HIDDEN",
  DISABLED: "DISABLED",
  PENDING: "PENDING"
};

export interface MarketCatalogAdminEvent {
  canonicalEventId: string;
  title: string;
  propositionKey: string;
  eventGroupKey: string | null;
  eventGroupTitle: string | null;
  category: string;
  status: MarketCatalogStatus;
  displayTitle: string | null;
  venues: string[];
  venueCount: number;
  venueMarketCount: number;
  executableMarketCount: number;
  hasCrossVenue: boolean;
  approvedBy: string | null;
  approvalReason: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  resolvesAt: string | null;
  updatedAt: string;
}

export interface MarketCatalogAdminSummary {
  total: number;
  live: number;
  paused: number;
  pending: number;
  disabled: number;
  closed: number;
}

export interface MarketCatalogListInput {
  status?: MarketCatalogStatus | undefined;
  // CLOSED is a read-only derived status — passing it lists expired events.
  category?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

const stripSourcePrefix = (key: string): string => {
  const colon = key.indexOf(":");
  return colon >= 0 ? key.slice(colon + 1) : key;
};

const toFriendlyEvent = (row: AdminCatalogEventRow): MarketCatalogAdminEvent => {
  const group = deriveCuratedEventGroup(stripSourcePrefix(row.propositionKey));
  return {
  canonicalEventId: row.canonicalEventId,
  title: row.displayTitle?.trim() || row.title,
  propositionKey: row.propositionKey,
  eventGroupKey: group?.eventId ?? null,
  eventGroupTitle: group?.title ?? null,
  category: row.category,
  status: DB_TO_FRIENDLY[row.status],
  displayTitle: row.displayTitle,
  venues: row.venues,
  venueCount: row.venues.length,
  venueMarketCount: row.venueMarketCount,
  executableMarketCount: row.executableMarketCount,
  hasCrossVenue: row.hasCrossVenue,
  approvedBy: row.approvedBy,
  approvalReason: row.approvalReason,
  approvedAt: row.approvedAt,
  expiresAt: row.expiresAt,
  resolvesAt: row.resolvesAt,
  updatedAt: row.updatedAt
  };
};

/**
 * Operator surface for the live-events catalog: list events with their LIVE/PAUSED/
 * PENDING status, and pause/resume their user-facing visibility. Pause/resume write to
 * frontend_market_approvals; nothing here touches the canonical graph or trading state.
 */
export class MarketCatalogAdminService {
  constructor(private readonly repository: FrontendMarketApprovalRepository) {}

  async listEvents(input: MarketCatalogListInput = {}): Promise<{ events: MarketCatalogAdminEvent[] }> {
    const dbStatus = input.status
      ? (input.status === "CLOSED" ? "CLOSED" : FRIENDLY_TO_DB[input.status])
      : undefined;
    const rows = await this.repository.listEventCatalog({
      status: dbStatus,
      category: input.category,
      search: input.search,
      limit: input.limit,
      offset: input.offset
    });
    return { events: rows.map(toFriendlyEvent) };
  }

  async getSummary(): Promise<MarketCatalogAdminSummary> {
    const counts = await this.repository.getStatusCounts();
    return {
      total: counts.APPROVED + counts.HIDDEN + counts.DISABLED + counts.PENDING + counts.CLOSED,
      live: counts.APPROVED,
      paused: counts.HIDDEN,
      pending: counts.PENDING,
      disabled: counts.DISABLED,
      closed: counts.CLOSED
    };
  }

  async getEvent(canonicalEventId: string): Promise<MarketCatalogAdminEvent> {
    const row = await this.repository.getEvent(canonicalEventId);
    if (!row) {
      throw new MarketCatalogAdminServiceError(`Canonical event '${canonicalEventId}' not found.`);
    }
    return toFriendlyEvent(row);
  }

  async pause(canonicalEventId: string, actor: string, reason: string): Promise<MarketCatalogAdminEvent> {
    return this.setStatus(canonicalEventId, "HIDDEN", actor, reason);
  }

  async resume(canonicalEventId: string, actor: string, reason: string): Promise<MarketCatalogAdminEvent> {
    return this.setStatus(canonicalEventId, "APPROVED", actor, reason);
  }

  async disable(canonicalEventId: string, actor: string, reason: string): Promise<MarketCatalogAdminEvent> {
    return this.setStatus(canonicalEventId, "DISABLED", actor, reason);
  }

  private async setStatus(
    canonicalEventId: string,
    status: "APPROVED" | "HIDDEN" | "DISABLED",
    actor: string,
    reason: string
  ): Promise<MarketCatalogAdminEvent> {
    // Guard: only allow status changes on events that actually exist in the catalog.
    const existing = await this.repository.getEvent(canonicalEventId);
    if (!existing) {
      throw new MarketCatalogAdminServiceError(`Canonical event '${canonicalEventId}' not found.`);
    }
    const updated = await this.repository.setStatus({ canonicalEventId, status, approvedBy: actor, reason });
    if (!updated) {
      throw new MarketCatalogAdminServiceError(`Failed to update status for canonical event '${canonicalEventId}'.`);
    }
    return toFriendlyEvent(updated);
  }
}
