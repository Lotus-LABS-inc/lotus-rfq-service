import { RFQEventRepository } from "../db/repositories/rfq-event-repository.js";
import { RFQQuoteRepository } from "../db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "../core/rfq-engine/rfq-session-manager.js";
import type { RFQEventEmitter } from "../core/rfq-engine/rfq-domain-events.js";
import type { Logger } from "pino";
import type { RedisClient } from "../db/redis.js";
import {
  quoteLatencyMs,
  quoteReceivedTotal,
  rfqResolutionBlockedTotal
} from "../observability/metrics.js";
import { withSpan } from "../observability/tracing.js";
import type { LPStatsRepository } from "../repositories/lp-stats.repository.js";
import {
  evaluateResolutionQuoteLane,
  ResolutionRiskQuotePolicyError
} from "../core/rfq-engine/resolution-risk-rfq-policy.js";
import type { ResolutionRiskVenueGrouping } from "../core/rfq-engine/resolution-risk.types.js";
import type { LPKeyRecord } from "../db/repositories/lp-key-repository.js";
import {
  assertMakerCanQuoteFlowSegment,
  readFlowSegment,
  readFlowSegmentInputHash,
  readFlowSegmentVersion,
  type FlowSegment
} from "../core/rfq-engine/flow-segmentation.js";

export interface ReceiveLPQuoteCommand {
  routeLpId: string;
  authenticatedLpId: string;
  authenticatedLpKeyId: string;
  authenticatedLpKeyDbId: string;
  sessionId: string;
  quoteId: string;
  price: string;
  quantity: string;
  feeBps: number;
  validUntil: string;
  payload?: Readonly<Record<string, unknown>>;
}

export interface ReceiveLPQuoteResult {
  accepted: true;
  sessionId: string;
  quoteId: string;
}

export interface ReceiveLPQuoteServiceDependencies {
  sessionRepository: RFQSessionRepository;
  quoteRepository: RFQQuoteRepository;
  eventRepository: RFQEventRepository;
  sessionManager: RFQSessionManager;
  redisClient: RedisClient;
  eventEmitter: RFQEventEmitter;
  logger: Pick<Logger, "error">;
  lpStatsRepository?: LPStatsRepository;
  lpKeyRepository?: { findByKeyId(keyId: string): Promise<LPKeyRecord | null> };
  now?: () => Date;
}

export class LPIdentityMismatchError extends Error {
  public constructor() {
    super("LP identity does not match route parameter.");
    this.name = "LPIdentityMismatchError";
  }
}

export class RFQSessionNotFoundError extends Error {
  public constructor(sessionId: string) {
    super(`RFQ session ${sessionId} not found.`);
    this.name = "RFQSessionNotFoundError";
  }
}

export class InvalidRFQSessionStateError extends Error {
  public constructor(sessionId: string, currentState: string) {
    super(`RFQ session ${sessionId} is in ${currentState} and not COLLECTING_QUOTES.`);
    this.name = "InvalidRFQSessionStateError";
  }
}

export class DuplicateQuoteIdError extends Error {
  public constructor(quoteId: string) {
    super(`Duplicate quote_id ${quoteId}.`);
    this.name = "DuplicateQuoteIdError";
  }
}

export class ResolutionRiskQuoteRejectedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ResolutionRiskQuoteRejectedError";
  }
}

export class LPFlowSegmentNotSubscribedError extends Error {
  public readonly code = "LP_FLOW_SEGMENT_NOT_SUBSCRIBED";

  public constructor(message: string) {
    super(message);
    this.name = "LPFlowSegmentNotSubscribedError";
  }
}

export class ReceiveLPQuoteService {
  private readonly now: () => Date;

  public constructor(private readonly deps: ReceiveLPQuoteServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  public async execute(command: ReceiveLPQuoteCommand): Promise<ReceiveLPQuoteResult> {
    return withSpan(
      "rfq.lifecycle.quote_received",
      {
        rfq_id: command.sessionId,
        lp_id: command.authenticatedLpId,
        state: "COLLECTING_QUOTES"
      },
      async () => {
        const startedAt = performance.now();

        if (command.routeLpId !== command.authenticatedLpId) {
          throw new LPIdentityMismatchError();
        }

        const session = await this.deps.sessionRepository.findById(command.sessionId);
        if (!session) {
          throw new RFQSessionNotFoundError(command.sessionId);
        }

        if (session.status !== "COLLECTING_QUOTES") {
          throw new InvalidRFQSessionStateError(command.sessionId, session.status);
        }

        const sessionMetadata = await this.deps.sessionManager.getSessionMetadata(command.sessionId);
        const grouping = readResolutionGrouping(sessionMetadata?.metadata);
        const flowSegment = readSessionFlowSegment(session, sessionMetadata?.metadata);
        const flowSegmentVersion = readSessionFlowSegmentVersion(session, sessionMetadata?.metadata);
        const flowSegmentInputHash = readSessionFlowSegmentInputHash(session, sessionMetadata?.metadata);
        const quotePayload = { ...(command.payload ?? {}) };

        if (flowSegment) {
          const lpKey = await this.deps.lpKeyRepository?.findByKeyId(command.authenticatedLpKeyId);
          try {
            assertMakerCanQuoteFlowSegment(flowSegment, lpKey?.metadata);
          } catch (error) {
            throw new LPFlowSegmentNotSubscribedError(
              error instanceof Error ? error.message : "LP key is not subscribed to this RFQ flow segment."
            );
          }
          quotePayload.flow_segment = flowSegment;
          if (flowSegmentVersion) quotePayload.flow_segment_version = flowSegmentVersion;
          if (flowSegmentInputHash) quotePayload.flow_segment_input_hash = flowSegmentInputHash;
        }

        if (grouping) {
          try {
            const laneDecision = evaluateResolutionQuoteLane(
              grouping,
              typeof quotePayload.resolution_profile_id === "string"
                ? quotePayload.resolution_profile_id
                : undefined
            );
            if (!laneDecision.allowed) {
              throw new ResolutionRiskQuotePolicyError("blocked_resolution_profile", laneDecision.reason);
            }
            quotePayload.resolution_lane = laneDecision.laneId;
            quotePayload.resolution_lane_type = laneDecision.laneType;
            if (laneDecision.reason) {
              quotePayload.resolution_lane_reason = laneDecision.reason;
            }
          } catch (error) {
            if (error instanceof ResolutionRiskQuotePolicyError) {
              rfqResolutionBlockedTotal.inc();
              throw new ResolutionRiskQuoteRejectedError(error.message);
            }
            throw error;
          }
        }

        const idempotencyKey = `rfq:${command.sessionId}:quote_id:${command.quoteId}`;
        const nonceResult = await this.deps.redisClient.set(idempotencyKey, "1", "EX", 3600, "NX");
        if (nonceResult !== "OK") {
          throw new DuplicateQuoteIdError(command.quoteId);
        }

        const numericPrice = Number.parseFloat(command.price);
        const quoteScore = Number.isFinite(numericPrice) ? numericPrice : 0;
        const sessionTtl = await this.deps.sessionManager.getSessionTtl(command.sessionId);
        const quoteTtl = sessionTtl > 0 ? sessionTtl : 300;

        const eventPayload = {
          quoteId: command.quoteId,
          lpId: command.authenticatedLpId,
          lpKeyId: command.authenticatedLpKeyId,
          price: command.price,
          quantity: command.quantity,
          feeBps: command.feeBps,
          validUntil: command.validUntil,
          payload: quotePayload
        };

        await this.deps.sessionManager.addQuote(
          command.sessionId,
          {
            quoteId: command.quoteId,
            score: quoteScore,
            payload: eventPayload
          },
          quoteTtl
        );

        await this.deps.eventRepository.append({
          sessionId: command.sessionId,
          eventType: "QUOTE_RECEIVED",
          eventPayload
        });

        this.deps.eventEmitter.emitEvent({
          type: "QUOTE_RECEIVED",
          sessionId: command.sessionId,
          occurredAt: this.now().toISOString(),
          payload: eventPayload
        });

        quoteReceivedTotal.inc();
        const responseTimeMs = performance.now() - startedAt;
        quoteLatencyMs.observe(responseTimeMs);

        void this.deps.quoteRepository
          .create({
            sessionId: command.sessionId,
            lpKeyId: command.authenticatedLpKeyDbId,
            quoteStatus: "RECEIVED",
            price: command.price,
            quantity: command.quantity,
            feeBps: command.feeBps,
            validUntil: new Date(command.validUntil),
            quotePayload: {
              quoteId: command.quoteId,
              payload: quotePayload
            }
          })
          .catch((error: unknown) => {
            this.deps.logger.error(
              {
                err: error,
                sessionId: command.sessionId,
                quoteId: command.quoteId
              },
              "Async quote persistence failed."
            );
          });

        if (this.deps.lpStatsRepository) {
          void this.deps.lpStatsRepository
            .recordQuoteSubmission(command.authenticatedLpId, responseTimeMs)
            .catch((error: unknown) => {
              this.deps.logger.error(
                {
                  err: error,
                  sessionId: command.sessionId,
                  quoteId: command.quoteId,
                  lpId: command.authenticatedLpId
                },
                "Async LP quote stats update failed."
              );
            });
        }

        return {
          accepted: true,
          sessionId: command.sessionId,
          quoteId: command.quoteId
        };
      }
    );
  }
}

const readResolutionGrouping = (
  metadata: Readonly<Record<string, unknown>> | undefined
): ResolutionRiskVenueGrouping | null => {
  const grouping = metadata?.["resolution_risk_grouping"];
  if (!grouping || typeof grouping !== "object") {
    return null;
  }
  return grouping as ResolutionRiskVenueGrouping;
};

const readSessionFlowSegment = (
  session: { flow_segment?: unknown; metadata?: Readonly<Record<string, unknown>> },
  redisMetadata: Readonly<Record<string, unknown>> | undefined
): FlowSegment | null => {
  if (session.flow_segment === "soft" || session.flow_segment === "standard") {
    return session.flow_segment;
  }
  return readFlowSegment(redisMetadata) ?? readFlowSegment(session.metadata);
};

const readSessionFlowSegmentVersion = (
  session: { flow_segment_version?: unknown; metadata?: Readonly<Record<string, unknown>> },
  redisMetadata: Readonly<Record<string, unknown>> | undefined
): string | null => {
  if (typeof session.flow_segment_version === "string") return session.flow_segment_version;
  return readFlowSegmentVersion(redisMetadata) ?? readFlowSegmentVersion(session.metadata);
};

const readSessionFlowSegmentInputHash = (
  session: { flow_segment_input_hash?: unknown; metadata?: Readonly<Record<string, unknown>> },
  redisMetadata: Readonly<Record<string, unknown>> | undefined
): string | null => {
  if (typeof session.flow_segment_input_hash === "string") return session.flow_segment_input_hash;
  return readFlowSegmentInputHash(redisMetadata) ?? readFlowSegmentInputHash(session.metadata);
};
