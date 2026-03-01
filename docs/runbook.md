# RFQ Service Operational Runbook

## Overview
The RFQ (Request for Quote) service manages low-latency price discovery and execution routing between takers and Liquidity Providers (LPs). It incorporates LP reliability tracking to optimize execution outcomes.

## Critical Paths
- **RFQ Creation**: Takers request prices for canonical markets.
- **Quote Submission**: LPs submit firm/indicative quotes.
- **Execution Routing**: Service selects the best quote and routes to the execution gateway.

## Monitoring & Observability
### Metrics (Prometheus)
- `rfq_created_total`: Total RFQ sessions initiated.
- `execution_success_total` / `execution_failure_total`: Tracking settlement outcomes.
- `lp_stats_update_total`: Frequency of reliability profile updates.
- `execution_latency_ms`: Time taken for gateway settlement (crucial for firm quote slippage).
- `lock_wait_time_ms`: Redis lock contention metrics.

### Logging (Pino)
- Standardized JSON logs with `sessionId`, `lpId`, and `traceId` where applicable.
- **Warning**: Failed lock acquisitions or stale quotes are logged as warnings.
- **Error**: Database connection failures or gateway timeouts.

## Troubleshooting
### Error: `RFQLockError`
- **Symptom**: Taker receive 500 or error message about unable to acquire lock.
- **Cause**: High contention for a single RFQ session (e.g., multiple concurrent accept attempts).
- **Resolution**: Check for duplicate client requests; ensure Redis is healthy and has sufficient memory.

### Error: `NoValidQuotesError`
- **Symptom**: RFQ fails with status `FAILED` and no execution.
- **Cause**: All quotes are stale or have been rejected by the LP/Gateway.
- **Resolution**: Review LP response times via `lp_stats` and check connectivity with LPs.

## Maintenance
### Database Migrations
- Standard migrations are located in `/infra/migrations`.
- Use `0003_create_lp_stats.sql` to initialize the reliability tracking table.

### Cleaning Old Data
- RFQ sessions and quotes should be archived or purged after 24 hours to maintain performance.
- Redis keys for idempotency and status locks have a 1-hour TTL.

## Safety Mechanisms
- **Fail-Closed**: If the execution gateway returns `ok: false`, the session is moved to `FAILED` and no duplicate settlement is attempted.
- **Price Dominance**: Reliability scores have a strict 10% cap to ensure the best price still wins in 90% of cases.
- **Atomic Updates**: LP stats use atomic UPSERTs to ensure counter integrity under high concurrency.
