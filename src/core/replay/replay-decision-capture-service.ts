import type { Logger } from "pino";

import {
  replayEnvelopesWrittenTotal,
  replayWriteFailuresTotal
} from "../../observability/metrics.js";
import type { IReplayEnvelopeWriter } from "./replay-envelope-writer.js";
import type {
  ReplayCaptureConfig,
  ReplayDecisionType,
  ReplayEnvelope,
  WriteReplayEnvelopeInput
} from "./replay.types.js";

export class ReplayDecisionCaptureError extends Error {
  public readonly decisionType: ReplayDecisionType;
  public readonly mode: ReplayCaptureConfig["mode"];

  public constructor(
    decisionType: ReplayDecisionType,
    mode: ReplayCaptureConfig["mode"],
    cause: unknown
  ) {
    super(`Replay capture failed for ${decisionType} in ${mode} mode.`);
    this.name = "ReplayDecisionCaptureError";
    this.decisionType = decisionType;
    this.mode = mode;
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
  }
}

export interface ReplayDecisionCaptureRequest {
  config: ReplayCaptureConfig;
  buildEnvelope: (config: ReplayCaptureConfig) => WriteReplayEnvelopeInput;
}

export interface IReplayDecisionCaptureService {
  capture(request: ReplayDecisionCaptureRequest): Promise<ReplayEnvelope | null>;
  getTotalFailureCount(): number;
}

export class ReplayDecisionCaptureService implements IReplayDecisionCaptureService {
  private totalFailureCount = 0;

  public constructor(
    private readonly writer: IReplayEnvelopeWriter,
    private readonly logger: Pick<Logger, "error" | "warn">
  ) {}

  public async capture(request: ReplayDecisionCaptureRequest): Promise<ReplayEnvelope | null> {
    const envelope = request.buildEnvelope(request.config);

    try {
      const persisted = await this.writer.write(envelope);
      replayEnvelopesWrittenTotal.labels(envelope.decisionType, request.config.mode).inc();
      return persisted;
    } catch (error) {
      this.totalFailureCount += 1;
      replayWriteFailuresTotal.labels(envelope.decisionType, request.config.mode).inc();
      this.logger.error(
        {
          err: error,
          decisionType: envelope.decisionType,
          entityId: envelope.entityId,
          correlationId: envelope.correlationId,
          mode: request.config.mode,
          configVersion: request.config.configVersion,
          engineVersion: request.config.engineVersion
        },
        "Replay envelope capture failed."
      );

      if (request.config.mode === "REQUIRED") {
        throw new ReplayDecisionCaptureError(envelope.decisionType, request.config.mode, error);
      }

      return null;
    }
  }

  public getTotalFailureCount(): number {
    return this.totalFailureCount;
  }
}
