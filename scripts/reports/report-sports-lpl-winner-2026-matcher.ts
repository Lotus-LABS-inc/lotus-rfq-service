import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsLplWinner2026MatcherPass } from "../../src/reports/sports-lpl-winner-2026-matcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

await runSportsLplWinner2026MatcherPass({ repoRoot });
