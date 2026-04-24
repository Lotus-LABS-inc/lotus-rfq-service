import { getCryptoAthByDateAssetConfig } from "../matching/crypto/crypto-ath-by-date-assets.js";
import { runCryptoAthByDateFamilyPass } from "./crypto-ath-by-date-shared.js";

export const runCryptoSolAthByDateFamilyPass = async (input: { repoRoot: string }) =>
  runCryptoAthByDateFamilyPass({ repoRoot: input.repoRoot, config: getCryptoAthByDateAssetConfig("SOL") });
