import { getCryptoThresholdByDateAssetConfig } from "../matching/crypto/crypto-threshold-by-date-assets.js";
import { runCryptoThresholdByDateFamilyPass } from "./crypto-threshold-by-date-shared.js";

export const runCryptoSolThresholdByDateFamilyPass = async (input: { repoRoot: string }) =>
  runCryptoThresholdByDateFamilyPass({ repoRoot: input.repoRoot, config: getCryptoThresholdByDateAssetConfig("SOL") });
