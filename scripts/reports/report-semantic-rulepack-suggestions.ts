#!/usr/bin/env tsx
import path from "node:path";

import { buildSemanticRulepackSuggestions } from "../../src/operations/semantic-expansion/semantic-rulepack-suggestions.js";
import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";

const args = new Map<string, string>();
for (const rawArg of process.argv.slice(2)) {
  if (!rawArg.startsWith("--")) {
    continue;
  }
  const [key, ...rest] = rawArg.slice(2).split("=");
  args.set(key, rest.join("="));
}

const main = async (): Promise<void> => {
  const result = buildSemanticRulepackSuggestions({
    repoRoot: process.cwd(),
    reportPath: args.get("reportPath") || undefined,
    apply: args.get("apply") === "true"
  });
  writeArtifact(process.cwd(), "docs/semantic-rulepack-suggestions.json", result.report);
  console.log(JSON.stringify({
    report: result.report,
    generatedRules: result.generatedRules.length,
    generatedRulepackPath: result.generatedRulepackPath ? path.relative(process.cwd(), result.generatedRulepackPath) : null
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to build semantic rulepack suggestions.");
  console.error(error);
  process.exit(1);
});

