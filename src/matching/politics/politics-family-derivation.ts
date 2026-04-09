import type { ContractFamily } from "../matching-types.js";
import type {
  PoliticsDerivedFamily,
  PoliticsDerivedFamilyDefinition,
  PoliticsExtractedRow,
  PoliticsFamilyEligibility
} from "./politics-types.js";

const FAMILY_LABELS: Record<PoliticsDerivedFamily, string> = {
  OFFICE_WINNER: "office winner / next leader",
  PARTY_CONTROL: "party control / party winner",
  NOMINEE_WINNER: "nominee / primary winner",
  CONFIRMATION_APPOINTMENT: "confirmation / approval / appointment",
  THRESHOLD_BY_DATE: "threshold by date",
  OFFICE_EXIT_BY_DATE: "leader out / office exit by date",
  GEOPOLITICAL_EVENT_BY_DATE: "ceasefire / conflict / geopolitical event by date",
  GEOPOLITICAL_EVENT: "open-ended geopolitical event",
  DIRECTIONAL_RESIDUAL: "generic directional / residual",
  OUT_OF_SCOPE: "out of scope / too noisy"
};

const FAMILY_TO_CONTRACT: Record<PoliticsDerivedFamily, ContractFamily> = {
  OFFICE_WINNER: "POLITICS_OFFICE_WINNER",
  PARTY_CONTROL: "POLITICS_PARTY_CONTROL",
  NOMINEE_WINNER: "POLITICS_NOMINEE_WINNER",
  CONFIRMATION_APPOINTMENT: "POLITICS_CONFIRMATION_APPOINTMENT",
  THRESHOLD_BY_DATE: "POLITICS_THRESHOLD_BY_DATE",
  OFFICE_EXIT_BY_DATE: "POLITICS_OFFICE_EXIT_BY_DATE",
  GEOPOLITICAL_EVENT_BY_DATE: "POLITICS_GEOPOLITICAL_EVENT_BY_DATE",
  GEOPOLITICAL_EVENT: "DATE_BOUND_EVENT",
  DIRECTIONAL_RESIDUAL: "POLITICS_DIRECTIONAL_RESIDUAL",
  OUT_OF_SCOPE: "OTHER_EVENT_STYLE"
};

const REQUIRED_FIELDS: Record<PoliticsDerivedFamily, readonly string[]> = {
  OFFICE_WINNER: ["jurisdiction", "office", "cycleYear", "candidateSetFingerprint"],
  PARTY_CONTROL: ["jurisdiction", "office", "cycleYear"],
  NOMINEE_WINNER: ["jurisdiction", "office", "cycleYear", "candidateSetFingerprint"],
  CONFIRMATION_APPOINTMENT: ["jurisdiction", "institution", "eventType"],
  THRESHOLD_BY_DATE: ["jurisdiction", "thresholdSemantics", "dateBoundarySemantics"],
  OFFICE_EXIT_BY_DATE: ["jurisdiction", "office", "dateBoundarySemantics"],
  GEOPOLITICAL_EVENT_BY_DATE: ["jurisdiction", "eventType", "dateBoundarySemantics"],
  GEOPOLITICAL_EVENT: ["eventType"],
  DIRECTIONAL_RESIDUAL: ["jurisdiction"],
  OUT_OF_SCOPE: []
};

const EXCLUDED_PATTERNS: Record<PoliticsDerivedFamily, readonly string[]> = {
  OFFICE_WINNER: ["party control", "confirmation", "office exit", "geopolitical event"],
  PARTY_CONTROL: ["candidate-specific office winner", "nomination", "confirmation"],
  NOMINEE_WINNER: ["general election office winner", "party control"],
  CONFIRMATION_APPOINTMENT: ["office winner", "geopolitical event"],
  THRESHOLD_BY_DATE: ["office winner without threshold/date", "multi-candidate election winner"],
  OFFICE_EXIT_BY_DATE: ["office winner", "confirmation"],
  GEOPOLITICAL_EVENT_BY_DATE: ["electoral office winner", "party control"],
  GEOPOLITICAL_EVENT: ["date-bound geopolitical event", "electoral office winner"],
  DIRECTIONAL_RESIDUAL: ["structurally complete electoral or geopolitical rows"],
  OUT_OF_SCOPE: []
};

const FAMILY_DEFINITIONS: Record<PoliticsDerivedFamily, string> = {
  OFFICE_WINNER: "Binary or multi-candidate politics rows about winning a defined office in a defined jurisdiction and cycle.",
  PARTY_CONTROL: "Rows about which party controls a chamber, parliament, or equivalent institution.",
  NOMINEE_WINNER: "Rows about winning a nomination, primary, or party selection process.",
  CONFIRMATION_APPOINTMENT: "Rows about confirmations, approvals, appointments, or court-ruling style politics decisions.",
  THRESHOLD_BY_DATE: "Rows that combine a politics subject with a threshold or condition that must be satisfied by a date.",
  OFFICE_EXIT_BY_DATE: "Rows about whether a leader or office-holder leaves office by a date.",
  GEOPOLITICAL_EVENT_BY_DATE: "Rows about ceasefires, regime change, sanctions, or similar geopolitical events by a date.",
  GEOPOLITICAL_EVENT: "Rows about open-ended geopolitical events without a provable date boundary.",
  DIRECTIONAL_RESIDUAL: "Politics rows that look political but remain too generic for a stronger family without more structure.",
  OUT_OF_SCOPE: "Rows that are too noisy, too generic, or structurally outside the supported politics families."
};

const dedupe = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const determineEligibility = (family: PoliticsDerivedFamily, rows: readonly PoliticsExtractedRow[]): { eligibility: PoliticsFamilyEligibility; reason: string } => {
  if (family === "OUT_OF_SCOPE") {
    return { eligibility: "OUT_OF_SCOPE", reason: "The rows do not resolve into a stable politics structure." };
  }
  const distinctVenues = new Set(rows.map((row) => row.venue)).size;
  const noisyRows = rows.filter((row) => row.extractionConfidence === "LOW" || row.parseFailures.length >= 3).length;
  const mixedBasis = new Set(rows.map((row) => row.inventoryTemporalBasis)).size > 1;
  if (distinctVenues < 2) {
    return { eligibility: "TOO_THIN", reason: "The family does not recur across at least two venues in the observed inventory." };
  }
  if (noisyRows > Math.floor(rows.length / 3)) {
    return { eligibility: "TOO_NOISY", reason: "Too many rows are missing critical politics fields to support deterministic matching." };
  }
  if (family === "CONFIRMATION_APPOINTMENT" || family === "DIRECTIONAL_RESIDUAL") {
    return { eligibility: "ELIGIBLE_AFTER_SPLIT", reason: "The family recurs, but the observed rows still mix substructures that need further splitting before exact-safe matching." };
  }
  if (mixedBasis && distinctVenues >= 2 && new Set(rows.map((row) => row.inventoryTemporalBasis)).size > 1) {
    return { eligibility: "BASIS_FRAGMENTED", reason: "The family recurs across venues but not on a clean common basis slice." };
  }
  return { eligibility: "MATCHING_ELIGIBLE", reason: "The family recurs across venues with enough structural clarity for exact-safe matching." };
};

export const buildPoliticsDerivedFamilyTaxonomy = (
  rows: readonly PoliticsExtractedRow[]
): readonly PoliticsDerivedFamilyDefinition[] =>
  Object.entries(
    rows.reduce<Record<PoliticsDerivedFamily, PoliticsExtractedRow[]>>((acc, row) => {
      acc[row.family] ??= [];
      acc[row.family]!.push(row);
      return acc;
    }, {
      OFFICE_WINNER: [],
      PARTY_CONTROL: [],
      NOMINEE_WINNER: [],
      CONFIRMATION_APPOINTMENT: [],
      THRESHOLD_BY_DATE: [],
      OFFICE_EXIT_BY_DATE: [],
      GEOPOLITICAL_EVENT_BY_DATE: [],
      GEOPOLITICAL_EVENT: [],
      DIRECTIONAL_RESIDUAL: [],
      OUT_OF_SCOPE: []
    })
  ).map(([family, familyRowsRaw]) => {
    const typedFamily = family as PoliticsDerivedFamily;
    const familyRows = familyRowsRaw as PoliticsExtractedRow[];
    const venueCounts = familyRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.venue] = (acc[row.venue] ?? 0) + 1;
      return acc;
    }, {});
    const { eligibility, reason } = determineEligibility(typedFamily, familyRows);
    const confidence =
      familyRows.length === 0 ? "0"
      : familyRows.filter((row) => row.extractionConfidence === "HIGH").length >= Math.ceil(familyRows.length / 2) ? "0.9"
      : "0.6";
    return {
      family: typedFamily,
      familyLabel: FAMILY_LABELS[typedFamily],
      familyDefinition: FAMILY_DEFINITIONS[typedFamily],
      requiredStructuralFields: REQUIRED_FIELDS[typedFamily],
      excludedPatterns: EXCLUDED_PATTERNS[typedFamily],
      venueCounts,
      totalRows: familyRows.length,
      representativeExamples: familyRows.slice(0, 5).map((row) => ({
        venue: row.venue,
        title: row.title,
        interpretedContractId: row.interpretedContractId
      })),
      confidenceScore: confidence,
      eligibility,
      eligibilityReason: reason
    } satisfies PoliticsDerivedFamilyDefinition;
  }).sort((left, right) => left.family.localeCompare(right.family));

export const buildFamilyEligibilityLookup = (
  families: readonly PoliticsDerivedFamilyDefinition[]
): ReadonlyMap<PoliticsDerivedFamily, PoliticsFamilyEligibility> =>
  new Map(families.map((family) => [family.family, family.eligibility] as const));

export const toPoliticsContractFamily = (family: PoliticsDerivedFamily): ContractFamily => FAMILY_TO_CONTRACT[family];

export const collectPoliticsFamilyExamples = (rows: readonly PoliticsExtractedRow[]): Record<string, readonly { venue: string; title: string }[]> =>
  Object.fromEntries(
    [...dedupe(rows.map((row) => row.family))]
      .sort((left: PoliticsDerivedFamily, right: PoliticsDerivedFamily) => left.localeCompare(right))
      .map((family) => [
        family,
        rows
          .filter((row) => row.family === family)
          .slice(0, 5)
          .map((row) => ({ venue: row.venue, title: row.title }))
      ])
  );
