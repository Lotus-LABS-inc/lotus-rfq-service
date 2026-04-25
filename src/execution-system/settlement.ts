import type { ExecutionLegV0, SettlementStatusV0 } from "./types.js";
import type { ExecutionVenueAdapterRegistry } from "./venue-adapter.js";

export interface SettlementVerificationResult {
  status: SettlementStatusV0;
  evidence: Record<string, unknown>;
}

export interface SettlementVerifierConfig {
  timeoutMs: number;
  pollIntervalMs: number;
  maxAttempts?: number;
}

export class SettlementVerificationService {
  public constructor(
    private readonly adapters: ExecutionVenueAdapterRegistry,
    private readonly config: SettlementVerifierConfig = { timeoutMs: 1000, pollIntervalMs: 10 }
  ) {}

  public async verify(leg: ExecutionLegV0): Promise<SettlementVerificationResult> {
    const adapter = this.adapters.get(leg.venue);
    const id = leg.fillId ?? leg.venueOrderId;
    if (!id) {
      return { status: "SETTLEMENT_UNKNOWN", evidence: { reason: "missing_fill_or_order_id" } };
    }

    const startedAt = Date.now();
    let attempts = 0;
    while (Date.now() - startedAt <= this.config.timeoutMs) {
      attempts += 1;
      const settlement = await adapter.fetchSettlementState(id);
      if (settlement.status === "SETTLEMENT_VERIFIED" || settlement.status === "GHOST_FILL_CONFIRMED") {
        return {
          status: settlement.status,
          evidence: {
            attempts,
            ...(settlement.evidence ?? {})
          }
        };
      }
      if (this.config.maxAttempts && attempts >= this.config.maxAttempts) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
    }

    return {
      status: "SETTLEMENT_TIMEOUT",
      evidence: {
        attempts,
        timeoutMs: this.config.timeoutMs
      }
    };
  }
}
