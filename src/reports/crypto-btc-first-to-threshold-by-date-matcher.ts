import { getCryptoFirstToThresholdByDateAssetConfig } from "../matching/crypto/crypto-first-to-threshold-by-date-assets.js";
import { runCryptoFirstToThresholdByDateMatcherPass } from "./crypto-first-to-threshold-by-date-shared.js";

export const runCryptoBtcFirstToThresholdByDateMatcherPass = async (input: { repoRoot: string }) =>
  runCryptoFirstToThresholdByDateMatcherPass({
    repoRoot: input.repoRoot,
    config: getCryptoFirstToThresholdByDateAssetConfig("BTC")
  });
