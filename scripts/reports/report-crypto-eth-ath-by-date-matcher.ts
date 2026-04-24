import "dotenv/config";

import { runCryptoEthAthByDateMatcherPass } from "../../src/reports/crypto-eth-ath-by-date-matcher.js";

await runCryptoEthAthByDateMatcherPass({ repoRoot: process.cwd() });
