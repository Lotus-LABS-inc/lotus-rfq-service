# Opinion Ops Service Runbook

## Purpose

Opinion account setup and funding balance reads must run through the Lotus ops service in an approved non-restricted service location. The Render backend should not call Opinion builder or funding balance APIs directly when an ops service URL is configured.

## Current Deployment Shape

- AWS Elastic Beanstalk application: `lotus-opinion-ops-service`
- Active environment: `lotus-opinion-ops-cac1b`
- Region: `ca-central-1`
- Health endpoint: `/health`
- Backend builder base URL env: `OPINION_BUILDER_SERVICE_URL`
- Backend funding balance URL env: `OPINION_FUNDING_BALANCE_URL`

Do not reuse the old EU Opinion read service. The EU/EEA service location is not part of the active Opinion path.

## Backend Env Contract

Render backend keeps only internal routing and rollout values:

- `OPINION_BUILDER_ACCOUNT_SETUP_ENABLED=true`
- `OPINION_BUILDER_SERVICE_URL=<active ops service base URL>`
- `OPINION_BUILDER_SERVICE_API_KEY=<internal bearer token>`
- `OPINION_FUNDING_BALANCE_URL=<active ops service /lotus/opinion/funding-balance URL>`
- `OPINION_FUNDING_READ_AUTH_MODE=BEARER`
- `OPINION_FUNDING_READ_API_KEY=<internal bearer token>`

The Opinion provider API key belongs on the AWS ops service, not in frontend env. If the Render backend also has provider keys for other read paths, funding readiness must still prefer `OPINION_FUNDING_BALANCE_URL`.

## AWS Ops Service Env Contract

The ops service keeps provider credentials and internal auth:

- `OPINION_BUILDER_API_KEY=<Opinion builder/provider credential>`
- `OPINION_BUILDER_SERVICE_API_KEY=<internal bearer token expected from backend>`
- `OPINION_FUNDING_READ_API_KEY=<internal bearer token expected from backend>`
- `OPINION_OPS_FUNDING_BALANCE_MODE=DIRECT_HTTP`
- `OPINION_OPS_FUNDING_BALANCE_BASE_URL=<Opinion OpenAPI base URL>`
- `OPINION_OPS_FUNDING_BALANCE_API_KEY=<Opinion provider credential>`
- `OPINION_OPS_FUNDING_BALANCE_AUTH_MODE=API_KEY`

Do not log or commit any token values.

## Verification

1. Check the ops service:
   - `GET /health` returns `200` with service `lotus-ops-read-service`.
   - Unauthenticated `POST /lotus/opinion/builder/safe` returns `401`.
   - Authenticated malformed `POST /lotus/opinion/builder/safe` returns `400`.
2. Check Render backend:
   - `/health` returns `200`.
   - `POST /user/venue-accounts/setup-batch` can return `OPINION_ENABLE_TRADING_SAFE_TX` when a Safe exists but trading is not enabled.
   - Opinion funding readiness calls the ops URL, not `openapi.opinion.trade`, from the Render process.

## Safety Boundary

This service does not change matcher logic, approved lanes, funding gates, execution-scope tokens, settlement verification, or venue execution semantics. It only moves Opinion builder setup and funding balance reads behind a controlled backend service location.
