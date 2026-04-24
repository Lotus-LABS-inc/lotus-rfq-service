#!/usr/bin/env tsx
import { runCryptoSolThresholdByDateApr2026LimitedProdReadiness } from "../../src/reports/crypto-sol-threshold-by-date-limited-prod-readiness.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoSolThresholdByDateApr2026LimitedProdReadiness({ repoRoot }); console.log(JSON.stringify(result.adminSurfaceSummary, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto SOL threshold by date limited-prod readiness."); console.error(error); process.exit(1); });
