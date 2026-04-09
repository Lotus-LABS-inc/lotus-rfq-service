import { buildStableTextId, canonicalizeJsonRecord, normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { StructuralFingerprint } from "../matching-types.js";
import type { PoliticsDerivedFamilyDefinition, PoliticsExtractedRow, PoliticsStructuralFingerprintRecord } from "./politics-types.js";

const FINGERPRINT_VERSION = "politics-structural-fingerprint-v1";

export const buildPoliticsStructuralFingerprintRecord = (
  row: PoliticsExtractedRow,
  definition: PoliticsDerivedFamilyDefinition | undefined
): PoliticsStructuralFingerprintRecord => {
  const missingCriticalComponents = (definition?.requiredStructuralFields ?? [])
    .filter((field) => {
      const value = row[field as keyof PoliticsExtractedRow];
      return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    });
  return {
    interpretedContractId: row.interpretedContractId,
    family: row.family,
    jurisdiction: row.jurisdiction,
    office: row.office,
    institution: row.institution,
    chamber: row.chamber,
    branch: row.branch,
    cycleYear: row.cycleYear,
    contestStage: row.contestStage,
    candidateSetFingerprint: row.candidateSetFingerprint,
    partyStructureFingerprint: row.partyStructureFingerprint,
    thresholdSemantics: row.thresholdSemantics,
    dateBoundarySemantics: row.dateBoundarySemantics,
    outcomeStructureType: row.outcomeStructureType,
    resolutionBasisFingerprint: row.resolutionBasisHints.length > 0 ? row.resolutionBasisHints.join("|") : null,
    eventType: row.eventType,
    sourceConfidence: row.extractionConfidence,
    missingCriticalComponents
  };
};

export const buildPoliticsStructuralFingerprint = (
  row: PoliticsExtractedRow,
  definition: PoliticsDerivedFamilyDefinition | undefined
): StructuralFingerprint => {
  const record = buildPoliticsStructuralFingerprintRecord(row, definition);
  const fingerprint = canonicalizeJsonRecord({
    interpretedContractId: record.interpretedContractId,
    family: record.family,
    jurisdiction: record.jurisdiction,
    office: record.office,
    institution: record.institution,
    chamber: record.chamber,
    branch: record.branch,
    cycleYear: record.cycleYear,
    contestStage: record.contestStage,
    candidateSetFingerprint: record.candidateSetFingerprint,
    partyStructureFingerprint: record.partyStructureFingerprint,
    thresholdSemantics: record.thresholdSemantics,
    dateBoundarySemantics: record.dateBoundarySemantics,
    outcomeStructureType: record.outcomeStructureType,
    resolutionBasisFingerprint: record.resolutionBasisFingerprint,
    eventType: record.eventType,
    sourceConfidence: record.sourceConfidence,
    missingCriticalComponents: record.missingCriticalComponents
  });
  return {
    interpretedContractId: row.interpretedContractId,
    fingerprintHash: buildStableTextId("politicsfp_", JSON.stringify(fingerprint)),
    fingerprint,
    normalizedValues: canonicalizeJsonRecord({
      normalizedTitle: normalizeFreeText(row.title),
      normalizedRules: normalizeFreeText(row.rulesText ?? ""),
      normalizedJurisdiction: row.jurisdiction,
      normalizedFamily: row.family
    }),
    unresolvedDimensions: record.missingCriticalComponents,
    provenance: canonicalizeJsonRecord({
      extractionConfidence: row.extractionConfidence,
      parseFailures: row.parseFailures,
      fingerprintVersion: FINGERPRINT_VERSION
    }),
    fingerprintVersion: FINGERPRINT_VERSION
  };
};
