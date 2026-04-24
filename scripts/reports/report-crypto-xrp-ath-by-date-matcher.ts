import "dotenv/config";

import { runCryptoXrpAthByDateMatcherPass } from "../../src/reports/crypto-xrp-ath-by-date-matcher.js";

await runCryptoXrpAthByDateMatcherPass({ repoRoot: process.cwd() });
