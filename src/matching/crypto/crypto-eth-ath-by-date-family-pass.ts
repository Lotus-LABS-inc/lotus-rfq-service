import { getCryptoAthByDateAssetConfig } from "./crypto-ath-by-date-assets.js";
import { buildCryptoAthByDateFamilyArtifacts, type CryptoAthByDateExtractedRow } from "./crypto-ath-by-date-shared.js";

const config = getCryptoAthByDateAssetConfig("ETH");

export type CryptoEthAthByDateExtractedRow = CryptoAthByDateExtractedRow;

export const buildCryptoEthAthByDateFamilyArtifacts = (rows: readonly CryptoAthByDateExtractedRow[]) =>
  buildCryptoAthByDateFamilyArtifacts(config, rows);
