import type {
  CryptoFdvAfterLaunchComparabilityTopicSummary,
  CryptoFdvAfterLaunchNormalizedTopicRow
} from "./crypto-fdv-after-launch-shared.js";
import type { CryptoFdvAfterLaunchProjectConfig } from "./crypto-fdv-after-launch-assets.js";
import type {
  CryptoTokenLaunchByDateComparabilityTopicSummary,
  CryptoTokenLaunchByDateNormalizedTopicRow
} from "./crypto-token-launch-by-date-shared.js";
import type { CryptoTokenLaunchByDateProjectConfig } from "./crypto-token-launch-by-date-assets.js";

type TriAdmissionStatus =
  | "NOT_CONFIGURED"
  | "NOT_ADMITTED_FETCH_UNCERTAIN"
  | "TRI_EXACT_ADMITTED"
  | "TRI_REVIEW_REQUIRED"
  | "TRI_NOT_ADMITTED";

type RuleStatus = "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";

export interface CryptoOpinionTriAdmissionTopicAudit {
  canonicalTopicKey: string;
  venuesPresent: readonly string[];
  status: Exclude<TriAdmissionStatus, "NOT_CONFIGURED" | "NOT_ADMITTED_FETCH_UNCERTAIN">;
  ruleStatus: RuleStatus;
  notes: readonly string[];
}

export interface CryptoOpinionTriAdmissionAudit {
  familyKey: string;
  opinionMarketSlug: string | null;
  status: TriAdmissionStatus;
  admittedTriTopicKeys: readonly string[];
  reviewRequiredTopicKeys: readonly string[];
  rejectedTopicKeys: readonly string[];
  topicAudits: readonly CryptoOpinionTriAdmissionTopicAudit[];
  notes: readonly string[];
}

const REQUIRED_TRI_VENUES = ["OPINION", "POLYMARKET", "PREDICT"] as const;

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const duplicateVenueNotes = (rows: readonly { venue: string }[]): readonly string[] => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.venue, (counts.get(row.venue) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([venue, count]) => `duplicate_${venue.toLowerCase()}_rows=${count}`);
};

const buildTriAudit = (input: {
  familyKey: string;
  opinionMarketSlug: string | undefined;
  rows: readonly { venue: string; canonicalTopicKey: string | null; rejectionReason: string | null }[];
  comparabilitySummary: readonly {
    canonicalTopicKey: string;
    venuesPresent: readonly string[];
    ruleCompatibilityClassification: RuleStatus;
  }[];
}): CryptoOpinionTriAdmissionAudit => {
  if (!input.opinionMarketSlug) {
    return {
      familyKey: input.familyKey,
      opinionMarketSlug: null,
      status: "NOT_CONFIGURED",
      admittedTriTopicKeys: [],
      reviewRequiredTopicKeys: [],
      rejectedTopicKeys: [],
      topicAudits: [],
      notes: ["opinion_market_not_configured"]
    };
  }

  const admittedRows = input.rows.filter((row) => row.rejectionReason === null && row.canonicalTopicKey !== null);
  if (!admittedRows.some((row) => row.venue === "OPINION")) {
    return {
      familyKey: input.familyKey,
      opinionMarketSlug: input.opinionMarketSlug,
      status: "NOT_ADMITTED_FETCH_UNCERTAIN",
      admittedTriTopicKeys: [],
      reviewRequiredTopicKeys: [],
      rejectedTopicKeys: input.comparabilitySummary.map((topic) => topic.canonicalTopicKey),
      topicAudits: [],
      notes: ["opinion_rows_missing_or_unparsed"]
    };
  }

  const rowsByTopic = new Map<string, typeof admittedRows>();
  for (const row of admittedRows) {
    const bucket = rowsByTopic.get(row.canonicalTopicKey!) ?? [];
    rowsByTopic.set(row.canonicalTopicKey!, [...bucket, row]);
  }

  const topicAudits = input.comparabilitySummary.map((topic) => {
    const rows = rowsByTopic.get(topic.canonicalTopicKey) ?? [];
    const venuesPresent = uniqueSorted(rows.map((row) => row.venue));
    const missingVenues = REQUIRED_TRI_VENUES.filter((venue) => !venuesPresent.includes(venue));
    const duplicateNotes = duplicateVenueNotes(rows);
    const notes = [
      ...duplicateNotes,
      ...(missingVenues.length > 0 ? [`missing_venues=${missingVenues.join("|")}`] : []),
      `rule_status=${topic.ruleCompatibilityClassification}`
    ];
    const triComplete = missingVenues.length === 0;
    const status: CryptoOpinionTriAdmissionTopicAudit["status"] =
      !triComplete ? "TRI_NOT_ADMITTED"
      : duplicateNotes.length > 0 || topic.ruleCompatibilityClassification !== "EXACT_RULE_COMPATIBLE"
        ? "TRI_REVIEW_REQUIRED"
        : "TRI_EXACT_ADMITTED";
    return {
      canonicalTopicKey: topic.canonicalTopicKey,
      venuesPresent,
      status,
      ruleStatus: topic.ruleCompatibilityClassification,
      notes
    } satisfies CryptoOpinionTriAdmissionTopicAudit;
  });

  const admittedTriTopicKeys = topicAudits
    .filter((topic) => topic.status === "TRI_EXACT_ADMITTED")
    .map((topic) => topic.canonicalTopicKey);
  const reviewRequiredTopicKeys = topicAudits
    .filter((topic) => topic.status === "TRI_REVIEW_REQUIRED")
    .map((topic) => topic.canonicalTopicKey);
  const rejectedTopicKeys = topicAudits
    .filter((topic) => topic.status === "TRI_NOT_ADMITTED")
    .map((topic) => topic.canonicalTopicKey);

  const status: TriAdmissionStatus =
    admittedTriTopicKeys.length > 0 && reviewRequiredTopicKeys.length === 0 && rejectedTopicKeys.length === 0
      ? "TRI_EXACT_ADMITTED"
      : admittedTriTopicKeys.length > 0 || reviewRequiredTopicKeys.length > 0
        ? "TRI_REVIEW_REQUIRED"
        : "TRI_NOT_ADMITTED";

  return {
    familyKey: input.familyKey,
    opinionMarketSlug: input.opinionMarketSlug,
    status,
    admittedTriTopicKeys,
    reviewRequiredTopicKeys,
    rejectedTopicKeys,
    topicAudits,
    notes: status === "TRI_EXACT_ADMITTED"
      ? ["opinion_tri_exact_core_available"]
      : ["opinion_tri_fail_closed_until_exact_core_is_proven"]
  };
};

export const auditCryptoFdvAfterLaunchOpinionTriAdmission = (input: {
  config: CryptoFdvAfterLaunchProjectConfig;
  normalizedTopics: readonly CryptoFdvAfterLaunchNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoFdvAfterLaunchComparabilityTopicSummary[];
}): CryptoOpinionTriAdmissionAudit =>
  buildTriAudit({
    familyKey: input.config.familyKey,
    opinionMarketSlug: input.config.opinionMarketSlug,
    rows: input.normalizedTopics,
    comparabilitySummary: input.comparabilitySummary
  });

export const auditCryptoTokenLaunchByDateOpinionTriAdmission = (input: {
  config: CryptoTokenLaunchByDateProjectConfig;
  normalizedTopics: readonly CryptoTokenLaunchByDateNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoTokenLaunchByDateComparabilityTopicSummary[];
}): CryptoOpinionTriAdmissionAudit =>
  buildTriAudit({
    familyKey: input.config.familyKey,
    opinionMarketSlug: input.config.opinionMarketSlug,
    rows: input.normalizedTopics,
    comparabilitySummary: input.comparabilitySummary
  });
