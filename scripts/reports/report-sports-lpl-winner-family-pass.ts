import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSportsLplWinnerFamilyPass } from "../../src/reports/sports-lpl-winner-family-pass.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

await runSportsLplWinnerFamilyPass({ repoRoot });
