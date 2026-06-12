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
}
