import { getCryptoAthByDateAssetConfig } from "./crypto-ath-by-date-assets.js";
import { buildCryptoAthByDateFamilyArtifacts, type CryptoAthByDateExtractedRow } from "./crypto-ath-by-date-shared.js";

const config = getCryptoAthByDateAssetConfig("SOL");

export type CryptoSolAthByDateExtractedRow = CryptoAthByDateExtractedRow;

export const buildCryptoSolAthByDateFamilyArtifacts = (rows: readonly CryptoAthByDateExtractedRow[]) =>
  buildCryptoAthByDateFamilyArtifacts(config, rows);
