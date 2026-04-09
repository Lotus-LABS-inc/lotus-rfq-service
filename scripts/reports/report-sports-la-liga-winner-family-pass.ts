import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import { runSportsLaLigaWinnerFamilyPass } from "../../src/reports/sports-la-liga-winner-family-pass.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const main = async (): Promise<void> => {
  await runSportsLaLigaWinnerFamilyPass({ repoRoot });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
