# Lotus VPS Operations Runbook

Last updated: 2026-06-12

This runbook is the current operating guide for running Lotus backend services on the VPS while keeping production and staging separated.

It replaces the older migration notes that said production PostgreSQL should live on the VPS. That is no longer the intended production shape.

## Current Direction

Lotus backend services can run on the VPS, but production data remains in Supabase.

Current database authority:

```text
Production database: Supabase
Staging/test database: VPS-local PostgreSQL
Redis: VPS-local, ephemeral cache only
```

Production services must point both `DATABASE_URL` and `SUPABASE_DB_URL` at the production Supabase database host unless an explicit, reviewed database migration plan says otherwise.

Staging services can use the VPS-local staging database for realistic testing. Staging must not point at production Supabase unless the operator explicitly approves a narrowly scoped production-data check.

## Protected File Rule

This file is protected operational documentation.

Do not delete, untrack, move, or replace `docs/runbooks/vps-migration-runbook.md` without explicit operator approval and a replacement link in the repository.

The repo intentionally ignores most `docs/*` files, but `.gitignore` must keep a specific exception for this runbook so VPS deployment history and rollback instructions remain recoverable from git.

## Non-Negotiable Safety Rules

- Do not paste secrets into chat, tickets, docs, logs, or git.
- Do not commit `.env` files.
- Do not print raw database URLs, private keys, API keys, wallet secrets, HMAC secrets, or provider credentials.
- Do not delete, purge, or recursively overwrite `/etc/lotus`, `/opt/lotus`, `/var/log/lotus`, Redis data, Postgres data, Nginx config, systemd units, or backup folders without explicit approval.
- Before replacing config under `/etc/lotus`, `/etc/nginx`, `/etc/systemd/system`, or `/opt/lotus`, create a timestamped backup unless the file is newly created.
- Production and staging must use separate domains, env files, service names, logs, Redis namespaces or DBs, ports, callbacks, and relay URLs.
- Production frontend must not call staging API.
- Staging frontend must not call production API unless explicitly approved for a production smoke.
- Redis is not authoritative. It can cache market/catalog/orderbook/session display state, but Postgres/Supabase remains the durable source.
- Worker duties must be code/service-owned, not controlled by easy-to-miss env flags.
- `MARKET_ORDERBOOK_RECORDER_ENABLED` is deprecated/no-op. Do not add it back to env files.
- Required worker duties such as market orderbook recording, catalog materialization, execution status refresh, and funding cleanup belong in the worker service.
- Keep the API service focused on HTTP/WebSocket request handling. Do not run long-lived watchers inside the production API service.

## VPS Identity

Current VPS host:

```text
Provider: Vultr
Public IPv4: 198.13.44.245
SSH user for Codex/operator automation: codex
Application user: lotus
Repo path: /opt/lotus/lotus-rfq-service
Env root: /etc/lotus
Log root: /var/log/lotus
```

If access must be removed later, remove the `codex` SSH key from:

```text
/home/codex/.ssh/authorized_keys
```

or remove the user if it is no longer needed:

```bash
sudo deluser --remove-home codex
```

## Domains

Production:

```text
api.uselotus.xyz       -> VPS backend/API
ops.uselotus.xyz       -> VPS read/admin/ops host when enabled
relayer.uselotus.xyz   -> VPS relay front door
```

Staging:

```text
staging-api.uselotus.xyz       -> VPS staging backend/API
staging-relayer.uselotus.xyz   -> VPS staging relay front door
staging.uselotus.xyz           -> staging frontend
```

Frontend envs should be:

```text
Production frontend:
  VITE_LOTUS_API_BASE_URL=https://api.uselotus.xyz
  NEXT_PUBLIC_LOTUS_API_BASE_URL=https://api.uselotus.xyz

Staging/preview frontend:
  VITE_LOTUS_API_BASE_URL=https://staging-api.uselotus.xyz
  NEXT_PUBLIC_LOTUS_API_BASE_URL=https://staging-api.uselotus.xyz
```

Do not point staging frontend at `https://api.uselotus.xyz`; that mixes staging UI with production API/data.

## Certificates

The VPS uses Nginx + Certbot.

Relevant certificate groups:

```text
api.uselotus.xyz, ops.uselotus.xyz
relayer.uselotus.xyz, staging-relayer.uselotus.xyz
staging-api.uselotus.xyz
```

Check status:

```bash
sudo certbot certificates
systemctl list-timers | grep certbot
sudo nginx -t
```

Renewal is managed by `certbot.timer`.

If a new hostname is added:

```bash
sudo certbot --nginx -d example.uselotus.xyz
sudo nginx -t
sudo systemctl reload nginx
```

## Nginx Requirements

API hosts must support HTTP/2 and WebSocket upgrades.

Use HTTP/2 listeners:

```nginx
listen 443 ssl http2;
listen [::]:443 ssl http2;
```

Use a websocket-aware connection map:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' '';
}
```

Proxy locations should preserve websocket upgrades without forcing ordinary API requests to close:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Verify ALPN:

```bash
printf '' | openssl s_client -alpn h2 -connect api.uselotus.xyz:443 -servername api.uselotus.xyz 2>/dev/null | grep -i 'ALPN protocol'
printf '' | openssl s_client -alpn h2 -connect staging-api.uselotus.xyz:443 -servername staging-api.uselotus.xyz 2>/dev/null | grep -i 'ALPN protocol'
```

Expected:

```text
ALPN protocol: h2
```

## Service Layout

Run production and staging as separate systemd units.

Recommended production units:

```text
lotus-prod-backend.service
lotus-prod-read.service
lotus-prod-orderbook.service
lotus-prod-worker.service
lotus-prod-polymarket-relay.service
lotus-prod-predictfun-relay.service
```

Recommended staging units:

```text
lotus-staging-backend.service
lotus-staging-read.service
lotus-staging-orderbook.service
lotus-staging-worker.service
lotus-staging-polymarket-relay.service
lotus-staging-predictfun-relay.service
```

Recommended local ports:

```text
Production:
  backend:           3000
  read service:      3001
  orderbook service: 3002
  polymarket relay:  3003
  predictfun relay:  3004
  worker:            3093

Staging:
  backend:           3100
  read service:      3101
  orderbook service: 3102
  polymarket relay:  3103
  predictfun relay:  3104
  worker:            3193
```

Recommended logs:

```text
/var/log/lotus/prod/*.log
/var/log/lotus/staging/*.log
```

## Env Files

Use service-specific env files:

```text
/etc/lotus/prod/backend.env
/etc/lotus/prod/read-service.env
/etc/lotus/prod/orderbook-stream.env
/etc/lotus/prod/worker.env
/etc/lotus/prod/polymarket-relay.env
/etc/lotus/prod/predictfun-relay.env

/etc/lotus/staging/backend.env
/etc/lotus/staging/read-service.env
/etc/lotus/staging/orderbook-stream.env
/etc/lotus/staging/worker.env
/etc/lotus/staging/polymarket-relay.env
/etc/lotus/staging/predictfun-relay.env
```

Permissions:

```bash
sudo chown -R root:lotus /etc/lotus
sudo find /etc/lotus -type d -exec chmod 750 {} \;
sudo find /etc/lotus -type f -name '*.env' -exec chmod 640 {} \;
```

Do not copy every env key into every service. Keep env files scoped to what each service needs.

Production backend/worker database env rule:

```text
DATABASE_URL=<production Supabase database URL>
SUPABASE_DB_URL=<same production Supabase database URL>
```

Staging backend/worker database env rule:

```text
DATABASE_URL=<VPS-local staging database URL>
SUPABASE_DB_URL=<same VPS-local staging database URL, unless a staging Supabase DB exists and is explicitly chosen>
```

Redis:

```text
Production REDIS_URL=redis://127.0.0.1:6379/0
Staging REDIS_URL=redis://127.0.0.1:6379/1
```

Also keep deploy identity explicit:

```text
LOTUS_DEPLOY_ENV=prod
LOTUS_DEPLOY_ENV=staging
```

Redis market catalog snapshots are deploy-namespaced in code from `LOTUS_DEPLOY_ENV`, `LOTUS_ENV`, `APP_ENV`, or the public service hostname. Prod and staging may share the same local Redis server only if prefixes and DB indexes remain separated.

## Worker Ownership

Use one worker service per environment.

Production:

```bash
npm run start:worker-service
```

Staging:

```bash
npm run start:worker-service
```

The worker owns:

```text
market orderbook recorder
market catalog/readiness snapshot materializer
execution status watcher
execution order refresher
funding readiness watcher
funding intent cleanup watcher
future snapshot/refresh jobs
```

The API owns:

```text
HTTP routes
WebSocket gateway
auth/session routes
quote/preview/place/signature request handling
health and metrics
```

If the worker is down, the API should stay up and serve explicit resyncing/unavailable responses from existing hot snapshots. It should not rebuild every market, chart, balance, and orderbook live inside one user request.

## Database Layout

### Production

Production uses Supabase.

Rules:

```text
DATABASE_URL must point to Supabase production.
SUPABASE_DB_URL must point to Supabase production.
Do not use VPS-local lotus_prod as production authority.
Do not run destructive production SQL from the VPS without a reviewed target check.
Run migrations through the repo migration command only after confirming the target host.
```

Before production migrations:

```bash
node -e "console.log(new URL(process.env.DATABASE_URL).hostname)"
npm run db:verify:supabase
```

Then:

```bash
npm run db:migrate:supabase
```

### Staging

Staging can use VPS-local PostgreSQL.

Current intended staging database:

```text
PostgreSQL version: 17
Host: 127.0.0.1
Database: lotus_staging
Role: lotus_staging
```

Staging is allowed to contain:

```text
catalog/market/readiness data copied from production
approved test user data only
test execution/order/funding rows needed for staging validation
```

Staging must not contain a broad production user dump.

## Retention And Compaction

Detailed orderbook and funding history should not grow without bounds.

Policy:

```text
venue_orderbook_latest_snapshots: never pruned by retention job
venue_orderbook_snapshots: keep recent detail, compact older data into hourly buckets
venue_orderbook_snapshot_hourly_compactions: durable hourly chart/debug history
funding_audit_events: remove exact old duplicates only
funding_reconciliation_records: remove old successful ready rows only after retaining recent rows per leg
failures/unresolved rows: preserved
```

Run report-only first:

```bash
npm run report:db:hygiene
npm run db:retention:compact
```

Apply only after reading the artifact and confirming the target DB:

```bash
npm run db:retention:compact -- --apply
```

Production rule:

```text
Run on VPS-local staging first.
Confirm frontend health and market/funding pages.
Only then run production dry-run against Supabase.
Never run --apply if the printed target is not the intended DB.
```

## Relay Front Door

Public relay hosts:

```text
https://relayer.uselotus.xyz
https://staging-relayer.uselotus.xyz
```

Routes:

```text
/polymarket/health
/predictfun/health
/polymarket/internal/*
/predictfun/internal/*
```

Health routes are public.

Internal submit/readiness routes must be:

```text
IP-allowlisted at Nginx
HMAC-authenticated inside the Node relay
not exposed as open public routes
```

If backend and relay both run on the VPS, backend envs should prefer localhost relay URLs:

```text
Production Polymarket relay: http://127.0.0.1:3003
Production Predict.fun relay: http://127.0.0.1:3004
Staging Polymarket relay: http://127.0.0.1:3103
Staging Predict.fun relay: http://127.0.0.1:3104
```

Use public relay URLs only when a non-local backend must call the relay and the source IP is allowlisted.

## GitHub Deploy To VPS

The backend repo contains a GitHub Actions workflow:

```text
.github/workflows/deploy-vps-backend.yml
```

It deploys on pushes to:

```text
staging
main
```

It can also run manually with:

```text
workflow_dispatch.run_migrations=true|false
```

Required GitHub secrets per environment:

```text
VPS_HOST
VPS_USER
VPS_SSH_PRIVATE_KEY
```

Required or recommended GitHub environment variables:

```text
VPS_PORT=22
VPS_BACKEND_DIR=/opt/lotus/lotus-rfq-service
VPS_SYSTEMD_SERVICES=<space-separated services to restart>
```

Recommended staging value:

```text
VPS_SYSTEMD_SERVICES=lotus-staging-backend lotus-staging-read lotus-staging-orderbook lotus-staging-worker lotus-staging-polymarket-relay lotus-staging-predictfun-relay
```

Recommended production value:

```text
VPS_SYSTEMD_SERVICES=lotus-prod-backend lotus-prod-read lotus-prod-orderbook lotus-prod-worker lotus-prod-polymarket-relay lotus-prod-predictfun-relay
```

The workflow does:

```text
git fetch
git checkout branch
git reset --hard origin/branch
npm ci
npm run build
npm run db:migrate:supabase when enabled
systemctl restart configured services
npm run report:vps-runtime-smoke -- staging|production
```

Important:

```text
On production, migrations must target Supabase, not VPS-local Postgres.
On staging, migrations must target the staging DB selected by staging env files.
Do not use the default VPS_SYSTEMD_SERVICES=lotus-backend unless that service really exists.
```

## Manual Deploy

If GitHub deploy is unavailable:

```bash
cd /opt/lotus/lotus-rfq-service
sudo -u lotus git fetch origin
sudo -u lotus git checkout staging
sudo -u lotus git reset --hard origin/staging
sudo -u lotus npm ci
sudo -u lotus npm run build
```

Run migrations only after confirming the target:

```bash
node -e "console.log(new URL(process.env.DATABASE_URL).hostname)"
npm run db:migrate:supabase
```

Restart only the intended environment:

```bash
sudo systemctl restart lotus-staging-backend lotus-staging-read lotus-staging-orderbook lotus-staging-worker
sudo systemctl status lotus-staging-backend --no-pager
```

For production:

```bash
sudo systemctl restart lotus-prod-backend lotus-prod-read lotus-prod-orderbook lotus-prod-worker
sudo systemctl status lotus-prod-backend --no-pager
```

Relay restarts should be intentional:

```bash
sudo systemctl restart lotus-prod-polymarket-relay lotus-prod-predictfun-relay
```

## Smoke Checks

Run:

```bash
npm run report:vps-runtime-smoke -- staging
npm run report:vps-runtime-smoke -- production
```

Manual checks:

```bash
curl --noproxy '*' https://staging-api.uselotus.xyz/health
curl --noproxy '*' https://api.uselotus.xyz/health
curl --noproxy '*' 'https://staging-api.uselotus.xyz/markets?limit=8&quoteReadyOnly=true&view=compact'
curl --noproxy '*' 'https://api.uselotus.xyz/markets?limit=8&quoteReadyOnly=true&view=compact'
curl --noproxy '*' https://staging-relayer.uselotus.xyz/polymarket/health
curl --noproxy '*' https://relayer.uselotus.xyz/polymarket/health
```

Expected:

```text
health routes: 200
market route: 200 with non-empty payload when snapshots are healthy
relay health: 200
external relay internal routes: 403 or authenticated error, never open submit
```

## Market Snapshot Stability

The frontend should not depend on rebuilding heavy catalog/readiness payloads from Supabase on every load.

Current target behavior:

```text
worker builds market/readiness/orderbook snapshots
API reads Redis/materialized latest snapshots
API uses last-known display data for UI continuity where safe
execution preview/place/signatures still revalidate fresh live gates
cached display data never authorizes execution
```

The materializer should not write poisoned empty quote-ready snapshots. Empty quote-ready results should represent real current market state, not a transient provider/readiness timeout.

## Rollback

Rollback depends on what is currently active.

If old Render services are still active:

```text
1. Point frontend/API DNS or Vercel envs back to the known-good Render host.
2. Point relay URLs back to the known-good relay host.
3. Restart affected frontend/backend services.
4. Confirm /health.
5. Confirm markets, wallet, funding, terminal, and at least one dry-run/preview path.
```

If old Render services have been paused:

```text
1. Re-enable the last known-good Render services first.
2. Confirm their envs still point at the intended production database and relay.
3. Run Render health checks.
4. Only then repoint DNS/envs.
```

Do not assume Render rollback is available if the old services are paused.

## Done Criteria

The VPS-backed backend is healthy only when:

```text
api.uselotus.xyz health is 200
staging-api.uselotus.xyz health is 200
relayer health routes are 200
external internal relay routes are not open
production DATABASE_URL and SUPABASE_DB_URL point to Supabase
staging DATABASE_URL points to the staging DB
Redis is reachable
worker service is running
market snapshots are being refreshed
frontend loads markets without heavy request fanout
terminal opens with live orderbook data
wallet/funding panels load
venue balances load
execution-system tests pass for any touched execution path
rollback path is known
```

## Quick Triage

Markets missing or only a few cards show:

```bash
sudo systemctl status lotus-prod-worker --no-pager
sudo journalctl -u lotus-prod-worker -n 200 --no-pager
curl --noproxy '*' 'https://api.uselotus.xyz/markets?limit=8&quoteReadyOnly=true&view=compact'
```

Staging frontend using production data:

```text
Check Vercel preview/staging env:
VITE_LOTUS_API_BASE_URL must be https://staging-api.uselotus.xyz
```

Polymarket relay env incomplete:

```bash
sudo systemctl status lotus-prod-polymarket-relay --no-pager
sudo journalctl -u lotus-prod-polymarket-relay -n 200 --no-pager
```

Do not print relay env values. Verify only key presence and service mode.

Database target concern:

```bash
node -e "console.log(new URL(process.env.DATABASE_URL).hostname)"
node -e "console.log(new URL(process.env.SUPABASE_DB_URL).hostname)"
```

Production should show a Supabase host.
