import "dotenv/config";

import { runCryptoEthAthByDateFamilyPass } from "../../src/reports/crypto-eth-ath-by-date-family-pass.js";

await runCryptoEthAthByDateFamilyPass({ repoRoot: process.cwd() });
