#!/usr/bin/env tsx
import { runCryptoSolThresholdByDateMatcherPass } from "../../src/reports/crypto-sol-threshold-by-date-matcher.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoSolThresholdByDateMatcherPass({ repoRoot }); console.log(JSON.stringify(result.finalDecision, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto SOL threshold by date matcher."); console.error(error); process.exit(1); });
