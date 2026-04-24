import { getCryptoFirstToThresholdByDateAssetConfig } from "../matching/crypto/crypto-first-to-threshold-by-date-assets.js";
import { runCryptoFirstToThresholdByDateMatcherPass } from "./crypto-first-to-threshold-by-date-shared.js";

export const runCryptoSolFirstToThresholdByDateMatcherPass = async (input: { repoRoot: string }) =>
  runCryptoFirstToThresholdByDateMatcherPass({
    repoRoot: input.repoRoot,
    config: getCryptoFirstToThresholdByDateAssetConfig("SOL")
  });
