import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import { runSportsEplWinnerFamilyPass } from "../../src/reports/sports-epl-winner-family-pass.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const main = async (): Promise<void> => {
  await runSportsEplWinnerFamilyPass({ repoRoot });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
