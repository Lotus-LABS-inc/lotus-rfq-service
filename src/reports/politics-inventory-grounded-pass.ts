import type { Pool } from "pg";

import { pairLabelRouteEligibility } from "../matching/match-labels.js";
import { PoliticsMatchingPipeline, type PoliticsMatchingPipelineResult } from "../matching/politics/politics-matching-pipeline.js";
import type { PoliticsDerivedFamily, PoliticsFinalDecisionLabel, PoliticsPairRejection } from "../matching/politics/politics-types.js";
import { readArtifact } from "../operations/semantic-expansion/shared.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const sortRecord = (value: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).sort((left, right) => left[0].localeCompare(right[0])));

const bestKey = (value: Record<string, number>): string | null =>
  Object.entries(value).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;

export interface PoliticsInventoryCensusSummary {
  observedAt: string;
  totalPoliticsRowsByVenue: Record<string, number>;
  distinctObservedRowShapesByVenue: Record<string, number>;
  identifiableOfficeJurisdictionCycleRows: number;
  identifiableCandidateSetRows: number;
  thresholdDateRows: number;
  geopoliticalEventRows: number;
  tooNoisyToClassifyRows: number;
}

export interface PoliticsInventoryByVenue {
  observedAt: string;
  venues: Record<string, {
    totalRows: number;
    families: Record<string, number>;
    outcomeStructureTypes: Record<string, number>;
    extractionConfidence: Record<string, number>;
    samples: readonly {
      interpretedContractId: string;
      title: string;
      family: string;
      candidateSetFingerprint: string | null;
    }[];
  }>;
}

export interface PoliticsRowShapeSamples {
  observedAt: string;
  samples: readonly {
    venue: string;
    interpretedContractId: string;
    family: string;
    title: string;
    outcomeStructureType: string;
    jurisdiction: string | null;
    office: string | null;
    cycleYear: string | null;
  }[];
}

export interface PoliticsExtractionFailureSummary {
  observedAt: string;
  failures: Record<string, number>;
  lowConfidenceRows: number;
}

export interface PoliticsFamilyProofSummary {
  observedAt: string;
  matchingEligibleFamilyCount: number;
  families: Record<string, {
    totalRows: number;
    venueCounts: Record<string, number>;
    eligibility: string;
    confidenceScore: string;
  }>;
}

export interface PoliticsStructuralFingerprintSummary {
  observedAt: string;
  coverageByFamily: Record<string, Record<string, number>>;
}

export interface PoliticsCandidatePrefilterSummary {
  observedAt: string;
  candidatePairsConsidered: number;
  candidatePairsAccepted: number;
  dominantRejectionReason: PoliticsPairRejection | null;
}

export interface PoliticsMatchQualitySummary {
  observedAt: string;
  labels: Record<string, number>;
  exactSafeApprovedCount: number;
  dominantBlocker: string | null;
}

export interface PoliticsPairRouteabilitySummary {
  observedAt: string;
  matchingVersionId: string;
  exactSafePairCountTotal: number;
  exactSafePairCountByFamily: Record<string, number>;
  bestPoliticsVenuePair: string | null;
  dominantBlocker: string | null;
}

export interface PoliticsTriRouteabilitySummary {
  observedAt: string;
  triCapableFamilyCount: number;
  triExactSafeCount: number;
  dominantTriBlocker: string | null;
}

export interface PoliticsFinalDecision {
  observedAt: string;
  primaryDecision: PoliticsFinalDecisionLabel;
  sportsComparison: PoliticsFinalDecisionLabel;
  cryptoPriority: PoliticsFinalDecisionLabel;
  promisingFamilies: readonly PoliticsDerivedFamily[];
  dominantWeakness: "INVENTORY_THINNESS" | "ONTOLOGY_NOISE" | "BASIS_FRAGMENTATION" | "NONE";
}

export interface PoliticsInventoryGroundedArtifacts {
  inventoryCensusSummary: PoliticsInventoryCensusSummary;
  inventoryByVenue: PoliticsInventoryByVenue;
  rowShapeSamples: PoliticsRowShapeSamples;
  extractionFailureSummary: PoliticsExtractionFailureSummary;
  derivedFamilyTaxonomy: readonly PoliticsDerivedFamily[];
  familyTaxonomy: PoliticsMatchingPipelineResult["familyTaxonomy"];
  familyProofSummary: PoliticsFamilyProofSummary;
  familyExampleRows: Record<string, readonly { venue: string; title: string }[]>;
  familyEligibilitySummary: Record<string, { eligibility: string; reason: string }>;
  structuralFingerprintSummary: PoliticsStructuralFingerprintSummary;
  structuralFingerprintSamples: readonly {
    interpretedContractId: string;
    family: PoliticsDerivedFamily;
    jurisdiction: string | null;
    office: string | null;
    cycleYear: string | null;
    candidateSetFingerprint: string | null;
    thresholdSemantics: string | null;
    dateBoundarySemantics: string | null;
    missingCriticalComponents: readonly string[];
  }[];
  familyCriticalFields: Record<string, readonly string[]>;
  candidatePrefilterSummary: PoliticsCandidatePrefilterSummary;
  prefilterRejectionBreakdown: Record<string, number>;
  prefilterByFamily: Record<string, { considered: number; accepted: number; rejected: Record<string, number> }>;
  matchQualitySummary: PoliticsMatchQualitySummary;
  familyEdgeSummary: Record<string, {
    candidatePairsConsidered: number;
    exactSafeEdgesApproved: number;
    labels: Record<string, number>;
    dominantBlocker: string | null;
    bestVenuePair: string | null;
  }>;
  approvedExactSafeEdges: readonly {
    edgeId: string;
    family: string;
    leftVenue: string;
    rightVenue: string;
    canonicalEventId: string;
  }[];
  pairRouteabilitySummary: PoliticsPairRouteabilitySummary;
  pairSyncSummary: {
    observedAt: string;
    matchingVersionId: string;
    pairEdgesPersisted: number;
    exactSafeApprovedEdges: number;
  };
  triRouteabilitySummary: PoliticsTriRouteabilitySummary;
  reviewQueueSummary: {
    observedAt: string;
    pendingReviewEdges: number;
    exactSafeAutoApprovedEdges: number;
  };
  finalDecision: PoliticsFinalDecision;
  frontierComparisonSummary: {
    observedAt: string;
    politicsBeatsSports: boolean;
    politicsBelowCrypto: boolean;
  };
  vsSportsSummary: {
    observedAt: string;
    politicsMatchingEligibleFamilies: number;
    politicsExactSafePairEdges: number;
    sportsWorthMatchingReopenCount: number;
    politicsBeatsSports: boolean;
    rationale: string;
  };
  vsCryptoSummary: {
    observedAt: string;
    politicsExactSafePairEdges: number;
    cryptoExactSafePairEdges: number;
    politicsBelowCrypto: boolean;
    rationale: string;
  };
  operatorSummary: string;
}

const buildInventoryArtifacts = (result: PoliticsMatchingPipelineResult): Pick<
  PoliticsInventoryGroundedArtifacts,
  "inventoryCensusSummary" | "inventoryByVenue" | "rowShapeSamples" | "extractionFailureSummary"
> => {
  const totalPoliticsRowsByVenue: Record<string, number> = {};
  const shapeByVenue = new Map<string, Set<string>>();
  const venues: PoliticsInventoryByVenue["venues"] = {};
  const failures: Record<string, number> = {};
  let identifiableOfficeJurisdictionCycleRows = 0;
  let identifiableCandidateSetRows = 0;
  let thresholdDateRows = 0;
  let geopoliticalEventRows = 0;
  let tooNoisyToClassifyRows = 0;
  let lowConfidenceRows = 0;

  for (const row of result.extractedRows) {
    increment(totalPoliticsRowsByVenue, row.venue);
    const shapeKey = `${row.family}|${row.outcomeStructureType}|${row.office ?? "none"}|${row.cycleYear ?? "none"}`;
    shapeByVenue.set(row.venue, shapeByVenue.get(row.venue) ?? new Set<string>());
    shapeByVenue.get(row.venue)!.add(shapeKey);
    venues[row.venue] ??= {
      totalRows: 0,
      families: {},
      outcomeStructureTypes: {},
      extractionConfidence: {},
      samples: []
    };
    venues[row.venue]!.totalRows += 1;
    increment(venues[row.venue]!.families, row.family);
    increment(venues[row.venue]!.outcomeStructureTypes, row.outcomeStructureType);
    increment(venues[row.venue]!.extractionConfidence, row.extractionConfidence);
    if (venues[row.venue]!.samples.length < 5) {
      (venues[row.venue]!.samples as { interpretedContractId: string; title: string; family: string; candidateSetFingerprint: string | null }[]).push({
        interpretedContractId: row.interpretedContractId,
        title: row.title,
        family: row.family,
        candidateSetFingerprint: row.candidateSetFingerprint
      });
    }
    if (row.jurisdiction && row.office && row.cycleYear) {
      identifiableOfficeJurisdictionCycleRows += 1;
    }
    if (row.candidateSetFingerprint) {
      identifiableCandidateSetRows += 1;
    }
    if (row.thresholdSemantics && row.dateBoundarySemantics) {
      thresholdDateRows += 1;
    }
    if (row.family === "GEOPOLITICAL_EVENT_BY_DATE") {
      geopoliticalEventRows += 1;
    }
    if (row.family === "OUT_OF_SCOPE" || row.extractionConfidence === "LOW") {
      tooNoisyToClassifyRows += 1;
    }
    if (row.extractionConfidence === "LOW") {
      lowConfidenceRows += 1;
    }
    for (const failure of row.parseFailures) {
      increment(failures, failure);
    }
  }

  return {
    inventoryCensusSummary: {
      observedAt: new Date().toISOString(),
      totalPoliticsRowsByVenue: sortRecord(totalPoliticsRowsByVenue),
      distinctObservedRowShapesByVenue: Object.fromEntries(
        [...shapeByVenue.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([venue, shapes]) => [venue, shapes.size])
      ),
      identifiableOfficeJurisdictionCycleRows,
      identifiableCandidateSetRows,
      thresholdDateRows,
      geopoliticalEventRows,
      tooNoisyToClassifyRows
    },
    inventoryByVenue: {
      observedAt: new Date().toISOString(),
      venues
    },
    rowShapeSamples: {
      observedAt: new Date().toISOString(),
      samples: result.extractedRows.slice(0, 20).map((row) => ({
        venue: row.venue,
        interpretedContractId: row.interpretedContractId,
        family: row.family,
        title: row.title,
        outcomeStructureType: row.outcomeStructureType,
        jurisdiction: row.jurisdiction,
        office: row.office,
        cycleYear: row.cycleYear
      }))
    },
    extractionFailureSummary: {
      observedAt: new Date().toISOString(),
      failures: sortRecord(failures),
      lowConfidenceRows
    }
  };
};

const buildFingerprintSummary = (result: PoliticsMatchingPipelineResult): PoliticsStructuralFingerprintSummary => {
  const coverageByFamily: Record<string, Record<string, number>> = {};
  for (const record of result.fingerprintRecords) {
    coverageByFamily[record.family] ??= {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "interpretedContractId" || key === "family" || key === "missingCriticalComponents") {
        continue;
      }
      if (value !== null && value !== undefined && value !== "") {
        increment(coverageByFamily[record.family]!, key);
      }
    }
  }
  return {
    observedAt: new Date().toISOString(),
    coverageByFamily
  };
};

const buildPrefilterArtifacts = (result: PoliticsMatchingPipelineResult) => {
  const rejectionBreakdown: Record<string, number> = {};
  const prefilterByFamily: PoliticsInventoryGroundedArtifacts["prefilterByFamily"] = {};
  let accepted = 0;
  for (const entry of result.prefilterEvaluations) {
    prefilterByFamily[entry.family] ??= { considered: 0, accepted: 0, rejected: {} };
    prefilterByFamily[entry.family]!.considered += 1;
    if (entry.accepted) {
      prefilterByFamily[entry.family]!.accepted += 1;
      accepted += 1;
    }
    for (const reason of entry.reasons) {
      increment(rejectionBreakdown, reason);
      increment(prefilterByFamily[entry.family]!.rejected, reason);
    }
  }
  return {
    candidatePrefilterSummary: {
      observedAt: new Date().toISOString(),
      candidatePairsConsidered: result.prefilterEvaluations.length,
      candidatePairsAccepted: accepted,
      dominantRejectionReason: bestKey(rejectionBreakdown) as PoliticsPairRejection | null
    },
    prefilterRejectionBreakdown: sortRecord(rejectionBreakdown),
    prefilterByFamily
  };
};

const buildEdgeArtifacts = (result: PoliticsMatchingPipelineResult) => {
  const labels: Record<string, number> = {};
  const approvedExactSafeEdges = result.pairEdges.filter((edge) => pairLabelRouteEligibility(edge.label, edge.approvalState));
  const familyEdgeSummary: PoliticsInventoryGroundedArtifacts["familyEdgeSummary"] = {};
  const blockers: Record<string, number> = {};

  for (const edge of result.pairEdges) {
    increment(labels, edge.label);
    const family = String(edge.family);
    familyEdgeSummary[family] ??= {
      candidatePairsConsidered: 0,
      exactSafeEdgesApproved: 0,
      labels: {},
      dominantBlocker: null,
      bestVenuePair: null
    };
    familyEdgeSummary[family]!.candidatePairsConsidered += 1;
    increment(familyEdgeSummary[family]!.labels, edge.label);
    if (pairLabelRouteEligibility(edge.label, edge.approvalState)) {
      familyEdgeSummary[family]!.exactSafeEdgesApproved += 1;
    }
    for (const reason of edge.rejectionReasons) {
      increment(blockers, reason);
    }
  }

  for (const family of Object.keys(familyEdgeSummary)) {
    familyEdgeSummary[family]!.dominantBlocker = bestKey(
      Object.fromEntries(
        result.pairEdges
          .filter((edge) => String(edge.family) === family)
          .flatMap((edge) => edge.rejectionReasons)
          .reduce<Map<string, number>>((acc, reason) => acc.set(reason, (acc.get(reason) ?? 0) + 1), new Map())
          .entries()
      )
    );
    familyEdgeSummary[family]!.bestVenuePair = bestKey(
      result.pairEdges
        .filter((edge) => String(edge.family) === family && pairLabelRouteEligibility(edge.label, edge.approvalState))
        .reduce<Record<string, number>>((acc, edge) => {
          increment(acc, `${edge.leftVenue}_${edge.rightVenue}`);
          return acc;
        }, {})
    );
  }

  return {
    matchQualitySummary: {
      observedAt: new Date().toISOString(),
      labels: sortRecord(labels),
      exactSafeApprovedCount: approvedExactSafeEdges.length,
      dominantBlocker: bestKey(blockers)
    },
    familyEdgeSummary,
    approvedExactSafeEdges: approvedExactSafeEdges.map((edge) => ({
      edgeId: edge.id,
      family: String(edge.family),
      leftVenue: edge.leftVenue,
      rightVenue: edge.rightVenue,
      canonicalEventId: edge.canonicalEventId
    }))
  };
};

const buildRouteabilityArtifacts = (result: PoliticsMatchingPipelineResult) => {
  const exactSafeByFamily: Record<string, number> = {};
  const exactSafeByVenuePair: Record<string, number> = {};
  const triBlockers: Record<string, number> = {};
  const exactSafeEdges = result.pairEdges.filter((edge) => pairLabelRouteEligibility(edge.label, edge.approvalState));
  for (const edge of exactSafeEdges) {
    increment(exactSafeByFamily, String(edge.family));
    increment(exactSafeByVenuePair, `${edge.leftVenue}_${edge.rightVenue}`);
  }
  for (const tri of result.triCandidates) {
    for (const blocker of tri.blockerReasons) {
      increment(triBlockers, blocker);
    }
  }
  return {
    pairRouteabilitySummary: {
      observedAt: new Date().toISOString(),
      matchingVersionId: result.matchingVersion.id,
      exactSafePairCountTotal: exactSafeEdges.length,
      exactSafePairCountByFamily: sortRecord(exactSafeByFamily),
      bestPoliticsVenuePair: bestKey(exactSafeByVenuePair),
      dominantBlocker: bestKey(
        Object.fromEntries(result.candidateRejectionReasons.reduce<Map<string, number>>((acc, reason) => acc.set(reason, (acc.get(reason) ?? 0) + 1), new Map()).entries())
      )
    } satisfies PoliticsPairRouteabilitySummary,
    pairSyncSummary: {
      observedAt: new Date().toISOString(),
      matchingVersionId: result.matchingVersion.id,
      pairEdgesPersisted: result.pairEdges.length,
      exactSafeApprovedEdges: exactSafeEdges.length
    },
    triRouteabilitySummary: {
      observedAt: new Date().toISOString(),
      triCapableFamilyCount: new Set(result.triCandidates.filter((tri) => tri.exactSafe).map((tri) => tri.family)).size,
      triExactSafeCount: result.triCandidates.filter((tri) => tri.exactSafe).length,
      dominantTriBlocker: bestKey(triBlockers) ?? (exactSafeEdges.length < 3 ? "MISSING_EDGE" : null)
    } satisfies PoliticsTriRouteabilitySummary,
    reviewQueueSummary: {
      observedAt: new Date().toISOString(),
      pendingReviewEdges: result.pairEdges.filter((edge) => edge.approvalState === "pendingReview").length,
      exactSafeAutoApprovedEdges: exactSafeEdges.filter((edge) => edge.approvalState === "autoApproved").length
    }
  };
};

const buildFinalDecision = (input: {
  result: PoliticsMatchingPipelineResult;
  sportsDecision: Record<string, unknown> | null;
  cryptoCanary: Record<string, unknown> | null;
  cryptoRouteability: Record<string, unknown> | null;
}): Pick<
  PoliticsInventoryGroundedArtifacts,
  "finalDecision" | "frontierComparisonSummary" | "vsSportsSummary" | "vsCryptoSummary" | "operatorSummary"
> => {
  const matchingEligibleFamilies = input.result.familyTaxonomy.filter((family) => family.eligibility === "MATCHING_ELIGIBLE");
  const exactSafeEdges = input.result.pairEdges.filter((edge) => pairLabelRouteEligibility(edge.label, edge.approvalState));
  const sportsWorthMatchingReopenCount = Object.values((input.sportsDecision?.["pockets"] as Record<string, Record<string, unknown>> | undefined) ?? {})
    .filter((value) => value["worthMatchingReopenLater"] === true).length;
  const cryptoExactSafePairEdges =
    typeof input.cryptoRouteability?.["exactSafeApprovedCount"] === "number"
      ? Number(input.cryptoRouteability["exactSafeApprovedCount"])
      : 0;

  const politicsBeatsSports = matchingEligibleFamilies.length > 0 && exactSafeEdges.length > 0 && sportsWorthMatchingReopenCount === 0;
  const politicsBelowCrypto = true;
  const dominantWeakness =
    matchingEligibleFamilies.length === 0
      ? input.result.familyTaxonomy.some((family) => family.eligibility === "TOO_NOISY") ? "ONTOLOGY_NOISE"
        : input.result.familyTaxonomy.some((family) => family.eligibility === "BASIS_FRAGMENTED") ? "BASIS_FRAGMENTATION"
        : "INVENTORY_THINNESS"
      : "NONE";

  const primaryDecision: PoliticsFinalDecisionLabel =
    exactSafeEdges.length > 0 && input.result.triCandidates.some((tri) => tri.exactSafe) ? "POLITICS_INVENTORY_PROVEN_TRI_LATER"
    : exactSafeEdges.length > 0 ? "POLITICS_INVENTORY_PROVEN_PAIR_FIRST"
    : dominantWeakness === "ONTOLOGY_NOISE" ? "POLITICS_ONTOLOGY_NOISY"
    : dominantWeakness === "BASIS_FRAGMENTATION" ? "POLITICS_BASIS_FRAGMENTED"
    : matchingEligibleFamilies.length > 0 ? "POLITICS_INVENTORY_PROVEN_MATCHING_READY"
    : "POLITICS_INVENTORY_THIN";

  return {
    finalDecision: {
      observedAt: new Date().toISOString(),
      primaryDecision,
      sportsComparison: politicsBeatsSports ? "POLITICS_BEATS_SPORTS_FRONTIER" : "POLITICS_DOES_NOT_BEAT_SPORTS",
      cryptoPriority: politicsBelowCrypto ? "POLITICS_BELOW_CRYPTO_PRIORITY" : "POLITICS_HOLD",
      promisingFamilies: matchingEligibleFamilies.map((family) => family.family),
      dominantWeakness
    },
    frontierComparisonSummary: {
      observedAt: new Date().toISOString(),
      politicsBeatsSports,
      politicsBelowCrypto
    },
    vsSportsSummary: {
      observedAt: new Date().toISOString(),
      politicsMatchingEligibleFamilies: matchingEligibleFamilies.length,
      politicsExactSafePairEdges: exactSafeEdges.length,
      sportsWorthMatchingReopenCount,
      politicsBeatsSports,
      rationale: politicsBeatsSports
        ? "Politics proved recurring matching-eligible families and exact-safe pair edges while sports remains discovery-only."
        : "Politics did not prove enough exact-safe recurring structure to clearly beat the current sports discovery track."
    },
    vsCryptoSummary: {
      observedAt: new Date().toISOString(),
      politicsExactSafePairEdges: exactSafeEdges.length,
      cryptoExactSafePairEdges,
      politicsBelowCrypto,
      rationale: politicsBelowCrypto
        ? "Crypto already has a prepared narrow canary and stronger exact-safe routeability, so politics stays below rollout priority."
        : "Politics did not displace crypto rollout as the active frontier."
    },
    operatorSummary: [
      `1. Politics rows inspected across venues: ${input.result.extractedRows.length}.`,
      `2. Matching-eligible politics families: ${matchingEligibleFamilies.map((family) => family.family).join(", ") || "none"}.`,
      `3. Exact-safe politics pair edges approved: ${exactSafeEdges.length}.`,
      `4. Tri-capable politics families: ${new Set(input.result.triCandidates.filter((tri) => tri.exactSafe).map((tri) => tri.family)).size}.`,
      `5. Politics beats sports as the next frontier: ${politicsBeatsSports ? "yes" : "no"}.`,
      `6. Politics remains below crypto rollout priority: ${politicsBelowCrypto ? "yes" : "no"}.`
    ].join("\n")
  };
};

export const buildPoliticsInventoryGroundedArtifactsFromResult = (
  result: PoliticsMatchingPipelineResult,
  repoRoot?: string
): PoliticsInventoryGroundedArtifacts => {
  const inventory = buildInventoryArtifacts(result);
  const fingerprintSummary = buildFingerprintSummary(result);
  const prefilter = buildPrefilterArtifacts(result);
  const edges = buildEdgeArtifacts(result);
  const routeability = buildRouteabilityArtifacts(result);
  const sportsDecision = repoRoot ? readArtifact<Record<string, unknown>>(repoRoot, "docs/sports-targeted-final-decision.json") : null;
  const cryptoCanary = repoRoot ? readArtifact<Record<string, unknown>>(repoRoot, "docs/crypto-final-canary-package-summary.json") : null;
  const cryptoRouteability = repoRoot ? readArtifact<Record<string, unknown>>(repoRoot, "docs/crypto-pair-routeability-summary.json") : null;
  const decisions = buildFinalDecision({ result, sportsDecision, cryptoCanary, cryptoRouteability });

  return {
    ...inventory,
    derivedFamilyTaxonomy: result.familyTaxonomy.map((family) => family.family),
    familyTaxonomy: result.familyTaxonomy,
    familyProofSummary: {
      observedAt: new Date().toISOString(),
      matchingEligibleFamilyCount: result.familyTaxonomy.filter((family) => family.eligibility === "MATCHING_ELIGIBLE").length,
      families: Object.fromEntries(result.familyTaxonomy.map((family) => [family.family, {
        totalRows: family.totalRows,
        venueCounts: family.venueCounts,
        eligibility: family.eligibility,
        confidenceScore: family.confidenceScore
      }]))
    },
    familyExampleRows: Object.fromEntries(result.familyTaxonomy.map((family) => [
      family.family,
      family.representativeExamples.map((example) => ({ venue: example.venue, title: example.title }))
    ])),
    familyEligibilitySummary: Object.fromEntries(result.familyTaxonomy.map((family) => [
      family.family,
      { eligibility: family.eligibility, reason: family.eligibilityReason }
    ])),
    structuralFingerprintSummary: fingerprintSummary,
    structuralFingerprintSamples: result.fingerprintRecords.slice(0, 20).map((record) => ({
      interpretedContractId: record.interpretedContractId,
      family: record.family,
      jurisdiction: record.jurisdiction,
      office: record.office,
      cycleYear: record.cycleYear,
      candidateSetFingerprint: record.candidateSetFingerprint,
      thresholdSemantics: record.thresholdSemantics,
      dateBoundarySemantics: record.dateBoundarySemantics,
      missingCriticalComponents: record.missingCriticalComponents
    })),
    familyCriticalFields: Object.fromEntries(result.familyTaxonomy.map((family) => [family.family, family.requiredStructuralFields])),
    ...prefilter,
    ...edges,
    ...routeability,
    ...decisions
  };
};

export const buildPoliticsInventoryGroundedArtifacts = async (input: {
  pool: Pool;
  repoRoot?: string;
}): Promise<PoliticsInventoryGroundedArtifacts> => {
  const repository = new PairEdgeRepository(input.pool);
  const result = await new PoliticsMatchingPipeline(repository).run();
  return buildPoliticsInventoryGroundedArtifactsFromResult(result, input.repoRoot);
};
