#!/usr/bin/env tsx
import { runCryptoBnbThresholdByDateMatcherPass } from "../../src/reports/crypto-bnb-threshold-by-date-matcher.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoBnbThresholdByDateMatcherPass({ repoRoot }); console.log(JSON.stringify(result.finalDecision, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto BNB threshold by date matcher."); console.error(error); process.exit(1); });
