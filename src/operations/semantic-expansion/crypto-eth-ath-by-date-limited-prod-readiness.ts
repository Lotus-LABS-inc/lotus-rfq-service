import { getCryptoAthByDateAssetConfig } from "../../matching/crypto/crypto-ath-by-date-assets.js";
import {
  buildCryptoAthByDateLimitedProdReadinessArtifacts,
  runCryptoAthByDateLimitedProdReadiness
} from "./crypto-ath-by-date-limited-prod-readiness-shared.js";

const config = getCryptoAthByDateAssetConfig("ETH");

export const buildCryptoEthAthByDateLimitedProdReadinessArtifacts = (input: {
  inputSummary: any;
  pairLanes: any;
  rejections: any;
  finalDecision: any;
}) => buildCryptoAthByDateLimitedProdReadinessArtifacts({
  config,
  ...input
});

export const runCryptoEthAthByDateLimitedProdReadiness = async (input: { repoRoot: string }) =>
  runCryptoAthByDateLimitedProdReadiness({ repoRoot: input.repoRoot, config });
