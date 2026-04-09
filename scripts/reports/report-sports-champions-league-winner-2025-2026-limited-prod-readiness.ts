import "dotenv/config";
import path from "node:path";

import { runSportsChampionsLeagueWinner20252026LimitedProdReadinessPass } from "../../src/reports/sports-champions-league-winner-2025-2026-limited-prod-readiness.js";

const main = async () => {
  await runSportsChampionsLeagueWinner20252026LimitedProdReadinessPass({
    repoRoot: path.resolve(process.cwd())
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
