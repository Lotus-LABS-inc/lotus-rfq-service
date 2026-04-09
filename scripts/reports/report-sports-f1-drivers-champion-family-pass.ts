import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsF1DriversChampionFamilyPass } from "../../src/reports/sports-f1-drivers-champion-family-pass.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

await runSportsF1DriversChampionFamilyPass({ repoRoot });
