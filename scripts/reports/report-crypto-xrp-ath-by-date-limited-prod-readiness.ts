import "dotenv/config";

import { runCryptoXrpAthByDateLimitedProdReadiness } from "../../src/reports/crypto-xrp-ath-by-date-limited-prod-readiness.js";

await runCryptoXrpAthByDateLimitedProdReadiness({ repoRoot: process.cwd() });
