import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsNbaChampion20252026LimitedProdReadinessPass } from "../../src/reports/sports-nba-champion-2025-2026-limited-prod-readiness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

await runSportsNbaChampion20252026LimitedProdReadinessPass({
  repoRoot
});
