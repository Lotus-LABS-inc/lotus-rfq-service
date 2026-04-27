import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { HttpClient, PortfolioFetcher } from "@limitless-exchange/sdk";

import { runLimitlessSdkAuthDryRun, type LimitlessSdkAuthDryRunArtifact } from "../../src/core/funding/limitless-sdk-auth-dry-run.js";

loadDotenv();

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "limitless-sdk-auth-dry-run.json");
const artifactMdPath = join(artifactDir, "limitless-sdk-auth-dry-run.md");

const artifact = await runLimitlessSdkAuthDryRun({
  sdk: {
    HttpClient,
    PortfolioFetcher
  }
});

await mkdir(artifactDir, { recursive: true });
await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(artifactMdPath, renderMarkdown(artifact), "utf8");

console.log(`Limitless SDK auth dry run: ${artifact.status}`);
console.log(`Artifact JSON: ${artifactJsonPath}`);
console.log(`Artifact MD: ${artifactMdPath}`);
if (artifact.status !== "COMPLETED") {
  process.exitCode = 1;
}

function renderMarkdown(artifact: LimitlessSdkAuthDryRunArtifact): string {
  return `# Limitless SDK Auth Dry Run

- generatedAt: ${artifact.generatedAt}
- status: ${artifact.status}
- mode: ${artifact.mode}
- baseUrlHost: ${artifact.config.baseUrlHost ?? "none"}
- tokenIdConfigured: ${artifact.config.tokenIdConfigured}
- hmacSecretConfigured: ${artifact.config.hmacSecretConfigured}
- onBehalfOfProfileIdConfigured: ${artifact.config.onBehalfOfProfileIdConfigured}
- profileWalletAddressConfigured: ${artifact.config.profileWalletAddressConfigured}
- positionsRead: ${artifact.calls.positions.ok}
- historyRead: ${artifact.calls.history.ok}
- profileReadAttempted: ${artifact.calls.profile.attempted}
- profileRead: ${artifact.calls.profile.ok}
- redactionVerified: ${artifact.redactionVerified}
- liveVenueWithdrawalEndpointCalled: ${artifact.safety.liveVenueWithdrawalEndpointCalled}
- backendSignedTransaction: ${artifact.safety.backendSignedTransaction}
- backendBroadcastedTransaction: ${artifact.safety.backendBroadcastedTransaction}
- completionPersisted: ${artifact.safety.completionPersisted}
- blockers: ${artifact.blockers.length ? artifact.blockers.join("; ") : "none"}
`;
}
