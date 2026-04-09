import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsF1ConstructorsChampion2026MatcherPass } from "../../src/reports/sports-f1-constructors-champion-2026-matcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

await runSportsF1ConstructorsChampion2026MatcherPass({ repoRoot });
