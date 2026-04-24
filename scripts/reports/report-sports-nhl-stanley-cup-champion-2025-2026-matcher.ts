import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsNhlStanleyCupChampion20252026MatcherPass } from "../../src/reports/sports-nhl-stanley-cup-champion-2025-2026-matcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

await runSportsNhlStanleyCupChampion20252026MatcherPass({ repoRoot });
