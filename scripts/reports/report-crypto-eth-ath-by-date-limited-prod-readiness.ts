import "dotenv/config";

import { runCryptoEthAthByDateLimitedProdReadiness } from "../../src/reports/crypto-eth-ath-by-date-limited-prod-readiness.js";

await runCryptoEthAthByDateLimitedProdReadiness({ repoRoot: process.cwd() });
