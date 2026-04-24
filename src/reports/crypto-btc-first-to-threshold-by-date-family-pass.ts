import { getCryptoFirstToThresholdByDateAssetConfig } from "../matching/crypto/crypto-first-to-threshold-by-date-assets.js";
import { runCryptoFirstToThresholdByDateFamilyPass } from "./crypto-first-to-threshold-by-date-shared.js";

export const runCryptoBtcFirstToThresholdByDateFamilyPass = async (input: { repoRoot: string }) =>
  runCryptoFirstToThresholdByDateFamilyPass({
    repoRoot: input.repoRoot,
    config: getCryptoFirstToThresholdByDateAssetConfig("BTC")
  });
