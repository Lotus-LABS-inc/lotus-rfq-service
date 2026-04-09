import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsNbaChampionFamilyPass } from "../../src/reports/sports-nba-champion-family-pass.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

await runSportsNbaChampionFamilyPass({ repoRoot });
