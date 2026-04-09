import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsWorldCupWinner2026LimitedProdReadinessPass } from "../../src/reports/sports-world-cup-winner-2026-limited-prod-readiness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

await runSportsWorldCupWinner2026LimitedProdReadinessPass({ repoRoot });
