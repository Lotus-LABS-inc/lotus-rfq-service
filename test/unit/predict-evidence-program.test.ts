import { describe, expect, it, vi } from "vitest";

import { runPredictEvidenceProgram } from "../../src/operations/fast-testing/predict-evidence-program.js";

describe("predict evidence program", () => {
  it("stops cleanly when no live ids are discovered", async () => {
    const commandRunner = vi.fn(async (_command: string, args: readonly string[]) => {
      const script = args[1];
      if (script === "sync:predict:current-state") {
        return {
          stdout: JSON.stringify({ fetchedMarkets: 20 }),
          stderr: "",
          exitCode: 0
        };
      }
      if (script === "scan:predict:live-markets") {
        return {
          stdout: JSON.stringify({ selectedMarkets: 0, markets: [] }),
          stderr: "",
          exitCode: 0
        };
      }
      throw new Error(`Unexpected script: ${script}`);
    });

    const summary = await runPredictEvidenceProgram({
      environment: "mainnet",
      commandRunner
    });

    expect(commandRunner).toHaveBeenCalledTimes(2);
    expect(summary.selectedMarketIds).toEqual([]);
    expect(summary.recorderRun).toBeNull();
    expect(summary.fallbackScan).toBeNull();
    expect(summary.skippedReason).toBe("no_live_markets_found");
  });

  it("runs recorder and fallback scan when live ids are discovered", async () => {
    const commandRunner = vi.fn(async (_command: string, args: readonly string[]) => {
      const script = args[1];
      if (script === "sync:predict:current-state") {
        return {
          stdout: JSON.stringify({ fetchedMarkets: 20 }),
          stderr: "",
          exitCode: 0
        };
      }
      if (script === "scan:predict:live-markets") {
        return {
          stdout: JSON.stringify({ selectedMarkets: 1, markets: [{ marketId: "524" }] }),
          stderr: "",
          exitCode: 0
        };
      }
      if (script === "record:predict:orderbooks") {
        return {
          stdout: JSON.stringify({ selectedMarkets: ["524"], insertedSnapshots: 0 }),
          stderr: "",
          exitCode: 0
        };
      }
      if (script === "scan:predict:predexon-fallback") {
        return {
          stdout: JSON.stringify({ nonEmptyCoverageCount: 0 }),
          stderr: "",
          exitCode: 0
        };
      }
      throw new Error(`Unexpected script: ${script}`);
    });

    const summary = await runPredictEvidenceProgram({
      environment: "mainnet",
      now: new Date("2026-03-27T12:00:00.000Z"),
      durationMs: 20000,
      commandRunner
    });

    expect(commandRunner).toHaveBeenCalledTimes(4);
    expect(summary.selectedMarketIds).toEqual(["524"]);
    expect(summary.recorderRun).toEqual({ selectedMarkets: ["524"], insertedSnapshots: 0 });
    expect(summary.fallbackScan).toEqual({ nonEmptyCoverageCount: 0 });
    expect(commandRunner.mock.calls[3]?.[1]).toContain("--start=2026-03-11T00:00:00.000Z");
    expect(commandRunner.mock.calls[3]?.[1]).toContain("--end=2026-03-27T12:00:00.000Z");
  });

  it("parses the final JSON payload when recorder stdout includes leading logs", async () => {
    const commandRunner = vi.fn(async (_command: string, args: readonly string[]) => {
      const script = args[1];
      if (script === "sync:predict:current-state") {
        return {
          stdout: JSON.stringify({ fetchedMarkets: 20 }),
          stderr: "",
          exitCode: 0
        };
      }
      if (script === "scan:predict:live-markets") {
        return {
          stdout: JSON.stringify({ selectedMarkets: 1, markets: [{ marketId: "524" }] }),
          stderr: "",
          exitCode: 0
        };
      }
      if (script === "record:predict:orderbooks") {
        return {
          stdout: "{ environment: 'mainnet' } Predict websocket connected.\n{\n  \"selectedMarkets\": [\"524\"],\n  \"insertedSnapshots\": 3\n}",
          stderr: "",
          exitCode: 0
        };
      }
      if (script === "scan:predict:predexon-fallback") {
        return {
          stdout: JSON.stringify({ nonEmptyCoverageCount: 0, errorCount: 1 }),
          stderr: "",
          exitCode: 0
        };
      }
      throw new Error(`Unexpected script: ${script}`);
    });

    const summary = await runPredictEvidenceProgram({
      environment: "mainnet",
      commandRunner
    });

    expect(summary.recorderRun).toEqual({ selectedMarkets: ["524"], insertedSnapshots: 3 });
    expect(summary.fallbackScan).toEqual({ nonEmptyCoverageCount: 0, errorCount: 1 });
  });
});
