import "dotenv/config";

import { runCryptoSolAthByDateLimitedProdReadiness } from "../../src/reports/crypto-sol-ath-by-date-limited-prod-readiness.js";

await runCryptoSolAthByDateLimitedProdReadiness({ repoRoot: process.cwd() });
