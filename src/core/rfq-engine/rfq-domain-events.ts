import { EventEmitter } from "node:events";

export type RFQDomainEventType =
  | "RFQ_CREATED"
  | "QUOTE_RECEIVED"
  | "STATE_TRANSITION"
  | "EXECUTION_UPDATE";

export interface RFQDomainEvent {
  type: RFQDomainEventType;
  sessionId: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface RFQEventEmitter {
  emitEvent(event: RFQDomainEvent): void;
}

export class InMemoryRFQEventEmitter extends EventEmitter implements RFQEventEmitter {
  public emitEvent(event: RFQDomainEvent): void {
    this.emit(event.type, event);
  }
}
