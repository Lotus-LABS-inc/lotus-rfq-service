import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  buildWithdrawalRolloutStatus,
  renderWithdrawalRolloutStatusMarkdown
} from "../../src/core/funding/withdrawal-operator-reports.js";

loadDotenv();

const artifactDir = join(process.cwd(), "artifacts", "funding");
const outputJsonPath = join(artifactDir, "withdrawal-rollout-status.json");
const outputMarkdownPath = join(artifactDir, "withdrawal-rollout-status.md");
const artifact = buildWithdrawalRolloutStatus(new Date());

await mkdir(artifactDir, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(outputMarkdownPath, `${renderWithdrawalRolloutStatusMarkdown(artifact)}\n`, "utf8");

console.log(`Withdrawal rollout status: ${artifact.status}`);
console.log(`artifact=${outputJsonPath}`);
