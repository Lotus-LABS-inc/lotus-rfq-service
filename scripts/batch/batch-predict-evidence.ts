#!/usr/bin/env tsx
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { runPredictEvidenceProgram } from "../../src/operations/fast-testing/predict-evidence-program.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const execFileAsync = promisify(execFile);
const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const scriptPathByPackageScript: Readonly<Record<string, string>> = {
  "sync:predict:current-state": path.resolve(process.cwd(), "scripts", "sync-predict-current-state.ts"),
  "scan:predict:live-markets": path.resolve(process.cwd(), "scripts", "select-predict-live-markets.ts"),
  "record:predict:orderbooks": path.resolve(process.cwd(), "scripts", "record-predict-orderbooks.ts"),
  "scan:predict:predexon-fallback": path.resolve(process.cwd(), "scripts", "scan-predict-predexon-fallback-coverage.ts")
};

const executeTsxScript = async (
  scriptPath: string,
  args: readonly string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  try {
    const result = await execFileAsync(process.execPath, [tsxCliPath, scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    const resolved = error as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: resolved.stdout ?? "",
      stderr: resolved.stderr ?? "",
      exitCode: typeof resolved.code === "number" ? resolved.code : 1
    };
  }
};

interface ParsedArgs {
  environment: "mainnet" | "testnet";
  maxMarkets: number;
  maxPages: number;
  durationMs: number;
}

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }

  const environment = (args.get("environment") ?? "mainnet") as "mainnet" | "testnet";
  if (environment !== "mainnet" && environment !== "testnet") {
    throw new Error(`Invalid Predict environment: ${environment}`);
  }

  return {
    environment,
    maxMarkets: Number.parseInt(args.get("maxMarkets") ?? "10", 10),
    maxPages: Number.parseInt(args.get("maxPages") ?? "10", 10),
    durationMs: Number.parseInt(args.get("durationMs") ?? "60000", 10)
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const summary = await runPredictEvidenceProgram({
    environment: args.environment,
    maxMarkets: args.maxMarkets,
    maxPages: args.maxPages,
    durationMs: args.durationMs,
    commandRunner: async (command, commandArgs) => {
      if (command === "npm" && commandArgs[0] === "run") {
        const scriptName = commandArgs[1];
        const scriptPath = scriptName ? scriptPathByPackageScript[scriptName] : undefined;
        if (!scriptPath) {
          return {
            stdout: "",
            stderr: `Unsupported package script in Predict evidence program: ${scriptName ?? "unknown"}`,
            exitCode: 1
          };
        }

        const passthroughArgs = commandArgs.filter((value, index) => index >= 3);
        return executeTsxScript(scriptPath, passthroughArgs);
      }

      try {
        const result = await execFileAsync(command, [...commandArgs], {
          cwd: process.cwd(),
          env: process.env,
          maxBuffer: 10 * 1024 * 1024
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 0
        };
      } catch (error) {
        const resolved = error as { stdout?: string; stderr?: string; code?: number | string };
        return {
          stdout: resolved.stdout ?? "",
          stderr: resolved.stderr ?? "",
          exitCode: typeof resolved.code === "number" ? resolved.code : 1
        };
      }
    }
  });

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("Failed to run Predict evidence program.");
  console.error(error);
  process.exit(1);
});
