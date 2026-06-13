import {
  buildStableTextId,
  type CanonicalVenue
} from "../canonical/canonicalization-types.js";
import type {
  MarketDiscoveryCandidate,
  MarketDiscoveryCoverageKind,
  MarketDiscoveryTopicBundle,
  MarketDiscoveryTopicBundleChild
} from "./market-discovery-types.js";

const TARGET_VENUES: readonly CanonicalVenue[] = ["LIMITLESS", "POLYMARKET", "PREDICT"];

interface SemanticEvidence {
  topicTitle: string;
  topicKey: string;
  contractLabel: string | null;
  contractKey: string | null;
  venue: CanonicalVenue;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asVenue = (value: unknown): CanonicalVenue | null => {
  const normalized = asString(value);
  if (!normalized) return null;
  return normalized === "PREDICT_FUN" ? "PREDICT" : normalized as CanonicalVenue;
};

const evidenceFromCandidate = (candidate: MarketDiscoveryCandidate): readonly SemanticEvidence[] => {
  const entries = isRecord(candidate.metadata) && Array.isArray(candidate.metadata.semanticEvidence)
    ? candidate.metadata.semanticEvidence
    : [];
  return entries
    .filter(isRecord)
    .map((entry): SemanticEvidence | null => {
      const venue = asVenue(entry.venue);
      const topicTitle = asString(entry.topicTitle);
      const topicKey = asString(entry.topicKey);
      if (!venue || !topicTitle || !topicKey) {
        return null;
      }
      return {
        venue,
        topicTitle,
        topicKey,
        contractLabel: asString(entry.contractLabel),
        contractKey: asString(entry.contractKey)
      };
    })
    .filter((entry): entry is SemanticEvidence => entry !== null);
};

const sortedUnique = <T extends string>(values: readonly T[]): readonly T[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const coverageKind = (venueCount: number): MarketDiscoveryCoverageKind => {
  if (venueCount >= 4) return "MULTI";
  if (venueCount === 3) return "TRI";
  if (venueCount === 2) return "PAIR";
  return "SINGLE";
};

const missingVenueEvidence = (
  venues: readonly CanonicalVenue[],
  suffix: "TOPIC" | "CONTRACT"
): readonly string[] => {
  const present = new Set(venues);
  return TARGET_VENUES
    .filter((venue) => !present.has(venue))
    .map((venue) => `NO_MATCHED_${venue}_${suffix}`);
};

const chooseTopicTitle = (evidence: readonly SemanticEvidence[], fallback: string): string => {
  const sorted = evidence
    .map((entry) => entry.topicTitle)
    .filter((title) => title.length > 0)
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  return sorted[0] ?? fallback;
};

const childFromCandidate = (candidate: MarketDiscoveryCandidate): MarketDiscoveryTopicBundleChild | null => {
  const evidence = evidenceFromCandidate(candidate);
  const contractKeys = sortedUnique(evidence.map((entry) => entry.contractKey).filter((entry): entry is string => entry !== null));
  if (contractKeys.length !== 1) {
    return null;
  }
  const contractKey = contractKeys[0]!;
  const contractLabels = evidence
    .filter((entry) => entry.contractKey === contractKey && entry.contractLabel)
    .map((entry) => entry.contractLabel!)
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  const venues = sortedUnique(candidate.venues);
  return {
    candidateId: candidate.id,
    candidateKey: candidate.candidateKey,
    state: candidate.state,
    candidateType: candidate.candidateType,
    eventTitle: candidate.eventTitle,
    contractLabel: contractLabels[0] ?? candidate.sharedOutcomes[0] ?? null,
    contractKey,
    venues,
    venueCount: venues.length,
    coverageKind: coverageKind(venues.length),
    confidenceScore: candidate.confidenceScore,
    sharedOutcomes: candidate.sharedOutcomes,
    missingVenueEvidence: missingVenueEvidence(venues, "CONTRACT"),
    approvalActions: candidate.approvalActions
  };
};

export const buildMarketDiscoveryTopicBundles = (
  candidates: readonly MarketDiscoveryCandidate[]
): readonly MarketDiscoveryTopicBundle[] => {
  const groups = new Map<string, {
    candidates: MarketDiscoveryCandidate[];
    evidence: SemanticEvidence[];
    category: MarketDiscoveryTopicBundle["category"];
    marketFamily: string | null;
    subject: string | null;
    condition: string | null;
    timeBoundary: string | null;
    topicKey: string;
    topicTitle: string;
  }>();

  for (const candidate of candidates) {
    const evidence = evidenceFromCandidate(candidate);
    const topicKeys = sortedUnique(evidence.map((entry) => entry.topicKey));
    if (topicKeys.length !== 1) {
      continue;
    }
    const topicKey = topicKeys[0]!;
    const core = candidate.draftSemanticCore;
    const marketFamily = core?.marketFamily ?? null;
    const subject = core?.subject ?? null;
    const condition = core?.condition ?? null;
    const timeBoundary = core?.timeBoundary ?? candidate.semanticBoundaryKey ?? null;
    const rawBundleKey = [
      candidate.category,
      marketFamily ?? "unknown-family",
      subject ?? "unknown-subject",
      condition ?? "unknown-condition",
      timeBoundary ?? "no-time-boundary",
      topicKey
    ].join(":");
    const bundleKey = buildStableTextId("market-discovery-topic-", rawBundleKey);
    const existing = groups.get(bundleKey);
    if (existing) {
      existing.candidates.push(candidate);
      existing.evidence.push(...evidence);
      existing.topicTitle = chooseTopicTitle(existing.evidence, existing.topicTitle);
      continue;
    }
    groups.set(bundleKey, {
      candidates: [candidate],
      evidence: [...evidence],
      category: candidate.category,
      marketFamily,
      subject,
      condition,
      timeBoundary,
      topicKey,
      topicTitle: chooseTopicTitle(evidence, candidate.eventTitle)
    });
  }

  return [...groups.entries()]
    .map(([bundleKey, group]): MarketDiscoveryTopicBundle | null => {
      const children = group.candidates
        .map(childFromCandidate)
        .filter((child): child is MarketDiscoveryTopicBundleChild => child !== null)
        .sort((left, right) =>
          left.contractKey?.localeCompare(right.contractKey ?? "") ?? left.eventTitle.localeCompare(right.eventTitle)
        );
      if (children.length === 0) {
        return null;
      }
      const venues = sortedUnique(children.flatMap((child) => child.venues));
      return {
        bundleKey,
        topicTitle: group.topicTitle,
        topicKey: group.topicKey,
        category: group.category,
        marketFamily: group.marketFamily,
        subject: group.subject,
        condition: group.condition,
        timeBoundary: group.timeBoundary,
        venues,
        contractCount: children.length,
        ingestedChildCount: children.filter((child) => child.state === "INGESTED").length,
        lowConfidenceChildCount: children.filter((child) => child.candidateType === "LOW_CONFIDENCE").length,
        discoveredChildCount: children.filter((child) => child.state === "DISCOVERED").length,
        approvedChildCount: children.filter((child) => child.state === "APPROVED").length,
        rejectedChildCount: children.filter((child) => child.state === "REJECTED" || child.state === "SUPPRESSED").length,
        missingVenueEvidence: missingVenueEvidence(venues, "TOPIC"),
        children
      };
    })
    .filter((bundle): bundle is MarketDiscoveryTopicBundle => bundle !== null)
    .sort((left, right) =>
      right.ingestedChildCount - left.ingestedChildCount
      || right.contractCount - left.contractCount
      || left.topicTitle.localeCompare(right.topicTitle)
    );
};
