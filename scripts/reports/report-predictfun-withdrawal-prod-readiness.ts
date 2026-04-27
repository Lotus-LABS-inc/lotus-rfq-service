import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  buildPredictFunWithdrawalProdReadiness,
  renderPredictFunWithdrawalProdReadinessMarkdown,
  type WithdrawalCompletionGateArtifact,
  type WithdrawalControlledPersistenceArtifact
} from "../../src/core/funding/withdrawal-operator-reports.js";
import type { WithdrawalEvidenceSmokeArtifact } from "../../src/core/funding/withdrawal-evidence.js";

loadDotenv();

const artifactDir = join(process.cwd(), "artifacts", "funding");
const smokeArtifactPath = process.env.PREDICT_FUN_WITHDRAWAL_EVIDENCE_SMOKE_ARTIFACT_PATH?.trim() ||
  join(artifactDir, "predict-fun-withdrawal-evidence-smoke-test.json");
const completionGateArtifactPath = join(artifactDir, "predict-fun-withdrawal-completion-persistence-gate.json");
const controlledPersistenceArtifactPath = join(artifactDir, "withdrawal-completion-controlled-persistence-test.json");
const outputJsonPath = join(artifactDir, "predict-fun-withdrawal-prod-readiness.json");
const outputMarkdownPath = join(artifactDir, "predict-fun-withdrawal-prod-readiness.md");

const artifact = buildPredictFunWithdrawalProdReadiness({
  now: new Date(),
  env: process.env,
  smokeArtifactPath,
  smokeArtifact: await readJson<WithdrawalEvidenceSmokeArtifact>(smokeArtifactPath),
  completionGateArtifactPath,
  completionGateArtifact: await readJson<WithdrawalCompletionGateArtifact>(completionGateArtifactPath),
  controlledPersistenceArtifactPath,
  controlledPersistenceArtifact: await readJson<WithdrawalControlledPersistenceArtifact>(controlledPersistenceArtifactPath)
});

await mkdir(artifactDir, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(outputMarkdownPath, `${renderPredictFunWithdrawalProdReadinessMarkdown(artifact)}\n`, "utf8");

console.log(`Predict.fun withdrawal production readiness: ${artifact.status}`);
console.log(`artifact=${outputJsonPath}`);

if (artifact.status !== "PASSED") {
  for (const blocker of artifact.blockers) {
    console.error(`- ${blocker}`);
  }
  process.exitCode = 1;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}
