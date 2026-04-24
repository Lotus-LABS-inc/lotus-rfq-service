import { getCryptoThresholdByDateAssetConfig } from "../matching/crypto/crypto-threshold-by-date-assets.js";
import { runCryptoThresholdByDateMatcherPass } from "./crypto-threshold-by-date-shared.js";

export const runCryptoEthThresholdByDateMatcherPass = async (input: { repoRoot: string }) =>
  runCryptoThresholdByDateMatcherPass({ repoRoot: input.repoRoot, config: getCryptoThresholdByDateAssetConfig("ETH") });
