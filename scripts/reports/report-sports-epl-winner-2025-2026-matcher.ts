import "dotenv/config";
import path from "node:path";

import { runSportsEplWinner20252026MatcherPass } from "../../src/reports/sports-epl-winner-2025-2026-matcher.js";

const main = async () => {
  await runSportsEplWinner20252026MatcherPass({
    repoRoot: path.resolve(process.cwd())
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
