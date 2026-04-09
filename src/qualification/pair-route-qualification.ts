import { QualificationStage } from "../core/qualification/qualification.types.js";
import { readArtifact } from "../operations/semantic-expansion/shared.js";
import {
  getPairRouteClassDefinition,
  type PairRouteClassDefinition,
  type PairRouteClassId,
  type PairRouteReadinessState
} from "../rollout/pair-route-classes.js";
import type { PairRouteRiskProfile } from "./pair-route-risk-profile.js";
import { buildPairRouteRiskProfile } from "./pair-route-readiness-evaluator.js";

interface RouteModeSlice {
  routeMode: string;
  routeableMarketCount: number;
  eventCount: number;
}

interface BasisSlice {
  basis: "HISTORICAL_ONLY" | "LIVE_ONLY" | "MIXED_BASIS" | "INSUFFICIENT_BASIS";
  routeModes: readonly RouteModeSlice[];
  totals: {
    eventCount: number;
    canonicalMarketCount: number;
    runnableSingleCount: number;
    runnablePairCount: number;
    runnableTriCount: number;
  };
  blockReasons: readonly {
    reason: string;
    count: number;
  }[];
}

interface PairFamilyReportFamily {
  pairFamily: string;
  exactHistoricalQualifiedCount: number;
  exactLiveOnlyCount: number;
  nearExactCount: number;
  noCandidateCount: number;
  dominantBlockerFamilies?: readonly { blocker: string; count: number }[];
}

interface CrossVenueReportMatch {
  category: string;
  venueSet: readonly string[];
  seed: {
    title: string;
    canonicalEventId: string;
    canonicalMarketId: string | null;
  };
  candidate: {
    title: string;
    canonicalEventId: string;
    canonicalMarketId: string | null;
  };
  exactPromotionEligible: boolean;
  historicalQualified: boolean;
}

interface SimulationCanonicalMarket {
  canonicalMarketId: string | null;
  venues: readonly {
    venue: string;
    venueMarketId: string;
    title: string | null;
  }[];
  runnableRouteModes: readonly string[];
}

interface SimulationEventSummary {
  canonicalEventId: string;
  category: string;
  catalogScope: string;
  canonicalMarkets: readonly SimulationCanonicalMarket[];
}

export interface PairRouteQualification {
  routeClassId: PairRouteClassId;
  definition: PairRouteClassDefinition;
  currentStage: QualificationStage;
  readinessState: PairRouteReadinessState;
  historicalQualification: {
    routeableMarketCount: number;
    eventCount: number;
    exactHistoricalQualifiedCount: number;
    basisClean: boolean;
  };
  liveQualification: {
    routeableMarketCount: number;
    eventCount: number;
    exactLiveOnlyCount: number;
    basisClean: boolean;
  };
  mixedBasisDiagnostic: {
    routeableMarketCount: number;
    eventCount: number;
  };
  exactNearExactDistribution: {
    exactHistoricalQualifiedCount: number;
    exactLiveOnlyCount: number;
    nearExactCount: number;
    noCandidateCount: number;
  };
  safeSubsetMarkets: readonly {
    category: string;
    canonicalEventId: string;
    canonicalMarketId: string | null;
    titles: readonly string[];
  }[];
  runnableMarkets: readonly {
    category: string;
    canonicalEventId: string;
    canonicalMarketId: string | null;
    venues: readonly string[];
  }[];
  riskProfile: PairRouteRiskProfile;
  recommendation: "SHADOW" | "CANARY" | "LIMITED_PROD" | "BLOCKED";
  supportedFamilies: readonly string[];
  blockedFamilies: readonly string[];
  evidenceRefs: readonly string[];
}

export interface PairRouteArtifactInputs {
  timeBasisSummary: { routeabilityByBasis: readonly BasisSlice[] };
  pairFamilyReport: { families: readonly PairFamilyReportFamily[] };
  crossVenueReport: { matches: readonly CrossVenueReportMatch[] };
  simulationCanonicalEvents: { categories: Record<string, readonly SimulationEventSummary[]> };
}

const getBasisSlice = (
  slices: readonly BasisSlice[],
  basis: BasisSlice["basis"]
): BasisSlice => slices.find((entry) => entry.basis === basis) ?? {
  basis,
  routeModes: [],
  totals: {
    eventCount: 0,
    canonicalMarketCount: 0,
    runnableSingleCount: 0,
    runnablePairCount: 0,
    runnableTriCount: 0
  },
  blockReasons: []
};

const getRouteModeCounts = (slice: BasisSlice, routeMode: string): { routeableMarketCount: number; eventCount: number } => {
  const routeModeEntry = slice.routeModes.find((entry) => entry.routeMode === routeMode);
  return {
    routeableMarketCount: routeModeEntry?.routeableMarketCount ?? 0,
    eventCount: routeModeEntry?.eventCount ?? 0
  };
};

const getPairFamilyStats = (
  families: readonly PairFamilyReportFamily[],
  pairFamily: string
): PairFamilyReportFamily => families.find((entry) => entry.pairFamily === pairFamily) ?? {
  pairFamily,
  exactHistoricalQualifiedCount: 0,
  exactLiveOnlyCount: 0,
  nearExactCount: 0,
  noCandidateCount: 0,
  dominantBlockerFamilies: []
};

const flattenSimulationEvents = (input: PairRouteArtifactInputs["simulationCanonicalEvents"]): readonly SimulationEventSummary[] =>
  Object.entries(input.categories).flatMap(([category, events]) =>
    events.map((event) => ({
      ...event,
      category
    }))
  );

const getRunnableMarketsForRoute = (
  events: readonly SimulationEventSummary[],
  routeMode: string
): readonly {
  category: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  venues: readonly string[];
}[] =>
  events.flatMap((event) =>
    event.canonicalMarkets
      .filter((market) => market.runnableRouteModes.includes(routeMode))
      .map((market) => ({
        category: event.category,
        canonicalEventId: event.canonicalEventId,
        canonicalMarketId: market.canonicalMarketId,
        venues: market.venues.map((venue) => `${venue.venue}:${venue.venueMarketId}`)
      }))
  );

const getSafeSubsetMatches = (
  matches: readonly CrossVenueReportMatch[],
  routeMode: PairRouteClassDefinition["routeMode"]
): readonly {
  category: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  titles: readonly string[];
}[] => {
  const routeVenues =
    routeMode === "POLYMARKET_LIMITLESS"
      ? ["LIMITLESS", "POLYMARKET"]
      : ["OPINION", "POLYMARKET"];

  const filtered = matches.filter((entry) => {
    const sortedVenueSet = [...entry.venueSet].sort();
    return sortedVenueSet.length === 2 &&
      sortedVenueSet[0] === routeVenues[0] &&
      sortedVenueSet[1] === routeVenues[1] &&
      entry.exactPromotionEligible &&
      entry.historicalQualified;
  });

  const keyed = new Map<string, {
    category: string;
    canonicalEventId: string;
    canonicalMarketId: string | null;
    titles: Set<string>;
  }>();

  for (const entry of filtered) {
    const key = `${entry.seed.canonicalEventId}:${entry.seed.canonicalMarketId ?? "null"}`;
    const bucket = keyed.get(key) ?? {
      category: entry.category,
      canonicalEventId: entry.seed.canonicalEventId,
      canonicalMarketId: entry.seed.canonicalMarketId,
      titles: new Set<string>()
    };
    bucket.titles.add(entry.seed.title);
    bucket.titles.add(entry.candidate.title);
    keyed.set(key, bucket);
  }

  return [...keyed.values()].map((entry) => ({
    category: entry.category,
    canonicalEventId: entry.canonicalEventId,
    canonicalMarketId: entry.canonicalMarketId,
    titles: [...entry.titles]
  }));
};

export const loadPairRouteArtifactInputs = (repoRoot: string): PairRouteArtifactInputs => ({
  timeBasisSummary: readArtifact(repoRoot, "docs/time-basis-routeability-summary.json"),
  pairFamilyReport: readArtifact(repoRoot, "docs/pair-family-exactness-report.json"),
  crossVenueReport: readArtifact(repoRoot, "docs/cross-venue-match-report.json"),
  simulationCanonicalEvents: readArtifact(repoRoot, "docs/simulation-canonical-events.json")
});

export const buildPairRouteQualification = (
  routeClassId: PairRouteClassId,
  currentStage: QualificationStage,
  inputs: PairRouteArtifactInputs
): PairRouteQualification => {
  const definition = getPairRouteClassDefinition(routeClassId);
  const historicalSlice = getBasisSlice(inputs.timeBasisSummary.routeabilityByBasis, "HISTORICAL_ONLY");
  const liveSlice = getBasisSlice(inputs.timeBasisSummary.routeabilityByBasis, "LIVE_ONLY");
  const mixedSlice = getBasisSlice(inputs.timeBasisSummary.routeabilityByBasis, "MIXED_BASIS");
  const historicalCounts = getRouteModeCounts(historicalSlice, definition.routeMode);
  const liveCounts = getRouteModeCounts(liveSlice, definition.routeMode);
  const mixedCounts = getRouteModeCounts(mixedSlice, definition.routeMode);
  const pairFamilyStats = getPairFamilyStats(inputs.pairFamilyReport.families, definition.routeMode);
  const flattenedEvents = flattenSimulationEvents(inputs.simulationCanonicalEvents);
  const runnableMarkets = getRunnableMarketsForRoute(flattenedEvents, definition.routeMode);
  const safeSubsetMarkets = getSafeSubsetMatches(inputs.crossVenueReport.matches, definition.routeMode);
  const riskProfile = buildPairRouteRiskProfile({
    definition,
    historicalCounts,
    liveCounts,
    mixedCounts,
    exactHistoricalQualifiedCount: pairFamilyStats.exactHistoricalQualifiedCount,
    exactLiveOnlyCount: pairFamilyStats.exactLiveOnlyCount,
    nearExactCount: pairFamilyStats.nearExactCount,
    dominantBlockers: (pairFamilyStats.dominantBlockerFamilies ?? []).map((entry) => entry.blocker),
    safeSubsetCount: safeSubsetMarkets.length
  });

  const readinessState = riskProfile.recommendedReadinessCap;
  const recommendation =
    readinessState === "LIMITED_PROD_READY" ? "LIMITED_PROD"
      : readinessState === "CANARY_READY" ? "CANARY"
      : readinessState === "SHADOW_READY" ? "SHADOW"
      : "BLOCKED";

  return {
    routeClassId,
    definition,
    currentStage,
    readinessState,
    historicalQualification: {
      routeableMarketCount: historicalCounts.routeableMarketCount,
      eventCount: historicalCounts.eventCount,
      exactHistoricalQualifiedCount: pairFamilyStats.exactHistoricalQualifiedCount,
      basisClean: historicalCounts.routeableMarketCount > 0 || safeSubsetMarkets.length > 0
    },
    liveQualification: {
      routeableMarketCount: liveCounts.routeableMarketCount,
      eventCount: liveCounts.eventCount,
      exactLiveOnlyCount: pairFamilyStats.exactLiveOnlyCount,
      basisClean: liveCounts.routeableMarketCount > 0
    },
    mixedBasisDiagnostic: mixedCounts,
    exactNearExactDistribution: {
      exactHistoricalQualifiedCount: pairFamilyStats.exactHistoricalQualifiedCount,
      exactLiveOnlyCount: pairFamilyStats.exactLiveOnlyCount,
      nearExactCount: pairFamilyStats.nearExactCount,
      noCandidateCount: pairFamilyStats.noCandidateCount
    },
    safeSubsetMarkets,
    runnableMarkets,
    riskProfile,
    recommendation,
    supportedFamilies: [...definition.shadowAllowedFamilies],
    blockedFamilies: [...definition.blockedFamilies],
    evidenceRefs: [
      "docs/time-basis-routeability-summary.json",
      "docs/cross-venue-match-report.json",
      "docs/pair-family-exactness-report.json",
      "docs/simulation-canonical-events.json"
    ]
  };
};

export const buildAllPairRouteQualifications = (
  currentStages: Readonly<Record<PairRouteClassId, QualificationStage>>,
  inputs: PairRouteArtifactInputs
): readonly PairRouteQualification[] => [
  buildPairRouteQualification("PAIR_PM_LIMITLESS", currentStages.PAIR_PM_LIMITLESS, inputs),
  buildPairRouteQualification("PAIR_PM_OPINION", currentStages.PAIR_PM_OPINION, inputs)
];
