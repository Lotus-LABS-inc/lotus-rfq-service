import "dotenv/config";

import { runCryptoXrpAthByDateFamilyPass } from "../../src/reports/crypto-xrp-ath-by-date-family-pass.js";

await runCryptoXrpAthByDateFamilyPass({ repoRoot: process.cwd() });
