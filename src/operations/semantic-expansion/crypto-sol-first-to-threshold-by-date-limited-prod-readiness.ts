import { getCryptoFirstToThresholdByDateAssetConfig } from "../../matching/crypto/crypto-first-to-threshold-by-date-assets.js";
import {
  buildCryptoFirstToThresholdByDateLimitedProdReadinessArtifacts,
  loadCryptoFirstToThresholdByDateMatcherArtifacts,
  runCryptoFirstToThresholdByDateLimitedProdReadiness
} from "./crypto-first-to-threshold-by-date-limited-prod-readiness-shared.js";

const config = getCryptoFirstToThresholdByDateAssetConfig("SOL");

export const loadCryptoSolFirstToThresholdByDateMatcherArtifacts = (repoRoot: string) =>
  loadCryptoFirstToThresholdByDateMatcherArtifacts(repoRoot, config);

export const buildCryptoSolFirstToThresholdByDateLimitedProdReadinessArtifacts = (input: {
  inputSummary: any;
  pairLanes: any;
  rejections: any;
  finalDecision: any;
}) => buildCryptoFirstToThresholdByDateLimitedProdReadinessArtifacts({
  config,
  ...input
});

export const runCryptoSolFirstToThresholdByDateLimitedProdReadiness = async (input: {
  repoRoot: string;
}) => runCryptoFirstToThresholdByDateLimitedProdReadiness({
  repoRoot: input.repoRoot,
  config
});
