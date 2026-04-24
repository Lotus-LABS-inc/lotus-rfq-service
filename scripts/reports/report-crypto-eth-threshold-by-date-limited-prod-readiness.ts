#!/usr/bin/env tsx
import { runCryptoEthThresholdByDateApr2026LimitedProdReadiness } from "../../src/reports/crypto-eth-threshold-by-date-limited-prod-readiness.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoEthThresholdByDateApr2026LimitedProdReadiness({ repoRoot }); console.log(JSON.stringify(result.adminSurfaceSummary, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto ETH threshold by date limited-prod readiness."); console.error(error); process.exit(1); });
