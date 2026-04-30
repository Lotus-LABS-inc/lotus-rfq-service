import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..", "..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const METRICS_FILE = path.join(SRC_DIR, "observability", "metrics.ts");

async function collectTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const metricsSource = await readFile(METRICS_FILE, "utf8");

  // Basic guard: ensure metricsRegistry is exported from the central registry
  if (!metricsSource.includes("export const metricsRegistry")) {
    console.error("[metrics:check] metricsRegistry must be exported from src/observability/metrics.ts");
    process.exit(1);
  }

  const allTsFiles = await collectTsFiles(SRC_DIR);
  const filesToScan = allTsFiles.filter((file) => file !== METRICS_FILE);

  const forbiddenPatterns = [
    /new\s+Counter\s*\(/,
    /new\s+Gauge\s*\(/,
    /new\s+Histogram\s*\(/
  ];

  const offenders = [];

  for (const file of filesToScan) {
    const source = await readFile(file, "utf8");
    if (forbiddenPatterns.some((re) => re.test(source))) {
      offenders.push(path.relative(ROOT_DIR, file));
    }
  }

  if (offenders.length > 0) {
    console.error("[metrics:check] Prometheus metrics must be created only in src/observability/metrics.ts");
    console.error("Offending files:");
    for (const file of offenders) {
      console.error(` - ${file}`);
    }
    process.exit(1);
  }

  console.log("[metrics:check] OK - all Prometheus metrics are registered via src/observability/metrics.ts");
}

main().catch((err) => {
  console.error("[metrics:check] Unexpected error", err);
  process.exit(1);
});

