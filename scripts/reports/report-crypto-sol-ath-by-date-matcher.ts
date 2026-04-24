import "dotenv/config";

import { runCryptoSolAthByDateMatcherPass } from "../../src/reports/crypto-sol-ath-by-date-matcher.js";

await runCryptoSolAthByDateMatcherPass({ repoRoot: process.cwd() });
