import type { Pool } from "pg";

import { buildStableTextId, buildStableUuid } from "../../canonical/canonicalization-types.js";
import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import {
  buildOpinionCryptoDateFamilyMatrix,
  inferCryptoCutoffStyle,
  type OpinionCryptoCutoffStyle,
  type OpinionCryptoDateFamilySummary,
  type OpinionCryptoFamily
} from "../../integrations/opinion/opinion-crypto-date-family-matrix.js";
import { classifyStructuredOpinionFamily } from "../../integrations/opinion/opinion-family-classifier.js";
import { buildCrossVenueMatchReport } from "./cross-venue-match-report.js";
import {
  buildExactDateSeedSearch,
  buildSeedSourceText,
  indexInventoryByKey,
  type ExactSeedDefinition
} from "./exact-seed-shared.js";
import { loadPmLimitlessRouteableAnchorSeeds } from "./pm-limitless-anchor-seeds.js";
import { loadSemanticExpansionInventory, type SemanticExpansionInventoryRow } from "./shared.js";
import { writeArtifact } from "./shared.js";

interface ExpansionCandidateDecision {
  include: boolean;
  reason: string;
}

export interface PmLimitlessCryptoDateAlignedExpansionSummary {
  observedAt: string;
  metadataVersion: string;
  baselineSeedCount: number;
  addedSeedCount: number;
  totalSeedCount: number;
  targetedBtcDates: readonly {
    family: OpinionCryptoFamily;
    exactDate: string;
    cutoffStyle: OpinionCryptoCutoffStyle;
    count: number;
  }[];
  baselineSeeds: readonly {
    seedReference: string;
    title: string;
    family: string;
    asset: string | null;
    exactDate: string | null;
    cutoffStyle: OpinionCryptoCutoffStyle;
  }[];
  addedSeeds: readonly {
    seedReference: string;
    title: string;
    family: string;
    asset: string | null;
    exactDate: string | null;
    cutoffStyle: OpinionCryptoCutoffStyle;
    supportReason: string;
    matchClass: string;
    opinionSupportCount: number;
  }[];
  excludedCandidates: readonly {
    seedReference: string;
    title: string;
    family: string;
    asset: string | null;
    exactDate: string | null;
    cutoffStyle: OpinionCryptoCutoffStyle;
    exclusionReason: string;
    matchClass: string;
  }[];
}

const METADATA_VERSION = "pm-limitless-crypto-date-aligned-expansion-v1";

const normalizeExactDate = (value: string | null): string | null =>
  value?.toLowerCase().replace(/\s+/g, " ").trim() ?? null;

const classifyCryptoSeed = (seed: ExactSeedDefinition): {
  family: string;
  asset: string | null;
  exactDate: string | null;
  cutoffStyle: OpinionCryptoCutoffStyle;
} => {
  const family = classifyStructuredOpinionFamily({
    category: seed.canonicalCategory,
    title: seed.title,
    rules: seed.sourceText,
    boundaryReferenceAt: seed.boundaryReferenceAt ? new Date(seed.boundaryReferenceAt) : null
  });
  return {
    family: family.familyBucket,
    asset: family.subject,
    exactDate: normalizeExactDate(family.deadlineOrSeason),
    cutoffStyle: inferCryptoCutoffStyle({
      title: seed.title,
      exactDate: family.deadlineOrSeason,
      timeBoundaryPattern: family.timeBoundaryPattern
    })
  };
};

const buildSeedFromRows = (left: SemanticExpansionInventoryRow, right: SemanticExpansionInventoryRow): ExactSeedDefinition => {
  const rows = [left, right].sort((a, b) => a.venue.localeCompare(b.venue));
  const memberVenueMarketIds = rows.map((row) => `${row.venue}:${row.venueMarketId}`).sort((a, b) => a.localeCompare(b));
  const title = rows.find((row) => row.title.trim().length > 0)?.title ?? left.title;
  const sourceText = buildSeedSourceText({
    title,
    memberTitles: rows.map((row) => row.title),
    memberRules: rows.map((row) => row.rules ?? "")
  });
  const canonicalMarketId =
    left.canonicalMarketId && left.canonicalMarketId === right.canonicalMarketId
      ? left.canonicalMarketId
      : buildStableTextId("pm-limitless-crypto-date-aligned-", memberVenueMarketIds.join("|"));
  const canonicalEventId =
    left.canonicalEventId === right.canonicalEventId
      ? left.canonicalEventId
      : buildStableUuid(`pm-limitless-crypto-date-aligned-event:${memberVenueMarketIds.join("|")}`);
  const boundaryReferenceAt = rows.find((row) => row.resolvesAt ?? row.expiresAt ?? row.publishedAt)?.resolvesAt
    ?? rows.find((row) => row.resolvesAt ?? row.expiresAt ?? row.publishedAt)?.expiresAt
    ?? rows.find((row) => row.resolvesAt ?? row.expiresAt ?? row.publishedAt)?.publishedAt
    ?? null;

  return {
    seedReference: canonicalMarketId,
    canonicalEventId,
    canonicalMarketId,
    canonicalCategory: "CRYPTO",
    title,
    sourceText,
    memberVenues: ["LIMITLESS", "POLYMARKET"],
    memberVenueMarketIds,
    targetPairFamilies: ["POLYMARKET_OPINION", "LIMITLESS_OPINION"],
    boundaryReferenceAt,
    exactDateSearch: buildExactDateSeedSearch({
      canonicalCategory: "CRYPTO",
      title,
      sourceText,
      targetPairFamilies: ["POLYMARKET_OPINION", "LIMITLESS_OPINION"],
      boundaryReferenceAt
    })
  };
};

const findOpinionSupport = (
  matrix: OpinionCryptoDateFamilySummary,
  input: {
    asset: string | null;
    family: string;
    exactDate: string | null;
    cutoffStyle: OpinionCryptoCutoffStyle;
  }
): { count: number; decision: ExpansionCandidateDecision } => {
  if (input.asset !== "bitcoin") {
    return { count: 0, decision: { include: false, reason: "wrong_asset" } };
  }
  if (!["ATH_BY_DATE", "THRESHOLD_BY_DATE", "SAME_DAY_DIRECTIONAL", "PRICE_AT_CLOSE", "GENERIC_UP_DOWN"].includes(input.family)) {
    return { count: 0, decision: { include: false, reason: "wrong_family" } };
  }
  if (input.exactDate === null) {
    return { count: 0, decision: { include: false, reason: "wrong_date" } };
  }
  const exact = matrix.matrix.find((row) =>
    row.asset === input.asset
    && row.family === input.family
    && row.exactDate === input.exactDate
    && row.cutoffStyle === input.cutoffStyle
  );
  if (exact) {
    return { count: exact.count, decision: { include: true, reason: "same_asset_same_family_same_date_same_cutoff" } };
  }
  const sameDateWrongCutoff = matrix.matrix.find((row) =>
    row.asset === input.asset
    && row.family === input.family
    && row.exactDate === input.exactDate
  );
  if (sameDateWrongCutoff) {
    return { count: sameDateWrongCutoff.count, decision: { include: false, reason: "wrong_cutoff_style" } };
  }
  const sameFamilyWrongDate = matrix.matrix.find((row) =>
    row.asset === input.asset
    && row.family === input.family
  );
  if (sameFamilyWrongDate) {
    return { count: sameFamilyWrongDate.count, decision: { include: false, reason: "wrong_date" } };
  }
  return { count: 0, decision: { include: false, reason: "no_live_opinion_support" } };
};

export const buildPmLimitlessCryptoDateAlignedSeeds = (input: {
  baselineSeeds: readonly ExactSeedDefinition[];
  matrix: OpinionCryptoDateFamilySummary;
  inventoryByKey: ReadonlyMap<string, SemanticExpansionInventoryRow>;
  matches: readonly {
    matchClass: string;
    category: string;
    venueSet: readonly string[];
    seed: { venue: string; venueMarketId: string };
    candidate: { venue: string; venueMarketId: string };
  }[];
}): {
  seeds: readonly ExactSeedDefinition[];
  summary: PmLimitlessCryptoDateAlignedExpansionSummary;
} => {
  const baseline = input.baselineSeeds
    .filter((seed) => seed.canonicalCategory === "CRYPTO")
    .map((seed) => ({ seed, classification: classifyCryptoSeed(seed) }));
  const existingPairKeys = new Set(
    baseline.map((entry) => entry.seed.memberVenueMarketIds.slice().sort((a, b) => a.localeCompare(b)).join("|"))
  );
  const addedSeeds: Array<PmLimitlessCryptoDateAlignedExpansionSummary["addedSeeds"][number]> = [];
  const excludedCandidates: Array<PmLimitlessCryptoDateAlignedExpansionSummary["excludedCandidates"][number]> = [];
  const seeds = baseline.map((entry) => entry.seed);

  for (const match of input.matches) {
    const venues = [...match.venueSet].sort((a, b) => a.localeCompare(b));
    if (match.category !== "CRYPTO") {
      continue;
    }
    if (venues.length !== 2 || venues[0] !== "LIMITLESS" || venues[1] !== "POLYMARKET") {
      continue;
    }
    if (!["semantic_exact_historical_qualified", "semantic_exact_live_only", "semantic_near_exact"].includes(match.matchClass)) {
      continue;
    }
    const left = input.inventoryByKey.get(`${match.seed.venue}:${match.seed.venueMarketId}`);
    const right = input.inventoryByKey.get(`${match.candidate.venue}:${match.candidate.venueMarketId}`);
    if (!left || !right) {
      continue;
    }
    const seed = buildSeedFromRows(left, right);
    const pairKey = seed.memberVenueMarketIds.slice().sort((a, b) => a.localeCompare(b)).join("|");
    if (existingPairKeys.has(pairKey)) {
      continue;
    }
    const classification = classifyCryptoSeed(seed);
    if (!["SAME_DAY_DIRECTIONAL", "THRESHOLD_BY_DATE", "ATH_BY_DATE", "PRICE_AT_CLOSE", "GENERIC_UP_DOWN"].includes(classification.family)) {
      excludedCandidates.push({
        seedReference: seed.seedReference,
        title: seed.title,
        family: classification.family,
        asset: classification.asset,
        exactDate: classification.exactDate,
        cutoffStyle: classification.cutoffStyle,
        exclusionReason: "wrong_family",
        matchClass: match.matchClass
      });
      continue;
    }
    const support = findOpinionSupport(input.matrix, classification);
    if (!support.decision.include) {
      excludedCandidates.push({
        seedReference: seed.seedReference,
        title: seed.title,
        family: classification.family,
        asset: classification.asset,
        exactDate: classification.exactDate,
        cutoffStyle: classification.cutoffStyle,
        exclusionReason: support.decision.reason,
        matchClass: match.matchClass
      });
      continue;
    }
    existingPairKeys.add(pairKey);
    seeds.push(seed);
    addedSeeds.push({
      seedReference: seed.seedReference,
      title: seed.title,
      family: classification.family,
      asset: classification.asset,
      exactDate: classification.exactDate,
      cutoffStyle: classification.cutoffStyle,
      supportReason: support.decision.reason,
      matchClass: match.matchClass,
      opinionSupportCount: support.count
    });
  }

  return {
    seeds: seeds.sort((a, b) =>
      a.title.localeCompare(b.title) || a.seedReference.localeCompare(b.seedReference)
    ),
    summary: {
      observedAt: new Date().toISOString(),
      metadataVersion: METADATA_VERSION,
      baselineSeedCount: baseline.length,
      addedSeedCount: addedSeeds.length,
      totalSeedCount: seeds.length,
      targetedBtcDates: input.matrix.btcTargetableDates.map((row) => ({
        family: row.family,
        exactDate: row.exactDate,
        cutoffStyle: row.cutoffStyle,
        count: row.count
      })),
      baselineSeeds: baseline.map((entry) => ({
        seedReference: entry.seed.seedReference,
        title: entry.seed.title,
        family: entry.classification.family,
        asset: entry.classification.asset,
        exactDate: entry.classification.exactDate,
        cutoffStyle: entry.classification.cutoffStyle
      })),
      addedSeeds,
      excludedCandidates
    }
  };
};

export const loadPmLimitlessCryptoDateAlignedSeeds = async (input: {
  repoRoot: string;
  pool: Pool;
  opinionBaseUrl: string;
  opinionApiKey: string;
  matrixOutputPath?: string;
  expansionSummaryOutputPath?: string;
}): Promise<readonly ExactSeedDefinition[]> => {
  const client = new OpinionClient({
    baseUrl: input.opinionBaseUrl,
    apiKey: input.opinionApiKey
  });
  const matrix = await buildOpinionCryptoDateFamilyMatrix({
    client
  });
  writeArtifact(input.repoRoot, input.matrixOutputPath ?? "docs/opinion-crypto-date-family-summary.json", matrix.summary);

  const [baselineSeeds, inventory, report] = await Promise.all([
    loadPmLimitlessRouteableAnchorSeeds({
      pool: input.pool,
      categories: ["CRYPTO"]
    }),
    loadSemanticExpansionInventory(input.pool),
    buildCrossVenueMatchReport(input.pool)
  ]);

  const expansion = buildPmLimitlessCryptoDateAlignedSeeds({
    baselineSeeds,
    matrix: matrix.summary,
    inventoryByKey: indexInventoryByKey(inventory),
    matches: report.matches
  });

  writeArtifact(input.repoRoot, input.expansionSummaryOutputPath ?? "docs/pm-limitless-crypto-date-aligned-expansion-summary.json", expansion.summary);
  return expansion.seeds;
};
