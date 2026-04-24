#!/usr/bin/env tsx
import { runCryptoBtcThresholdByDateMatcherPass } from "../../src/reports/crypto-btc-threshold-by-date-matcher.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoBtcThresholdByDateMatcherPass({ repoRoot }); console.log(JSON.stringify(result.finalDecision, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto BTC threshold by date matcher."); console.error(error); process.exit(1); });
