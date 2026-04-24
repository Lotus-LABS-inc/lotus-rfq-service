#!/usr/bin/env tsx
import { runCryptoEthThresholdByDateMatcherPass } from "../../src/reports/crypto-eth-threshold-by-date-matcher.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoEthThresholdByDateMatcherPass({ repoRoot }); console.log(JSON.stringify(result.finalDecision, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto ETH threshold by date matcher."); console.error(error); process.exit(1); });
