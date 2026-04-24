import { getCryptoAthByDateAssetConfig } from "./crypto-ath-by-date-assets.js";
import { buildCryptoAthByDateFamilyArtifacts, type CryptoAthByDateExtractedRow } from "./crypto-ath-by-date-shared.js";

const config = getCryptoAthByDateAssetConfig("XRP");

export type CryptoXrpAthByDateExtractedRow = CryptoAthByDateExtractedRow;

export const buildCryptoXrpAthByDateFamilyArtifacts = (rows: readonly CryptoAthByDateExtractedRow[]) =>
  buildCryptoAthByDateFamilyArtifacts(config, rows);
