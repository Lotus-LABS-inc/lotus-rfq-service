import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import { runSportsLaLigaWinner20252026MatcherPass } from "../../src/reports/sports-la-liga-winner-2025-2026-matcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const main = async (): Promise<void> => {
  await runSportsLaLigaWinner20252026MatcherPass({ repoRoot });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
