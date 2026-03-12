import { beforeEach, describe, expect, it, vi } from "vitest";

import { metricsRegistry } from "../../src/observability/metrics.js";
import {
  ReplayDecisionCaptureError,
  ReplayDecisionCaptureService
} from "../../src/core/replay/replay-decision-capture-service.js";
import type { IReplayEnvelopeWriter } from "../../src/core/replay/replay-envelope-writer.js";
import type { ReplayCaptureConfig, ReplayEnvelope, WriteReplayEnvelopeInput } from "../../src/core/replay/replay.types.js";

const replayConfig = (mode: ReplayCaptureConfig["mode"]): ReplayCaptureConfig => ({
  mode,
  configVersion: "cfg-v1",
  engineVersion: "eng-v1",
  featureFlags: { replay: true }
});

const envelopeInput: WriteReplayEnvelopeInput = {
  decisionType: "RFQ_GROUPING",
  entityId: "rfq-1",
  correlationId: "corr-1",
  configVersion: "cfg-v1",
  engineVersion: "eng-v1",
  featureFlags: { replay: true },
  inputSnapshot: { rfqId: "rfq-1" },
  decisionTrace: { orderedCandidates: ["a", "b"] },
  outputSnapshot: { grouping: { safePools: [["a", "b"]] } }
};

const persistedEnvelope: ReplayEnvelope = {
  id: "env-1",
  decisionType: "RFQ_GROUPING",
  entityId: "rfq-1",
  correlationId: "corr-1",
  configVersion: "cfg-v1",
  engineVersion: "eng-v1",
  featureFlags: { replay: true },
  inputSnapshot: { rfqId: "rfq-1" },
  decisionTrace: { orderedCandidates: ["a", "b"] },
  outputSnapshot: { grouping: { safePools: [["a", "b"]] } },
  createdAt: new Date("2026-03-11T12:00:00.000Z")
};

const metricValue = async (name: string, labels: Record<string, string>): Promise<number> => {
  const metric = metricsRegistry.getSingleMetric(name);
  if (!metric) {
    throw new Error(`Missing metric ${name}`);
  }

  const metrics = await metric.get();
  const sample = metrics.values.find((value) =>
    Object.entries(labels).every(([key, expected]) => value.labels[key] === expected)
  );

  return sample?.value ?? 0;
};

describe("ReplayDecisionCaptureService", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("writes replay envelopes and increments success metric", async () => {
    const writer: IReplayEnvelopeWriter = {
      write: vi.fn(async () => persistedEnvelope)
    };
    const logger = {
      error: vi.fn(),
      warn: vi.fn()
    };

    const service = new ReplayDecisionCaptureService(writer, logger);
    const result = await service.capture({
      config: replayConfig("REQUIRED"),
      buildEnvelope: () => envelopeInput
    });

    expect(result).toEqual(persistedEnvelope);
    expect(await metricValue("replay_envelopes_written_total", { decision_type: "RFQ_GROUPING", mode: "REQUIRED" })).toBe(1);
    expect(await metricValue("replay_write_failures_total", { decision_type: "RFQ_GROUPING", mode: "REQUIRED" })).toBe(0);
  });

  it("fails closed in REQUIRED mode when the writer throws", async () => {
    const writer: IReplayEnvelopeWriter = {
      write: vi.fn(async () => {
        throw new Error("writer_failed");
      })
    };
    const logger = {
      error: vi.fn(),
      warn: vi.fn()
    };

    const service = new ReplayDecisionCaptureService(writer, logger);

    await expect(
      service.capture({
        config: replayConfig("REQUIRED"),
        buildEnvelope: () => envelopeInput
      })
    ).rejects.toBeInstanceOf(ReplayDecisionCaptureError);

    expect(await metricValue("replay_write_failures_total", { decision_type: "RFQ_GROUPING", mode: "REQUIRED" })).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionType: "RFQ_GROUPING",
        entityId: "rfq-1",
        correlationId: "corr-1",
        mode: "REQUIRED"
      }),
      "Replay envelope capture failed."
    );
  });

  it("continues in BEST_EFFORT mode when the writer throws", async () => {
    const writer: IReplayEnvelopeWriter = {
      write: vi.fn(async () => {
        throw new Error("writer_failed");
      })
    };
    const logger = {
      error: vi.fn(),
      warn: vi.fn()
    };

    const service = new ReplayDecisionCaptureService(writer, logger);
    const result = await service.capture({
      config: replayConfig("BEST_EFFORT"),
      buildEnvelope: () => envelopeInput
    });

    expect(result).toBeNull();
    expect(await metricValue("replay_write_failures_total", { decision_type: "RFQ_GROUPING", mode: "BEST_EFFORT" })).toBe(1);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
