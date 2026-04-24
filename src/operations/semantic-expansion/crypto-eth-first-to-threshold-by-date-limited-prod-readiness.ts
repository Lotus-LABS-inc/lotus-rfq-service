import { getCryptoFirstToThresholdByDateAssetConfig } from "../../matching/crypto/crypto-first-to-threshold-by-date-assets.js";
import {
  buildCryptoFirstToThresholdByDateLimitedProdReadinessArtifacts,
  loadCryptoFirstToThresholdByDateMatcherArtifacts,
  runCryptoFirstToThresholdByDateLimitedProdReadiness
} from "./crypto-first-to-threshold-by-date-limited-prod-readiness-shared.js";

const config = getCryptoFirstToThresholdByDateAssetConfig("ETH");

export const loadCryptoEthFirstToThresholdByDateMatcherArtifacts = (repoRoot: string) =>
  loadCryptoFirstToThresholdByDateMatcherArtifacts(repoRoot, config);

export const buildCryptoEthFirstToThresholdByDateLimitedProdReadinessArtifacts = (input: {
  inputSummary: any;
  pairLanes: any;
  rejections: any;
  finalDecision: any;
}) => buildCryptoFirstToThresholdByDateLimitedProdReadinessArtifacts({
  config,
  ...input
});

export const runCryptoEthFirstToThresholdByDateLimitedProdReadiness = async (input: {
  repoRoot: string;
}) => runCryptoFirstToThresholdByDateLimitedProdReadiness({
  repoRoot: input.repoRoot,
  config
});
