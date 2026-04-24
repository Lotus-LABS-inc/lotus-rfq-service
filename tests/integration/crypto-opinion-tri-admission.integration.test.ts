import { describe, expect, it } from "vitest";

import { getCryptoFdvAfterLaunchProjectConfig } from "../../src/matching/crypto/crypto-fdv-after-launch-assets.js";
import {
  buildCryptoFdvAfterLaunchFamilyArtifacts,
  type CryptoFdvAfterLaunchExtractedRow
} from "../../src/matching/crypto/crypto-fdv-after-launch-shared.js";
import {
  getCryptoTokenLaunchByDateProjectConfig
} from "../../src/matching/crypto/crypto-token-launch-by-date-assets.js";
import {
  buildCryptoTokenLaunchByDateFamilyArtifacts,
  type CryptoTokenLaunchByDateExtractedRow
} from "../../src/matching/crypto/crypto-token-launch-by-date-shared.js";
import {
  auditCryptoFdvAfterLaunchOpinionTriAdmission,
  auditCryptoTokenLaunchByDateOpinionTriAdmission
} from "../../src/matching/crypto/crypto-opinion-tri-admission.js";

const fdvRow = (
  venue: CryptoFdvAfterLaunchExtractedRow["venue"],
  thresholdLabel: string,
  rulesText = `FDV above ${thresholdLabel} one day after launch.`
): CryptoFdvAfterLaunchExtractedRow => ({
  interpretedContractId: `${venue.toLowerCase()}-${thresholdLabel}`,
  venue,
  venueMarketId: `${venue.toLowerCase()}-${thresholdLabel}`,
  sourceUrl: `https://${venue.toLowerCase()}.test`,
  title: `FDV above ${thresholdLabel} one day after launch?`,
  rulesText,
  thresholdLabel
});

const launchRow = (
  venue: CryptoTokenLaunchByDateExtractedRow["venue"],
  dateKey: string,
  rulesText = `Token launch by ${dateKey}.`
): CryptoTokenLaunchByDateExtractedRow => ({
  interpretedContractId: `${venue.toLowerCase()}-${dateKey}`,
  venue,
  venueMarketId: `${venue.toLowerCase()}-${dateKey}`,
  sourceUrl: `https://${venue.toLowerCase()}.test`,
  title: `Will token launch by ${dateKey}?`,
  rulesText,
  dateKey
});

describe("crypto Opinion tri admission audit", () => {
  it("admits an exact FDV tri core only when OPINION, POLYMARKET, and PREDICT all align", () => {
    const config = getCryptoFdvAfterLaunchProjectConfig("METAMASK");
    const family = buildCryptoFdvAfterLaunchFamilyArtifacts(config, [
      fdvRow("POLYMARKET", "$1B"),
      fdvRow("PREDICT", "$1B"),
      fdvRow("OPINION", "$1B")
    ]);

    const audit = auditCryptoFdvAfterLaunchOpinionTriAdmission({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(audit.status).toBe("TRI_EXACT_ADMITTED");
    expect(audit.admittedTriTopicKeys).toEqual([
      "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|METAMASK|ONE_DAY_AFTER_LAUNCH|ABOVE|1000000000"
    ]);
  });

  it("keeps Opinion fail-closed when configured Opinion rows are missing", () => {
    const config = getCryptoFdvAfterLaunchProjectConfig("OPENSEA");
    const family = buildCryptoFdvAfterLaunchFamilyArtifacts(config, [
      fdvRow("POLYMARKET", "$1B"),
      fdvRow("PREDICT", "$1B")
    ]);

    const audit = auditCryptoFdvAfterLaunchOpinionTriAdmission({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(audit.status).toBe("NOT_ADMITTED_FETCH_UNCERTAIN");
    expect(audit.notes).toContain("opinion_rows_missing_or_unparsed");
  });

  it("rejects Opinion venue-only FDV tails instead of widening into a tri lane", () => {
    const config = getCryptoFdvAfterLaunchProjectConfig("METAMASK");
    const family = buildCryptoFdvAfterLaunchFamilyArtifacts(config, [
      fdvRow("POLYMARKET", "$1B"),
      fdvRow("PREDICT", "$1B"),
      fdvRow("OPINION", "$700M")
    ]);

    const audit = auditCryptoFdvAfterLaunchOpinionTriAdmission({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(audit.status).toBe("TRI_NOT_ADMITTED");
    expect(audit.rejectedTopicKeys).toEqual([
      "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|METAMASK|ONE_DAY_AFTER_LAUNCH|ABOVE|700000000",
      "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|METAMASK|ONE_DAY_AFTER_LAUNCH|ABOVE|1000000000"
    ]);
  });

  it("marks duplicate Opinion FDV rows as review-required rather than exact-admitted", () => {
    const config = getCryptoFdvAfterLaunchProjectConfig("METAMASK");
    const family = buildCryptoFdvAfterLaunchFamilyArtifacts(config, [
      fdvRow("POLYMARKET", "$1B"),
      fdvRow("PREDICT", "$1B"),
      fdvRow("OPINION", "$1B"),
      {
        ...fdvRow("OPINION", "$1B"),
        interpretedContractId: "opinion-duplicate-1b",
        venueMarketId: "opinion-duplicate-1b"
      }
    ]);

    const audit = auditCryptoFdvAfterLaunchOpinionTriAdmission({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(audit.status).toBe("TRI_REVIEW_REQUIRED");
    expect(audit.topicAudits[0]?.notes).toContain("duplicate_opinion_rows=2");
  });

  it("marks semantically different token-launch rule wording as review-required", () => {
    const config = getCryptoTokenLaunchByDateProjectConfig("METAMASK");
    const family = buildCryptoTokenLaunchByDateFamilyArtifacts(config, [
      launchRow("POLYMARKET", "2026-06-30", "Token launch by 2026-06-30."),
      launchRow("PREDICT", "2026-06-30", "Token launch by 2026-06-30."),
      launchRow("OPINION", "2026-06-30", "Token generation event announced before 2026-06-30.")
    ]);

    const audit = auditCryptoTokenLaunchByDateOpinionTriAdmission({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(audit.status).toBe("TRI_REVIEW_REQUIRED");
    expect(audit.reviewRequiredTopicKeys).toEqual([
      "CRYPTO|TOKEN_LAUNCH_BY_DATE|METAMASK|2026-06-30"
    ]);
  });
});
