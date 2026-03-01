import { randomUUID } from "node:crypto";
import { RFQEventRepository } from "../../db/repositories/rfq-event-repository.js";
import { RFQSessionRepository } from "../../db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "./rfq-session-manager.js";
import { RFQStateMachine, type RFQStateMachineLogger } from "./rfq-state-machine.js";
import type { CanonicalMarketClient } from "./canonical-market-client.js";
import type { RFQEventEmitter } from "./rfq-domain-events.js";
import type { ReliabilityWeights } from "../lp-reliability-engine.js";
import { activeRFQSessions, rfqCreatedTotal } from "../../observability/metrics.js";
import { withSpan } from "../../observability/tracing.js";
import type { IRiskEngine } from "../risk-engine.js";

export interface CreateRFQCommand {
  canonicalMarketId: string;
  takerId: string;
  side: "buy" | "sell";
  quantity: string;
  idempotencyKey: string;
  ttlSeconds: number;
}

export interface CreateRFQResult {
  sessionId: string;
  state: "BROADCAST";
  expiresAt: string;
}

export interface CreateRFQServiceDependencies {
  sessionRepository: RFQSessionRepository;
  eventRepository: RFQEventRepository;
  sessionManager: RFQSessionManager;
  canonicalMarketClient: CanonicalMarketClient;
  eventEmitter: RFQEventEmitter;
  logger: RFQStateMachineLogger;
  now?: () => Date;
  createRequestId?: () => string;
  riskEngine: IRiskEngine;
}

export class MarketInactiveError extends Error {
  public constructor(marketId: string) {
    super(`Canonical market ${marketId} is not active.`);
    this.name = "MarketInactiveError";
  }
}

export class CreateRFQService {
  private readonly now: () => Date;
  private readonly createRequestId: () => string;

  public constructor(private readonly deps: CreateRFQServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.createRequestId = deps.createRequestId ?? (() => randomUUID());
  }

  public async execute(
    command: CreateRFQCommand,
    options?: { weights?: Partial<ReliabilityWeights> }
  ): Promise<CreateRFQResult> {
    return withSpan(
      "rfq.lifecycle.create",
      {
        rfq_id: "pending",
        lp_id: "n/a",
        state: "CREATED"
      },
      async () => {
        const market = await this.deps.canonicalMarketClient.fetchMarketById(command.canonicalMarketId);
        if (!market.isActive) {
          throw new MarketInactiveError(command.canonicalMarketId);
        }

        try {
          await this.deps.riskEngine.validateRFQCreation({
            taker_id: command.takerId,
            canonical_market_id: command.canonicalMarketId,
            side: command.side,
            quantity: command.quantity
          });
        } catch (error) {
          this.deps.eventEmitter.emitEvent({
            type: "RISK_REJECTED",
            sessionId: "pending",
            occurredAt: this.now().toISOString(),
            payload: {
              takerId: command.takerId,
              marketId: command.canonicalMarketId,
              reason: error instanceof Error ? error.message : "unknown_risk_error"
            }
          });
          throw error;
        }

        const expiresAt = new Date(this.now().getTime() + command.ttlSeconds * 1000);
        const stateMachine = new RFQStateMachine({
          initialState: "CREATED",
          logger: this.deps.logger
        });

        const session = await this.deps.sessionRepository.create({
          requestId: this.createRequestId(),
          canonicalMarketId: command.canonicalMarketId,
          takerId: command.takerId,
          side: command.side,
          quantity: command.quantity,
          status: stateMachine.getState(),
          idempotencyKey: command.idempotencyKey,
          expiresAt,
          metadata: {
            source: "post_rfq_endpoint"
          }
        });

        await this.deps.sessionManager.setSessionMetadata(
          session.id,
          {
            id: session.id,
            state: stateMachine.getState(),
            expiresAt: expiresAt.toISOString(),
            metadata: {
              canonicalMarketId: command.canonicalMarketId,
              takerId: command.takerId
            }
          },
          command.ttlSeconds
        );

        const nextState = stateMachine.transitionTo("BROADCAST", {
          reason: "rfq_created",
          metadata: {
            sessionId: session.id
          }
        });
        this.deps.eventEmitter.emitEvent({
          type: "STATE_TRANSITION",
          sessionId: session.id,
          occurredAt: this.now().toISOString(),
          payload: {
            from: "CREATED",
            to: nextState
          }
        });

        await this.deps.sessionRepository.updateStatus(session.id, nextState);
        await this.deps.sessionManager.setSessionMetadata(
          session.id,
          {
            id: session.id,
            state: nextState,
            expiresAt: expiresAt.toISOString(),
            metadata: {
              canonicalMarketId: command.canonicalMarketId,
              takerId: command.takerId
            }
          },
          command.ttlSeconds
        );

        const eventPayload = {
          canonicalMarketId: command.canonicalMarketId,
          takerId: command.takerId,
          side: command.side,
          quantity: command.quantity
        };

        await this.deps.eventRepository.append({
          sessionId: session.id,
          eventType: "RFQ_CREATED",
          eventPayload: eventPayload
        });

        this.deps.eventEmitter.emitEvent({
          type: "RFQ_CREATED",
          sessionId: session.id,
          occurredAt: this.now().toISOString(),
          payload: eventPayload
        });

        rfqCreatedTotal.inc();
        activeRFQSessions.inc();

        return {
          sessionId: session.id,
          state: "BROADCAST",
          expiresAt: expiresAt.toISOString()
        };
      }
    );
  }
}
