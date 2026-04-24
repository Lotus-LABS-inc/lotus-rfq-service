import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsLckWinner2026LimitedProdReadiness } from "../../src/reports/sports-lck-winner-2026-limited-prod-readiness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

await runSportsLckWinner2026LimitedProdReadiness({ repoRoot });
