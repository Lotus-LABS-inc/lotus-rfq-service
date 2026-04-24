import "dotenv/config";

import { runCryptoSolAthByDateFamilyPass } from "../../src/reports/crypto-sol-ath-by-date-family-pass.js";

await runCryptoSolAthByDateFamilyPass({ repoRoot: process.cwd() });
