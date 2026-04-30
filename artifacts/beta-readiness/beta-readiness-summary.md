# Lotus Backend Beta Readiness

Generated: 2026-04-30T21:56:10.291Z
Status: BLOCKED

## Components

| Component | Status | Generated | Blockers | Notes |
|---|---|---|---|---|
| admin_api_smoke | MISSING | n/a | Run npm run admin:api-smoke. | none |
| trading_readiness | BLOCKED | 2026-04-30T21:55:59.572Z | Last Polymarket harness attempt failed with POLYMARKET_V2_SDK_ERROR. | lastHarnessSubmitted=false |
| funding_readiness | BLOCKED | 2026-04-30T21:52:43.008Z | Funding gate failed for 5 venue(s). | passedVenues=0 |
| withdrawal_readiness | BLOCKED | 2026-04-30T21:52:49.925Z | Withdrawal completion gate failed for 5 venue(s). | passedVenues=0 |
| monetization_readiness | MISSING | n/a | Run npm run report:monetization:private-beta. | none |
| observability | PASSED | 2026-04-30T21:56:10.291Z | none | /health=200; /metrics=200 |

## Trading

- Current live venue: POLYMARKET
- Polymarket readiness: LIVE_READY
- Polymarket live execution enabled: true
- Polymarket feature flag selected: true
- Required env present: true
- Missing env: none

## Observability Alerts

- adminAuthFailures: Investigate if ADMIN_AUTH_LOGIN_FAILED or ADMIN_MAGIC_LOGIN failures spike above 5 in 15 minutes.
- adminRateLimit: Investigate if ADMIN_LOGIN_LINK_RATE_LIMITED or ADMIN_AUTH_LOGIN_RATE_LIMITED appears for an active operator.
- redisUnavailable: Investigate any Redis connection error lasting more than 5 minutes; admin login falls back but realtime paths may degrade.
- databaseErrors: Page operator on repeated pg connection/query failures or /health failure.
- failedExecutionSubmissions: Block live trading on any failed venue submit until execution record and venue state are reconciled.
- fundingReadinessStale: Block beta order flow for venues with readiness evidence older than 24 hours.
- withdrawalCompletionFailures: Block withdrawal completion persistence for venues with failed completion gates.
- resendDeliveryFailures: Investigate any ADMIN_MAGIC_LINK_SEND_FAILED for active admins.

## Safety

- This report is read-only.
- Live submit still requires operator flags.
- No secrets are included.
- Shadow monetization is not collected revenue.
