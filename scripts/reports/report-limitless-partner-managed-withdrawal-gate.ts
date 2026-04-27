import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv,
  renderLimitlessPartnerManagedWithdrawalGateMarkdown,
  validateLimitlessPartnerManagedWithdrawalApproval
} from "../../src/core/funding/limitless-partner-managed-withdrawal-gate.js";

loadDotenv();

const artifactDir = join(process.cwd(), "artifacts", "funding");
const outputJsonPath = join(artifactDir, "limitless-partner-managed-withdrawal-gate.json");
const outputMarkdownPath = join(artifactDir, "limitless-partner-managed-withdrawal-gate.md");

const config = buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv(process.env);
const artifact = validateLimitlessPartnerManagedWithdrawalApproval(config, "OPERATOR_INTERNAL_GATE");

await mkdir(artifactDir, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(outputMarkdownPath, `${renderLimitlessPartnerManagedWithdrawalGateMarkdown(artifact)}\n`, "utf8");

console.log(`Limitless partner-managed withdrawal gate: ${artifact.status}`);
if (artifact.blockers.length > 0) {
  for (const blocker of artifact.blockers) {
    console.log(`- ${blocker}`);
  }
}
console.log(`artifact=${outputJsonPath}`);
