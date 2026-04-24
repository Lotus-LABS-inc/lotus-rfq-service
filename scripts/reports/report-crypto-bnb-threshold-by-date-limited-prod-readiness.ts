#!/usr/bin/env tsx
import { runCryptoBnbThresholdByDateApr2026LimitedProdReadiness } from "../../src/reports/crypto-bnb-threshold-by-date-limited-prod-readiness.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoBnbThresholdByDateApr2026LimitedProdReadiness({ repoRoot }); console.log(JSON.stringify(result.adminSurfaceSummary, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto BNB threshold by date limited-prod readiness."); console.error(error); process.exit(1); });
