import type { ExecutionControlRepository } from "../repositories/execution-control.repository.js";

export const executionAuditEventsV0 = [
  "EXECUTION_CREATED",
  "PREFLIGHT_STARTED",
  "PREFLIGHT_PASSED",
  "PREFLIGHT_FAILED",
  "ROUTE_SELECTED",
  "LIQUIDITY_RESERVED",
  "ORDER_SUBMITTED",
  "PARTIAL_FILL_RECEIVED",
  "FILL_RECEIVED",
  "SETTLEMENT_CHECK_STARTED",
  "SETTLEMENT_VERIFIED",
  "GHOST_FILL_SUSPECTED",
  "GHOST_FILL_CONFIRMED",
  "REROUTE_STARTED",
  "REROUTE_COMPLETED",
  "FAILED_CLOSED",
  "ACCOUNTING_UPDATED",
  "USER_RECEIPT_EMITTED"
] as const;

export type ExecutionAuditEventV0 = (typeof executionAuditEventsV0)[number];

export interface ExecutionAuditSink {
  write(event: {
    eventType: ExecutionAuditEventV0;
    executionIntentId?: string | null;
    executionRecordId?: string | null;
    routePlanId?: string | null;
    idempotencyKey?: string | null;
    actorIdentity?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<string>;
}

export class RepositoryExecutionAuditSink implements ExecutionAuditSink {
  public constructor(private readonly repository: ExecutionControlRepository) {}

  public async write(event: Parameters<ExecutionAuditSink["write"]>[0]): Promise<string> {
    return this.repository.createAuditRecord(event);
  }
}

export class InMemoryExecutionAuditSink implements ExecutionAuditSink {
  public readonly events: Array<Parameters<ExecutionAuditSink["write"]>[0] & { id: string }> = [];

  public async write(event: Parameters<ExecutionAuditSink["write"]>[0]): Promise<string> {
    const id = `audit-${this.events.length + 1}`;
    this.events.push({ id, ...event });
    return id;
  }
}
