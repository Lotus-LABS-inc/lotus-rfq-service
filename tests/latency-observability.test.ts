import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { recordLatencyDuration } from "../src/observability/latency.js";

describe("latency observability", () => {
  it("writes redacted diagnostic samples when enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lotus-latency-"));
    const samplePath = join(dir, "samples.jsonl");
    const previousEnabled = process.env.LATENCY_DIAGNOSTICS_ENABLED;
    const previousPath = process.env.LATENCY_DIAGNOSTIC_LOG_PATH;
    process.env.LATENCY_DIAGNOSTICS_ENABLED = "true";
    process.env.LATENCY_DIAGNOSTIC_LOG_PATH = samplePath;

    try {
      recordLatencyDuration("venue_quote_fetch", 12.3456, {
        endpoint: "POST /execution/quote",
        canonicalMarketId: "CRYPTO_BTC_ATH_BY_DATE",
        venue: "polymarket",
        external: true,
        blockerCategory: "TOKEN_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const [line] = (await readFile(samplePath, "utf8")).trim().split(/\r?\n/);
      const sample = JSON.parse(line!) as {
        stage: string;
        durationMs: number;
        tags: Record<string, unknown>;
      };

      expect(sample.stage).toBe("venue_quote_fetch");
      expect(sample.durationMs).toBe(12.346);
      expect(sample.tags.venue).toBe("POLYMARKET");
      expect(sample.tags.blockerCategory).toContain("REDACTED");
      expect(JSON.stringify(sample)).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    } finally {
      if (previousEnabled === undefined) {
        delete process.env.LATENCY_DIAGNOSTICS_ENABLED;
      } else {
        process.env.LATENCY_DIAGNOSTICS_ENABLED = previousEnabled;
      }
      if (previousPath === undefined) {
        delete process.env.LATENCY_DIAGNOSTIC_LOG_PATH;
      } else {
        process.env.LATENCY_DIAGNOSTIC_LOG_PATH = previousPath;
      }
    }
  });
});
