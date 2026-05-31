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

## Opinion Orderbook Stream Service

Opinion orderbook streaming is split from the general Render stream worker because Opinion provider traffic must run from the approved non-restricted service location.

- AWS Elastic Beanstalk application: `lotus-opinion-orderbook-stream-service`
- Active environment: `lotus-opinion-stream-cac1b`
- Region: `ca-central-1`
- Health endpoint: `/health`
- Ready endpoint: `/ready`
- Service mode: `LOTUS_SERVICE_MODE=orderbook-stream-service`
- Venue ownership: `ORDERBOOK_STREAM_VENUES=OPINION`

The Render orderbook stream worker remains responsible for the other venues:

- Render service: `lotus-orderbook-stream-service`
- Venue ownership: `ORDERBOOK_STREAM_VENUES=POLYMARKET,LIMITLESS,PREDICT_FUN`

Do not add Opinion back to the Render stream worker unless provider access policy changes and the compliance path is explicitly reviewed.

### Redis Access

The Opinion stream service writes hot snapshots into the same Render Key Value/Redis layer used by the backend. Render services use the internal Redis URL, but AWS Elastic Beanstalk must use the Render Key Value external connection string.

The Render Key Value external IP allowlist must include the active EB environment EIP only. For the current `lotus-opinion-stream-cac1b` environment, the active EB EIP is:

```text
15.222.117.17/32
```

If the EB environment is recreated, the EIP changes. Update the Render Key Value external IP allowlist before expecting the stream service to stay healthy.

### Deployment Order

1. Build the backend bundle from the commit being deployed.
2. Create or update the EB application version in `ca-central-1`.
3. During first creation only, ensure the Render Key Value external connection can be reached by the new EB instance.
4. Launch the EB environment with:
   - `LOTUS_SERVICE_MODE=orderbook-stream-service`
   - `ORDERBOOK_STREAM_VENUES=OPINION`
   - `REDIS_URL=<Render Key Value external connection string>`
   - `DATABASE_URL` / `SUPABASE_DB_URL`
   - `JWT_SECRET`
   - `OPINION_BUILDER_API_KEY`
   - `OPINION_STREAM_WALLET_ADDRESS`
5. After EB reports the created EIP, narrow the Render Key Value external IP allowlist to that EIP.
6. Verify:
   - EB status is `Ready`
   - EB health is `Green`
   - `/health` returns `service: lotus-orderbook-stream-service`
   - `/ready` returns `ok: true`
   - logs show `venues:["OPINION"]`

Do not leave a failed replacement environment running. If a first attempt gets stuck in `No Data`, terminate it after the replacement environment is verified.

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
