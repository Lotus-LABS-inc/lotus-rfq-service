import "dotenv/config";
import path from "node:path";

import { runSportsChampionsLeagueWinnerFamilyPass } from "../../src/reports/sports-champions-league-winner-family-pass.js";

const main = async () => {
  await runSportsChampionsLeagueWinnerFamilyPass({
    repoRoot: path.resolve(process.cwd())
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
