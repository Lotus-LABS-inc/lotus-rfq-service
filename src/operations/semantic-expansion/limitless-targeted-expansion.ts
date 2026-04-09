import type { Pool } from "pg";

import { buildStableUuid } from "../../canonical/canonicalization-types.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import { CanonicalGraphProjector } from "../../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../canonical/canonical-compatibility-projector.js";
import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../core/historical-simulation/historical-simulation.types.js";
import { LimitlessHistoricalClient, type LimitlessMarketDetail } from "../../integrations/limitless/limitless-client.js";
import { hydrateLimitlessExecutableProfile } from "../../integrations/limitless/limitless-detail-hydration.js";
import { CanonicalGraphRepository } from "../../repositories/canonical-graph.repository.js";
import { CanonicalCompatibilityRepository } from "../../repositories/canonical-compatibility.repository.js";
import { CompatibilityVersionRepository } from "../../repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../../repositories/historical-market-state.repository.js";
import {
  historicalRouteCandidatesSchema,
  type HistoricalRouteCandidates
} from "../../simulation/historical-route-catalog-manifest.js";
import { readArtifact, writeArtifact } from "./shared.js";

const metadataVersion = "limitless-targeted-seed-v2";
type SupportedSeedCategory = "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS";

export interface LimitlessTargetedExpansionSummary {
  observedAt: string;
  metadataVersion: string;
  selectedSeedCount: number;
  projectedSeedCount: number;
  insertedStates: number;
  skippedStates: number;
  seededTargets: ReadonlyArray<{
    canonicalEventId: string;
    canonicalMarketId: string;
    category: SupportedSeedCategory;
    venueMarketId: string;
    title: string;
  }>;
}

const isSupportedSeedCategory = (value: string): value is SupportedSeedCategory =>
  value === "POLITICS" || value === "CRYPTO" || value === "SPORTS" || value === "ESPORTS";

const asOptionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const buildDetailAwareSeed = (
  candidate: HistoricalRouteCandidates["candidates"][number],
  profile: HistoricalRouteCandidates["candidates"][number]["venueProfiles"][number],
  detail: LimitlessMarketDetail | null
): CuratedCanonicalGraphSeed => {
  const hydrated = hydrateLimitlessExecutableProfile({
    detail,
    fallbackTitle: candidate.title,
    fallbackDescription: candidate.title
  });

  return ({
  canonicalEventId: buildStableUuid(`limitless-targeted-event:${candidate.historicalCanonicalEventId}`),
  canonicalMarketId: candidate.historicalCanonicalMarketId,
  canonicalCategory: candidate.canonicalCategory,
  venue: "LIMITLESS",
  venueMarketId: profile.venueMarketId,
  title: hydrated.title,
  description: hydrated.description,
  marketType: "BINARY",
  marketClass: "BINARY",
  outcomes: [
    { id: "YES", label: "Yes", metadata: { venue: "LIMITLESS" } },
    { id: "NO", label: "No", metadata: { venue: "LIMITLESS" } }
  ],
  outcomeSchema: {
    marketShape: "binary",
    yesLabel: "Yes",
    noLabel: "No"
  },
  topics: [candidate.canonicalCategory.toLowerCase(), "limitless_targeted_seed"],
  ...(hydrated.publishedAt !== null ? { publishedAt: hydrated.publishedAt } : {}),
  ...(hydrated.expiresAt !== null
    ? {
      expiresAt: hydrated.expiresAt,
      resolvesAt: hydrated.resolvesAt
    }
    : {}),
  resolutionSource: hydrated.resolutionSource,
  resolutionTitle: hydrated.resolutionTitle,
  resolutionRulesText: hydrated.resolutionRulesText,
  resolutionAuthorityType: "CENTRAL",
  settlementType: "unknown",
  rawSourcePayload: {
    source: "limitless-targeted-expansion",
    candidateTitle: candidate.title,
    historySource: profile.historySource,
    marketDetail: detail
  },
  normalizedPayload: {
    historicalCanonicalEventId: candidate.historicalCanonicalEventId,
    historicalCanonicalMarketId: candidate.historicalCanonicalMarketId,
    seedType: "limitless_targeted_seed",
    deadline: hydrated.expiresAt?.toISOString() ?? null,
    marketDetailSlug: asOptionalText(detail?.slug)
  },
  mappingLineage: ["limitless-targeted-expansion", ...(detail ? ["limitless-market-detail"] : [])],
  sourceMetadataVersion: metadataVersion,
  eventPropositionKey: `limitless-targeted:${candidate.historicalCanonicalMarketId}`,
  propositionHints: {
    normalizedPropositionText: [hydrated.title, hydrated.resolutionRulesText ?? candidate.title].join(" "),
    groupingHints: {
      historicalCanonicalMarketId: candidate.historicalCanonicalMarketId,
      deadline: hydrated.expiresAt?.toISOString() ?? null
    }
  },
  executableDisplayName: hydrated.title,
  executableMetadata: {
    source: "limitless-targeted-expansion",
    historicalAligned: true,
    detailHydrated: hydrated.detailHydrated
  }
})};

const toHistoricalState = (
  candidate: HistoricalRouteCandidates["candidates"][number],
  profile: HistoricalRouteCandidates["candidates"][number]["venueProfiles"][number]
): CreateHistoricalMarketStateInput => {
  const timestamp = new Date(profile.historyWindow.start);
  return {
    canonicalEventId: buildStableUuid(`limitless-targeted-event:${candidate.historicalCanonicalEventId}`),
    canonicalMarketId: candidate.historicalCanonicalMarketId,
    canonicalCategory: candidate.canonicalCategory,
    venue: "LIMITLESS",
    venueMarketId: profile.venueMarketId,
    marketClass: HistoricalMarketClass.BINARY,
    timestamp,
    orderbookSnapshot: {
      source: "limitless_targeted_seed",
      title: profile.title,
      historySource: profile.historySource
    },
    marketEvents: {
      source: "limitless_targeted_seed",
      title: candidate.title
    },
    metadataVersion,
    sourceTimestamp: timestamp
  };
};

export const runLimitlessTargetedExpansion = async (input: {
  repoRoot: string;
  pool: Pool;
  artifactPath?: string;
  venueMarketIds?: readonly string[];
}): Promise<LimitlessTargetedExpansionSummary> => {
  const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";
  const limitlessApiKey = process.env.LIMITLESS_API_KEY;
  const artifact = historicalRouteCandidatesSchema.parse(
    readArtifact<HistoricalRouteCandidates>(input.repoRoot, input.artifactPath ?? "docs/historical-route-candidates.json")
  );

  const requestedVenueMarketIds = new Set(input.venueMarketIds ?? []);

  const selected = artifact.candidates
    .filter((candidate) => isSupportedSeedCategory(candidate.canonicalCategory))
    .flatMap((candidate) =>
      candidate.venueProfiles
        .filter((profile) => profile.venue === "LIMITLESS")
        .filter((profile) => requestedVenueMarketIds.size === 0 || requestedVenueMarketIds.has(profile.venueMarketId))
        .map((profile) => ({ candidate, profile }))
    );

  const limitlessClient = limitlessApiKey
    ? new LimitlessHistoricalClient({
      baseUrl: limitlessBaseUrl,
      apiKey: limitlessApiKey
    })
    : null;
  const details = new Map<string, LimitlessMarketDetail | null>();
  for (const { profile } of selected) {
    if (!limitlessClient || details.has(profile.venueMarketId)) {
      continue;
    }
    try {
      details.set(profile.venueMarketId, await limitlessClient.getMarketDetail(profile.venueMarketId));
    } catch {
      details.set(profile.venueMarketId, null);
    }
  }

  const seeds = selected.map(({ candidate, profile }) =>
    buildDetailAwareSeed(candidate, profile, details.get(profile.venueMarketId) ?? null)
  );
  const states = selected.map(({ candidate, profile }) => toHistoricalState(candidate, profile));

  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool),
      new CompatibilityVersionRepository(input.pool)
    )
  );
  const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  const historyRepository = new HistoricalMarketStateRepository(input.pool);

  if (seeds.length > 0) {
    await projector.persistAndProject(snapshotBuilder.build(seeds));
  }

  const insertResult = await historyRepository.insertManyIgnoreDuplicates(states);
  const summary: LimitlessTargetedExpansionSummary = {
    observedAt: new Date().toISOString(),
    metadataVersion,
    selectedSeedCount: selected.length,
    projectedSeedCount: seeds.length,
    insertedStates: insertResult.inserted,
    skippedStates: insertResult.skipped,
    seededTargets: selected.map(({ candidate, profile }) => ({
      canonicalEventId: buildStableUuid(`limitless-targeted-event:${candidate.historicalCanonicalEventId}`),
      canonicalMarketId: candidate.historicalCanonicalMarketId,
      category: candidate.canonicalCategory as SupportedSeedCategory,
      venueMarketId: profile.venueMarketId,
      title: profile.title
    }))
  };

  writeArtifact(input.repoRoot, "docs/limitless-targeted-expansion-summary.json", summary);
  return summary;
};
