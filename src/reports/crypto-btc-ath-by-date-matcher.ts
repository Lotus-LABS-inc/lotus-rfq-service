import { getCryptoAthByDateAssetConfig } from "../matching/crypto/crypto-ath-by-date-assets.js";
import { runCryptoAthByDateMatcherPass } from "./crypto-ath-by-date-shared.js";

export const runCryptoBtcAthByDateMatcherPass = async (input: { repoRoot: string }) =>
  runCryptoAthByDateMatcherPass({
    repoRoot: input.repoRoot,
    config: getCryptoAthByDateAssetConfig("BTC")
  });
