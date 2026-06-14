import type { Pool } from "pg";

import { CanonicalGraphProjector } from "../../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import { buildStableTextId, buildStableUuid } from "../../canonical/canonicalization-types.js";
import type { CanonicalCategory, CanonicalVenue, CanonicalOutcomeDefinition } from "../../canonical/canonicalization-types.js";
import { CanonicalCompatibilityRepository } from "../../repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../repositories/compatibility-version.repository.js";
import {
  FrontendMarketApprovalRepository,
  type AdminCatalogEventRow
} from "../../repositories/frontend-market-approval.repository.js";

export class CuratedMarketAdminServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CuratedMarketAdminServiceError";
  }
}

export interface CreateMarketInput {
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string;
  category: CanonicalCategory;
  marketClass?: string | undefined;
  outcomes?: ReadonlyArray<{ id: string; label: string }> | undefined;
  expiresAt?: string | undefined;
  resolvesAt?: string | undefined;
  resolutionSource?: string | undefined;
  resolutionTitle?: string | undefined;
  resolutionRulesText?: string | undefined;
  makeLive?: boolean | undefined;
  reason: string;
}

export interface CreateMarketResult {
  canonicalEventId: string;
  canonicalMarketId: string;
  status: "LIVE" | "PENDING";
  event: AdminCatalogEventRow;
}

export interface CrossVenueMarketMember {
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string;
  outcomes?: ReadonlyArray<{ id: string; label: string }> | undefined;
  resolutionRulesText?: string | undefined;
  resolutionSource?: string | undefined;
}

export interface ProjectCrossVenueMarketInput {
  eventTitle: string;
  category: CanonicalCategory;
  marketClass?: string | undefined;
  eventPropositionKey?: string | undefined;
  expiresAt?: string | undefined;
  resolvesAt?: string | undefined;
  members: ReadonlyArray<CrossVenueMarketMember>;
}

export interface ProjectCrossVenueMarketResult {
  canonicalEventId: string;
  canonicalMarketIds: string[];
}

const toDate = (value: string | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Operator "add new market" flow. Builds a curated seed and projects it through the
 * sanctioned CanonicalGraphProjector (which computes proposition fingerprints, resolution/
 * settlement profiles, and persists transactionally) — never raw inserts. Optionally makes
 * the new event user-visible. Requires ADMIN+2FA at the route layer.
 */
export class CuratedMarketAdminService {
  private readonly snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  private readonly projector: CanonicalGraphProjector;
  private readonly approvalRepository: FrontendMarketApprovalRepository;

  constructor(private readonly pool: Pool) {
    this.projector = new CanonicalGraphProjector(
      new CanonicalGraphRepository(pool),
      new CanonicalCompatibilityProjector(
        new CanonicalCompatibilityRepository(pool),
        new CompatibilityVersionRepository(pool)
      )
    );
    this.approvalRepository = new FrontendMarketApprovalRepository(pool);
  }

  async createMarket(input: CreateMarketInput, actor: string): Promise<CreateMarketResult> {
    const key = `${input.venue}:${input.venueMarketId}`;
    const canonicalEventId = buildStableUuid(`operator-curated-event:${key}`);
    const canonicalMarketId = buildStableTextId("operator-curated-market-", key);

    const outcomes: CanonicalOutcomeDefinition[] | undefined = input.outcomes?.map((outcome) => ({
      id: outcome.id,
      label: outcome.label
    }));

    const seed: CuratedCanonicalGraphSeed = {
      canonicalEventId,
      canonicalMarketId,
      canonicalCategory: input.category,
      venue: input.venue,
      venueMarketId: input.venueMarketId,
      title: input.title,
      marketClass: input.marketClass ?? "BINARY",
      ...(outcomes ? { outcomes } : {}),
      publishedAt: new Date(),
      expiresAt: toDate(input.expiresAt),
      resolvesAt: toDate(input.resolvesAt),
      resolutionSource: input.resolutionSource ?? null,
      resolutionTitle: input.resolutionTitle ?? null,
      resolutionRulesText: input.resolutionRulesText ?? null,
      sourceMetadataVersion: "operator-curated-v1",
      mappingLineage: ["operator-add-market"],
      eventMetadata: { source: "operator-add-market", createdBy: actor }
    };

    const snapshot = this.snapshotBuilder.build([seed]);
    if (snapshot.canonicalEvents.length === 0 || snapshot.venueMarketProfiles.length === 0) {
      throw new CuratedMarketAdminServiceError(
        "The supplied market could not be normalized into a canonical seed (check title/category/venue)."
      );
    }
    await this.projector.persistAndProject(snapshot);

    if (input.makeLive) {
      await this.approvalRepository.setStatus({
        canonicalEventId,
        status: "APPROVED",
        approvedBy: actor,
        reason: input.reason
      });
    }

    const event = await this.approvalRepository.getEvent(canonicalEventId);
    if (!event) {
      throw new CuratedMarketAdminServiceError(
        "Market was projected but could not be read back; verify the canonical graph state."
      );
    }
    return {
      canonicalEventId,
      canonicalMarketId,
      status: input.makeLive ? "LIVE" : "PENDING",
      event
    };
  }

  /**
   * Project a cross-venue NEW_DISCOVERY candidate into the canonical graph: one shared
   * canonical event with each venue as its OWN single-member executable market. We do NOT pool
   * the venues into a single executable market here — that requires an EQUIVALENT compatibility
   * edge and stays gated by pair-match review. This only makes the event exist (and become
   * visible once approved); it does not assert cross-venue routeability. Projection only — the
   * caller writes the frontend approval (so the source tag is stamped consistently).
   */
  async projectCrossVenueMarket(input: ProjectCrossVenueMarketInput, actor: string): Promise<ProjectCrossVenueMarketResult> {
    const members = input.members.filter((member) => member.venue && member.venueMarketId);
    if (members.length < 2) {
      throw new CuratedMarketAdminServiceError("A cross-venue market needs at least two venue members.");
    }
    const eventKey = members.map((member) => `${member.venue}:${member.venueMarketId}`).sort().join("|");
    const canonicalEventId = await this.resolveDiscoveryCanonicalEventId(input.eventPropositionKey, eventKey);
    const expiresAt = toDate(input.expiresAt);
    const resolvesAt = toDate(input.resolvesAt);

    const seeds: CuratedCanonicalGraphSeed[] = members.map((member) => {
      const memberKey = `${member.venue}:${member.venueMarketId}`;
      const outcomes: CanonicalOutcomeDefinition[] | undefined = member.outcomes?.map((outcome) => ({
        id: outcome.id,
        label: outcome.label
      }));
      return {
        canonicalEventId,
        // Distinct executable market per venue → no cross-venue EQUIVALENT edge is required.
        canonicalMarketId: buildStableTextId("discovery-curated-market-", memberKey),
        canonicalCategory: input.category,
        venue: member.venue,
        venueMarketId: member.venueMarketId,
        title: member.title,
        marketClass: input.marketClass ?? "BINARY",
        ...(outcomes ? { outcomes } : {}),
        publishedAt: new Date(),
        expiresAt,
        resolvesAt,
        resolutionSource: member.resolutionSource ?? null,
        resolutionTitle: member.title,
        resolutionRulesText: member.resolutionRulesText ?? null,
        sourceMetadataVersion: "discovery-curated-v1",
        mappingLineage: ["market-discovery-approve"],
        eventTitle: input.eventTitle,
        ...(input.eventPropositionKey ? { eventPropositionKey: input.eventPropositionKey } : {}),
        eventMetadata: { source: "market-discovery-approve", createdBy: actor }
      };
    });

    const snapshot = this.snapshotBuilder.build(seeds);
    if (snapshot.canonicalEvents.length === 0 || snapshot.venueMarketProfiles.length < 2) {
      throw new CuratedMarketAdminServiceError(
        "The discovery candidate could not be normalized into a cross-venue canonical seed."
      );
    }
    await this.projector.persistAndProject(snapshot);

    return {
      canonicalEventId,
      canonicalMarketIds: snapshot.executableMarkets.map((market) => market.id)
    };
  }

  private async resolveDiscoveryCanonicalEventId(eventPropositionKey: string | undefined, eventKey: string): Promise<string> {
    const normalizedKey = eventPropositionKey?.trim();
    if (!normalizedKey) {
      return buildStableUuid(`discovery-curated-event:${eventKey}`);
    }
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id::text AS id
         FROM canonical_events
        WHERE proposition_key = $1
        LIMIT 1`,
      [normalizedKey]
    );
    return existing.rows[0]?.id ?? buildStableUuid(`discovery-curated-event:${normalizedKey}`);
  }
}
