#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

interface CommandSummary {
  label: string;
  command: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
}

const tail = (value: string): string => value.trim().split(/\r?\n/).slice(-20).join("\n");

const run = async (
  script: string,
  args: readonly string[] = [],
  label = script
): Promise<CommandSummary> => {
  const fullArgs = ["run", script, ...(args.length > 0 ? ["--", ...args] : [])];
  const result = spawnSync(npmCommand, fullArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  return {
    label,
    command: `${npmCommand} ${fullArgs.join(" ")}`,
    exitCode: result.status ?? 1,
    stdoutTail: tail(result.stdout ?? ""),
    stderrTail: tail(result.stderr ?? "")
  };
};

const main = async (): Promise<void> => {
  const commands: readonly { label: string; script: string; args?: readonly string[] }[] = [
    { label: "venue-refresh", script: "batch:venues:refresh" },
    { label: "cross-venue-matches-initial", script: "report:cross-venue:matches" },
    { label: "semantic-suggestions-apply", script: "report:semantic-rulepack:suggestions", args: ["--apply=true"] },
    { label: "cross-venue-matches-refreshed", script: "report:cross-venue:matches", args: ["--afterRulepackRefresh=true"] },
    { label: "semantic-exact-sync", script: "sync:canonical:semantic-exacts" },
    { label: "simulation-canonical-events", script: "report:simulation:canonical-events" },
    { label: "simulation-routeability-summary", script: "report:simulation:routeability-summary" }
  ];

  const results: CommandSummary[] = [];
  for (const command of commands) {
    const result = await run(command.script, command.args, command.label);
    results.push(result);
    if (result.exitCode !== 0) {
      break;
    }
  }

  const summary = {
    observedAt: new Date().toISOString(),
    commands: results
  };
  writeArtifact(process.cwd(), "docs/blocker-reduction-pass-summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("Failed to run blocker reduction pass.");
  console.error(error);
  process.exit(1);
});
