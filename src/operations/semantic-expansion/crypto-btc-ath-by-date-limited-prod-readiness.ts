import { getCryptoAthByDateAssetConfig } from "../../matching/crypto/crypto-ath-by-date-assets.js";
import {
  buildCryptoAthByDateLimitedProdReadinessArtifacts,
  loadCryptoAthByDateMatcherArtifacts,
  runCryptoAthByDateLimitedProdReadiness
} from "./crypto-ath-by-date-limited-prod-readiness-shared.js";

const config = getCryptoAthByDateAssetConfig("BTC");

export const loadCryptoBtcAthByDateMatcherArtifacts = (repoRoot: string) =>
  loadCryptoAthByDateMatcherArtifacts(repoRoot, config);

export const buildCryptoBtcAthByDateLimitedProdReadinessArtifacts = (input: {
  inputSummary: any;
  pairLanes: any;
  rejections: any;
  finalDecision: any;
}) => buildCryptoAthByDateLimitedProdReadinessArtifacts({
  config,
  ...input
});

export const runCryptoBtcAthByDateLimitedProdReadiness = async (input: {
  repoRoot: string;
}) => runCryptoAthByDateLimitedProdReadiness({
  repoRoot: input.repoRoot,
  config
});
