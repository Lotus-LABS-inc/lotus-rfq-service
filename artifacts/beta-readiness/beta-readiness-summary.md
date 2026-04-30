# Lotus Backend Beta Readiness

Generated: 2026-04-30T22:24:20.169Z
Status: BLOCKED

## Components

| Component | Status | Generated | Blockers | Notes |
|---|---|---|---|---|
| admin_api_smoke | PASSED | 2026-04-30T22:11:48.631Z | none | baseUrl=https://lotus-backend-g1e1.onrender.com |
| trading_readiness | PASSED | 2026-04-30T22:11:14.060Z | none | lastHarnessSubmitted=true |
| funding_readiness | BLOCKED | 2026-04-30T22:23:34.651Z | Funding gate failed for 5 venue(s). | passedVenues=0 |
| withdrawal_readiness | BLOCKED | 2026-04-30T22:24:16.157Z | Withdrawal completion gate failed for 5 venue(s). | passedVenues=0 |
| monetization_readiness | PASSED | 2026-04-30T22:19:55.364Z | none | actualBuilderFeesCollected=0; uncollectedImprovementOpportunity=0 |
| observability | PASSED | 2026-04-30T22:24:20.169Z | none | /health=200; /metrics=200 |

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
