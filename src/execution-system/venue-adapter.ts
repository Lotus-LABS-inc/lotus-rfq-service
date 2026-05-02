import { randomUUID } from "node:crypto";
import type { ExecutionLegV0, SettlementStatusV0 } from "./types.js";

export interface PreparedVenueOrder {
  venue: string;
  clientOrderId: string;
  payload: Record<string, unknown>;
}

export interface VenueSubmitResult {
  venueOrderId: string;
  fillId?: string;
  status: "SUBMITTED" | "PARTIAL_FILL" | "FILLED";
  filledSize: string;
  averagePrice: number;
}

export interface VenueFillState {
  status: "OPEN" | "PARTIAL_FILL" | "FILLED" | "CANCELLED" | "FAILED";
  filledSize: string;
  averagePrice: number;
  offchainFilled?: boolean;
}

export interface VenueSettlementState {
  status: SettlementStatusV0;
  evidence?: Record<string, unknown>;
}

export interface NormalizedVenueError {
  code: string;
  message: string;
  retryable: boolean;
}

export type ExecutionSigningModel =
  | "BACKEND_SIGNER"
  | "USER_SIGNED"
  | "USER_SIGNED_BACKEND_RELAY"
  | "DELEGATED_BACKEND_SIGNER"
  | "NOT_SUPPORTED";

export interface ExecutionVenueAdapter {
  readonly venue: string;
  prepareOrder(leg: ExecutionLegV0): Promise<PreparedVenueOrder>;
  submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult>;
  fetchFillState(venueOrderId: string): Promise<VenueFillState>;
  cancelOrder?(venueOrderId: string): Promise<{ cancelled: boolean }>;
  fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState>;
  normalizeVenueError(error: unknown): NormalizedVenueError;
}

export class VenueExecutionNotConfiguredError extends Error {
  public constructor(venue: string) {
    super(`${venue} execution adapter is not configured for live submission.`);
    this.name = "VenueExecutionNotConfiguredError";
  }
}

export class NotConfiguredExecutionAdapter implements ExecutionVenueAdapter {
  public constructor(public readonly venue: string) {}

  public async prepareOrder(): Promise<PreparedVenueOrder> {
    throw new VenueExecutionNotConfiguredError(this.venue);
  }

  public async submitOrder(): Promise<VenueSubmitResult> {
    throw new VenueExecutionNotConfiguredError(this.venue);
  }

  public async fetchFillState(): Promise<VenueFillState> {
    return { status: "FAILED", filledSize: "0", averagePrice: 0 };
  }

  public async fetchSettlementState(): Promise<VenueSettlementState> {
    return { status: "SETTLEMENT_UNKNOWN", evidence: { reason: "adapter_not_configured" } };
  }

  public normalizeVenueError(error: unknown): NormalizedVenueError {
    return {
      code: "VENUE_EXECUTION_NOT_CONFIGURED",
      message: error instanceof Error ? error.message : `${this.venue} execution is not configured.`,
      retryable: false
    };
  }
}

export interface TestExecutionAdapterOptions {
  settlementStatus?: SettlementStatusV0;
  settlementEvidence?: Record<string, unknown>;
  fillStatus?: VenueFillState["status"];
  fillPrice?: number;
  failSubmit?: boolean;
  offchainFilled?: boolean;
}

export class TestExecutionAdapter implements ExecutionVenueAdapter {
  public readonly venue: string;

  public constructor(venue = "TEST", private readonly options: TestExecutionAdapterOptions = {}) {
    this.venue = venue;
  }

  public async prepareOrder(leg: ExecutionLegV0): Promise<PreparedVenueOrder> {
    return {
      venue: this.venue,
      clientOrderId: leg.executionLegId,
      payload: {
        venueMarketId: leg.venueMarketId,
        venueOutcomeId: leg.venueOutcomeId,
        side: leg.side,
        size: leg.size,
        price: leg.price
      }
    };
  }

  public async submitOrder(): Promise<VenueSubmitResult> {
    if (this.options.failSubmit) {
      throw new Error("test_adapter_submit_failed");
    }
    const fillStatus = this.options.fillStatus ?? "FILLED";
    return {
      venueOrderId: `test-order-${randomUUID()}`,
      fillId: `test-fill-${randomUUID()}`,
      status: fillStatus === "PARTIAL_FILL" ? "PARTIAL_FILL" : fillStatus === "FILLED" ? "FILLED" : "SUBMITTED",
      filledSize: fillStatus === "OPEN" ? "0" : "1",
      averagePrice: this.options.fillPrice ?? 0.5
    };
  }

  public async fetchFillState(): Promise<VenueFillState> {
    const status = this.options.fillStatus ?? "FILLED";
    return {
      status,
      filledSize: status === "OPEN" ? "0" : "1",
      averagePrice: this.options.fillPrice ?? 0.5,
      ...(this.options.offchainFilled !== undefined ? { offchainFilled: this.options.offchainFilled } : {})
    };
  }

  public async cancelOrder(): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }

  public async fetchSettlementState(): Promise<VenueSettlementState> {
    return {
      status: this.options.settlementStatus ?? "SETTLEMENT_VERIFIED",
      evidence: {
        adapter: "test",
        ...(this.options.settlementEvidence ?? {})
      }
    };
  }

  public normalizeVenueError(error: unknown): NormalizedVenueError {
    return {
      code: "TEST_ADAPTER_ERROR",
      message: error instanceof Error ? error.message : "unknown test adapter error",
      retryable: false
    };
  }
}

export class ExecutionVenueAdapterRegistry {
  private readonly adapters = new Map<string, ExecutionVenueAdapter>();

  public register(adapter: ExecutionVenueAdapter): void {
    this.adapters.set(adapter.venue, adapter);
  }

  public get(venue: string): ExecutionVenueAdapter {
    return this.adapters.get(venue) ?? new NotConfiguredExecutionAdapter(venue);
  }
}
