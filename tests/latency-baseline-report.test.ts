import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("latency baseline report", () => {
  it("generates JSON and markdown summaries from diagnostic samples", async () => {
    const repoRoot = process.cwd();
    const dir = await mkdtemp(join(tmpdir(), "lotus-latency-report-"));
    const samplePath = join(dir, "samples.jsonl");
    const artifactDir = join(repoRoot, "artifacts", "latency");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(samplePath, [
      JSON.stringify({
        generatedAt: "2026-05-21T00:00:00.000Z",
        stage: "route_preview_quote",
        durationMs: 12,
        tags: {
          endpoint: "POST /execution/quote",
          canonicalMarketId: "CRYPTO_BTC_ATH_BY_DATE",
          venue: "POLYMARKET"
        }
      }),
      JSON.stringify({
        generatedAt: "2026-05-21T00:00:01.000Z",
        stage: "rfq_accept_preflight",
        durationMs: 80,
        tags: {
          endpoint: "POST /rfq/:id/accept",
          canonicalMarketId: "CRYPTO_BTC_ATH_BY_DATE",
          blockerCategory: "FUNDING_UNAVAILABLE"
        }
      })
    ].join("\n"), "utf8");

    await execFileAsync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/reports/report-latency-baseline.ts"
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LATENCY_DIAGNOSTIC_LOG_PATH: samplePath
      }
    });

    const report = JSON.parse(
      await readFile(join(artifactDir, "latency-baseline-summary.json"), "utf8")
    ) as {
      sampleStatus: string;
      summaries: {
        routePreview: { p99: number | null };
        rfqAcceptPreflight: { p99: number | null };
      };
      blockers: Array<{ category: string; count: number }>;
    };
    const markdown = await readFile(join(artifactDir, "latency-baseline-summary.md"), "utf8");

    expect(report.sampleStatus).toBe("SAMPLES_LOADED");
    expect(report.summaries.routePreview.p99).toBe(12);
    expect(report.summaries.rfqAcceptPreflight.p99).toBe(80);
    expect(report.blockers).toContainEqual({ category: "FUNDING_UNAVAILABLE", count: 1 });
    expect(markdown).toContain("Lotus Latency Baseline");
  });
});
