# Pre-Trade Risk & Exposure Engine Design

## 1. Purpose & Scope
The Pre-Trade Risk & Exposure Engine is responsible for ensuring that all RFQ creation and execution activities remain within defined risk parameters. It provides real-time validation and exposure accounting across multiple dimensions:
- **Per-User**: Checks against user-specific notional caps.
- **Per-Market**: Checks against market-specific exposure limits.
- **Per-LP**: Monitors exposure to individual Liquidity Providers.
- **Global**: Enforces system-wide notional and risk thresholds.

## 2. Failure Semantics
The Risk Engine operates on a **Fail-Closed** principle:
- Any validation failure (e.g., limit exceeded) results in immediate rejection of the request.
- Any internal error within the Risk Engine (e.g., database connectivity issues, Redis lock timeouts) must result in a rejection to ensure system safety.

## 3. Data Flow Diagrams (Textual)

### RFQ Creation Lifecycle
1. `POST /rfq` request received.
2. `CreateRFQService` calls `RiskEngine.validateRFQCreation(rfq)`.
3. If failure-closed (error or rejection), return 403/429 to Taker.
4. If success, proceed with RFQ session creation.

### Execution Lifecycle
1. Execution command received for a specific quote.
2. `ExecutionRouterService` calls `RiskEngine.validateBeforeExecution(rfq, quote)`.
3. If failure-closed, reject execution and transition RFQ to `FAILED`.
4. If success, proceed with execution gateway settlement.
5. After successful settlement, `ExecutionRouterService` calls `RiskEngine.updateExposureAfterExecution(exec)`.

## 4. Redis + Postgres Roles

### Redis (Ephemeral State & Speed)
- **Rolling Counters**: High-frequency tracking of sliding window metrics (e.g., orders per second, volume in the last minute).
- **Quick Lookups**: Caching of active exposure snapshots for ultra-low latency pre-trade checks.
- **Temporary Locks**: Distributed locking to prevent concurrent exposure updates for the same subject.
- **Sliding Window Metrics**: Tracking short-term bursts that don't require permanent ledger entries for every tick.

### Postgres (Authoritative Persistence)
- **Authoritative Ledger**: The `exposures` and `risk_journal` tables are the source of truth.
- **Append-only Exposures Journal**: Every change to exposure must be recorded in a journal for auditability.
- **Reconciliation Anchor**: Used to rebuild Redis state during startup or after a crash.

## 5. Concurrency Model
- **Database Transactions**: All exposure updates in Postgres must occur within a transaction.
- **Row-Level Locking**: Use `SELECT ... FOR UPDATE` on user/market exposure rows to serialize updates within a single DB instance.
- **Distributed Locking**: Use Redis lock keys (e.g., `risk:lock:exposure:{userId}:{marketId}`) to coordinate exposure updates across multiple service instances.
- **Idempotency**: Execution updates must use the execution ID or RFQ ID as an idempotency key to prevent double-counting exposure on retries.

## 6. Thresholds & Configuration
Configurations are managed via environment variables and stored in the database for dynamic updates.

| Key | Description | Default |
|-----|-------------|---------|
| `RISK_USER_NOTIONAL_CAP` | Max notional exposure per individual user. | $1,000,000 |
| `RISK_MARKET_NOTIONAL_CAP` | Max notional exposure for a specific market. | $10,000,000 |
| `RISK_LP_NOTIONAL_CAP` | Max exposure to a single LP. | $5,000,000 |
| `RISK_GLOBAL_NOTIONAL_CAP` | System-wide maximum exposure. | $50,000,000 |
| `RISK_MAX_ORDER_NOTIONAL` | Maximum single order size. | $500,000 |
| `RISK_CIRCUIT_BREAKER_MAX_FAIL_RATE` | Threshold to trigger emergency stop. | 0.05 (5%) |

## 7. Monitoring & Alerts
### Metrics
- `risk_validation_failure_total`: Counter for rejected orders due to risk.
- `risk_exposure_current`: Gauge for active exposure per market.
- `risk_internal_error_total`: Counter for Risk Engine service failures.
- `risk_reconciliation_diff_total`: Gauge for discrepancies found during reconciliation.

### Alert Thresholds
- **Critical**: Exposure > 90% of any cap.
- **Warning**: Exposure > 75% of any cap.
- **Critical**: Risk Engine internal error rate > 1%.

## 8. Reconciliation Cadence
- **Hourly Incremental**: Reconcile Redis rolling counters against the Postgres authoritative ledger for the last hour.
- **Nightly Full**: Perform a full audit of all active exposures and reset Redis cache from the Postgres ledger.

## 9. Runbook Actions for Breach Events
1. **Breach Detected**: Risk Engine automatically rejects all new RFQs for the breached subject (User/Market/Global).
2. **Immediate Notification**: Alert triggered to ON-CALL.
3. **Manual Override**: Administrator can increase limits or manually settle/clear exposure via Admin CLI.
4. **Investigation**: Audit the `risk_journal` to identify the cause of the breach or stale exposure.

---

## 10. TypeScript Interfaces (Stubs)

```typescript
/**
 * Core Risk Engine interface for pre-trade and post-execution tasks.
 */
export interface IRiskEngine {
  /**
   * Validates if a new RFQ session can be created.
   * Throws Error on validation failure (Fail-Closed).
   */
  validateRFQCreation(rfq: Record<string, unknown>): Promise<void>;

  /**
   * Validates if an execution can proceed for a specific quote.
   * Throws Error if limits exceeded or internal failure occurs.
   */
  validateBeforeExecution(rfqId: string, quoteId: string): Promise<void>;

  /**
   * Updates authoritative and ephemeral exposure state after successful execution.
   */
  updateExposureAfterExecution(executionResult: Record<string, unknown>): Promise<void>;

  /**
   * Reconciles Redis ephemeral state with Postgres authoritative database.
   */
  reconcileExposureSnapshot(): Promise<void>;
}

/**
 * Repository interface for exposure persistence and journal logging.
 */
export interface IExposureRepository {
  /**
   * Retrieves the current exposure for a user and market.
   */
  getExposure(userId: string, marketId: string): Promise<IExposureModel>;

  /**
   * Atomically updates exposure values.
   */
  upsertExposure(userId: string, marketId: string, notionalDelta: number): Promise<void>;

  /**
   * Writes an immutable audit record to the risk journal.
   */
  writeJournal(entry: Record<string, unknown>): Promise<void>;
}

/**
 * Model representing active exposure for a specific dimension.
 */
export interface IExposureModel {
  userId: string;
  marketId: string;
  currentNotional: number;
  lastUpdated: Date;
  version: number; // For optimistic concurrency control if needed
}
```
