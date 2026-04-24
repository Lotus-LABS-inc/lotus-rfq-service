import { getCryptoThresholdByDateAssetConfig } from "../../matching/crypto/crypto-threshold-by-date-assets.js";
import {
  buildCryptoThresholdByDateLimitedProdReadinessArtifacts,
  runCryptoThresholdByDateLimitedProdReadiness
} from "./crypto-threshold-by-date-limited-prod-readiness-shared.js";

const config = getCryptoThresholdByDateAssetConfig("BNB");

export const buildCryptoBnbThresholdByDateLimitedProdReadinessArtifacts = (
  input: Omit<Parameters<typeof buildCryptoThresholdByDateLimitedProdReadinessArtifacts>[0], "config">
) =>
  buildCryptoThresholdByDateLimitedProdReadinessArtifacts({ ...input, config });

export const runCryptoBnbThresholdByDateLimitedProdReadiness = async (input: { repoRoot: string }) =>
  runCryptoThresholdByDateLimitedProdReadiness({ repoRoot: input.repoRoot, config });
