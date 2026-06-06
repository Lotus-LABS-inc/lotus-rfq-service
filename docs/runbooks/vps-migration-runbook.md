# Lotus VPS Migration Runbook

This runbook explains how to move Lotus from Render/AWS-style managed services to one VPS while keeping the app safe, testable, and easy to roll back.

The goal is not to turn off Render/AWS immediately. The goal is:

1. Build the VPS beside the current production services.
2. Start Lotus services on the VPS with the same code and envs.
3. Prove health, quote, orderbook, venue, wallet, and execution checks pass.
4. Move traffic gradually.
5. Keep Render/AWS alive until the VPS has survived real usage.

## Plain-English Model

Think of Lotus as several workers, not one app:

- `lotus-backend-v1`: the main API. Handles user requests, auth, market reads, funding, execution orchestration, and most backend routes.
- `lotus-read-service`: read-heavy helper service.
- `lotus-orderbook-stream-service`: keeps live orderbook snapshots fresh.
- `lotus-polymarket-execution-relay`: submits Polymarket orders. This is execution-critical.
- `lotus-predictfun-execution-relay`: Predict.fun submit relay if enabled.
- `Redis`: hot temporary cache for orderbooks/websocket state. Redis is not the source of truth.
- `PostgreSQL 17`: authoritative database. Now running on the VPS itself (migrated from Supabase 2026-06-06). Both prod and staging databases are hosted locally on the VPS.
- `Nginx` or `Caddy`: public HTTPS front door that routes traffic to each local Lotus service.

On one VPS, these should still run as separate services. One server does not mean one process.

## Non-Negotiable Safety Rules

- Do not paste secrets into chat, tickets, docs, logs, or Git.
- Do not commit `.env` files.
- Do not point production execution traffic at the VPS until health and execution tests pass.
- Do not change execution logic during infrastructure migration.
- Do not combine Polymarket relay behavior with Opinion/Predict/other services in one process.
- Keep Render/AWS running until the VPS is proven and rollback is tested.
- Polymarket relay changes still follow `docs/runbooks/polymarket-execution-relay-eb-runbook.md`.
- Keep production and staging separated by env files, domains, ports, service names, logs, Redis namespaces/DBs, and callback URLs.
- Do not delete, overwrite, or purge server files without an explicit approval step.
- Back up existing server config before replacing it.

## Safe Access For Codex

Codex should connect with a dedicated SSH key that can be removed later.

The public key is safe to share. The private key must stay on the local machine.

Recommended server setup:

```bash
sudo adduser codex
sudo usermod -aG sudo codex
sudo mkdir -p /home/codex/.ssh
sudo nano /home/codex/.ssh/authorized_keys
sudo chown -R codex:codex /home/codex/.ssh
sudo chmod 700 /home/codex/.ssh
sudo chmod 600 /home/codex/.ssh/authorized_keys
```

Paste the Codex public key into `authorized_keys`, one line only.

Then send Codex only:

```text
VPS public IP
SSH username, usually codex
SSH port, usually 22
Whether the user has sudo
Whether production DNS should remain untouched, expected yes
```

Do not send:

```text
private SSH keys
passwords
raw env values
API keys
database passwords
wallet secrets
```

Codex should test access with:

```bash
ssh -i ~/.ssh/lotus_vps_codex codex@VPS_IP
```

If access needs to be removed later:

```bash
sudo deluser --remove-home codex
```

Or remove only the public key from:

```text
/home/codex/.ssh/authorized_keys
```

## Production And Staging Separation

Use separate service names:

```text
lotus-staging-backend
lotus-staging-read-service
lotus-staging-orderbook-stream
lotus-staging-polymarket-relay

lotus-prod-backend
lotus-prod-read-service
lotus-prod-orderbook-stream
lotus-prod-polymarket-relay
```

Use separate env files:

```text
/etc/lotus/staging/backend.env
/etc/lotus/staging/read-service.env
/etc/lotus/staging/orderbook-stream.env
/etc/lotus/staging/polymarket-relay.env

/etc/lotus/prod/backend.env
/etc/lotus/prod/read-service.env
/etc/lotus/prod/orderbook-stream.env
/etc/lotus/prod/polymarket-relay.env
```

Use separate local ports:

```text
staging backend: 3100
staging read: 3101
staging orderbook: 3102
staging polymarket relay: 3103

prod backend: 3000
prod read: 3001
prod orderbook: 3002
prod polymarket relay: 3003
```

Use separate logs:

```text
/var/log/lotus/staging/*.log
/var/log/lotus/prod/*.log
```

Use separate Redis key prefixes where supported:

```text
LOTUS_REDIS_KEY_PREFIX=staging:
LOTUS_REDIS_KEY_PREFIX=prod:
```

If Redis key prefix is not supported everywhere yet, use separate Redis DB indexes:

```text
staging REDIS_URL=redis://127.0.0.1:6379/1
prod REDIS_URL=redis://127.0.0.1:6379/0
```

Do not share staging and production relay callback URLs, frontend origins, CORS origins, or execution relay URLs unless explicitly approved.

## Recommended VPS Shape

For one VPS running all Lotus backend services:

```text
Ubuntu 24.04 LTS
CPU Optimized
4 vCPU minimum
8 GB RAM minimum
80+ GB disk
Automatic backups enabled
DDoS protection enabled
Public IPv4 enabled
Limited user login enabled
```

For heavier orderbook traffic:

```text
8 vCPU
16 GB RAM
```

## DNS Layout

Use staging subdomains first:

```text
api-staging-vps.uselotus.xyz        -> VPS public IP
read-staging-vps.uselotus.xyz       -> VPS public IP
orderbook-staging-vps.uselotus.xyz  -> VPS public IP
poly-relay-staging-vps.uselotus.xyz -> VPS public IP
```

Production cutover happens later:

```text
api.uselotus.xyz
read.uselotus.xyz
poly-relay.uselotus.xyz
```

Do not overwrite production DNS until staging VPS checks pass.

Current preferred relay layout:

```text
relayer.uselotus.xyz/polymarket/health
relayer.uselotus.xyz/predictfun/health
relayer.uselotus.xyz/polymarket/internal/*
relayer.uselotus.xyz/predictfun/internal/*

staging-relayer.uselotus.xyz/polymarket/health
staging-relayer.uselotus.xyz/predictfun/health
staging-relayer.uselotus.xyz/polymarket/internal/*
staging-relayer.uselotus.xyz/predictfun/internal/*
```

The health routes are public. The `/internal/*` routes must be IP-allowlisted at Nginx and still require the relay HMAC headers inside the Node relay. Do not expose relay readiness publicly; it can reveal configuration state. Allow it only from localhost/VPS/operator IPs.

For DNS cutover:

```text
relayer.uselotus.xyz         A -> 198.13.44.245
staging-relayer.uselotus.xyz A -> 198.13.44.245
```

As of the first relayer VPS setup, `api.uselotus.xyz` and `ops.uselotus.xyz` remain on Render. Do not repoint them until the backend/read service cutover is separately approved.

## Server Bootstrap

SSH into the VPS as the limited sudo user.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl build-essential redis-server nginx ufw
```

Install Node.js 22+:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

Create a service user:

```bash
sudo useradd --system --create-home --shell /bin/bash lotus
sudo mkdir -p /opt/lotus /etc/lotus /var/log/lotus
sudo chown -R lotus:lotus /opt/lotus /var/log/lotus
sudo chmod 750 /etc/lotus
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## Clone And Build Lotus

```bash
sudo -u lotus bash
cd /opt/lotus
git clone https://github.com/macethemaniac/lotus-rfq-service.git
cd lotus-rfq-service
npm ci
npm run build
exit
```

## Env Files

Use separate env files per process:

```text
/etc/lotus/backend.env
/etc/lotus/read-service.env
/etc/lotus/orderbook-stream.env
/etc/lotus/polymarket-relay.env
/etc/lotus/predictfun-relay.env
```

Permissions:

```bash
sudo chown root:lotus /etc/lotus/*.env
sudo chmod 640 /etc/lotus/*.env
```

Each file should contain only the envs needed by that service.

Examples:

```text
# /etc/lotus/backend.env
NODE_ENV=production
PORT=3000
DATABASE_URL=...
SUPABASE_DB_URL=...
REDIS_URL=redis://127.0.0.1:6379
```

```text
# /etc/lotus/orderbook-stream.env
NODE_ENV=production
PORT=3002
DATABASE_URL=...
SUPABASE_DB_URL=...
REDIS_URL=redis://127.0.0.1:6379
LOTUS_SERVICE_MODE=orderbook-stream-service
```

```text
# /etc/lotus/polymarket-relay.env
NODE_ENV=production
PORT=3003
LOTUS_SERVICE_MODE=polymarket-execution-relay
```

Do not copy every Render env blindly into every service. Keep service-specific envs tight.

## systemd Services

Create one service per Lotus process.

### Backend

```bash
sudo nano /etc/systemd/system/lotus-backend.service
```

```ini
[Unit]
Description=Lotus Backend
After=network.target redis-server.service

[Service]
WorkingDirectory=/opt/lotus/lotus-rfq-service
EnvironmentFile=/etc/lotus/backend.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
User=lotus
Group=lotus
StandardOutput=append:/var/log/lotus/backend.log
StandardError=append:/var/log/lotus/backend.err.log

[Install]
WantedBy=multi-user.target
```

### Read Service

```bash
sudo nano /etc/systemd/system/lotus-read-service.service
```

```ini
[Unit]
Description=Lotus Read Service
After=network.target redis-server.service

[Service]
WorkingDirectory=/opt/lotus/lotus-rfq-service
EnvironmentFile=/etc/lotus/read-service.env
ExecStart=/usr/bin/npm run start:ops-read
Restart=always
RestartSec=5
User=lotus
Group=lotus
StandardOutput=append:/var/log/lotus/read-service.log
StandardError=append:/var/log/lotus/read-service.err.log

[Install]
WantedBy=multi-user.target
```

### Orderbook Stream Service

```bash
sudo nano /etc/systemd/system/lotus-orderbook-stream.service
```

```ini
[Unit]
Description=Lotus Orderbook Stream Service
After=network.target redis-server.service

[Service]
WorkingDirectory=/opt/lotus/lotus-rfq-service
EnvironmentFile=/etc/lotus/orderbook-stream.env
ExecStart=/usr/bin/npm run start:orderbook-stream-service
Restart=always
RestartSec=5
User=lotus
Group=lotus
StandardOutput=append:/var/log/lotus/orderbook-stream.log
StandardError=append:/var/log/lotus/orderbook-stream.err.log

[Install]
WantedBy=multi-user.target
```

### Polymarket Relay

```bash
sudo nano /etc/systemd/system/lotus-polymarket-relay.service
```

```ini
[Unit]
Description=Lotus Polymarket Execution Relay
After=network.target

[Service]
WorkingDirectory=/opt/lotus/lotus-rfq-service
EnvironmentFile=/etc/lotus/polymarket-relay.env
ExecStart=/usr/bin/npm run start:polymarket-execution-relay
Restart=always
RestartSec=5
User=lotus
Group=lotus
StandardOutput=append:/var/log/lotus/polymarket-relay.log
StandardError=append:/var/log/lotus/polymarket-relay.err.log

[Install]
WantedBy=multi-user.target
```

### Enable Services

```bash
sudo systemctl daemon-reload
sudo systemctl enable lotus-backend lotus-read-service lotus-orderbook-stream lotus-polymarket-relay
sudo systemctl start lotus-backend lotus-read-service lotus-orderbook-stream lotus-polymarket-relay
```

Check status:

```bash
sudo systemctl status lotus-backend
sudo systemctl status lotus-read-service
sudo systemctl status lotus-orderbook-stream
sudo systemctl status lotus-polymarket-relay
```

Logs:

```bash
sudo journalctl -u lotus-backend -f
sudo tail -f /var/log/lotus/backend.err.log
```

## Nginx Reverse Proxy

Example with one API hostname:

```nginx
server {
  listen 80;
  server_name api-staging-vps.uselotus.xyz;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Add similar blocks for:

```text
read-staging-vps.uselotus.xyz       -> 127.0.0.1:3001
orderbook-staging-vps.uselotus.xyz  -> 127.0.0.1:3002
poly-relay-staging-vps.uselotus.xyz -> 127.0.0.1:3003
```

Test:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Add TLS with Certbot or use Caddy if preferred.

## Health Checks

From your local machine:

```bash
curl https://api-staging-vps.uselotus.xyz/health
curl https://read-staging-vps.uselotus.xyz/health
curl https://orderbook-staging-vps.uselotus.xyz/health
curl https://poly-relay-staging-vps.uselotus.xyz/health
```

Expected: all return `200`.

## Required Verification Before Traffic Cutover

Run from the VPS repo:

```bash
npm run typecheck
npm run report:latency:baseline
npm run report:market:quote-readiness-drift
npm run report:beta-readiness
npm run test:execution-system
```

Also verify provider access from the VPS:

```text
VPS-local PostgreSQL 17 connection works (pg_lsclusters shows 17/main online, curl /health returns 200)
Redis connection works
Turnkey calls work
Polymarket quote/read works
Polymarket relay /health works
Limitless quote/readiness works
Predict quote/readiness works
Opinion market detail works from this region
Opinion builder setup works from this region if enabled
```

## Migration Order

Move in this order:

1. Read-only services first.
2. Orderbook stream service.
3. Main backend.
4. Polymarket relay last.

Do not move execution first.

## Frontend Cutover

For staging, point frontend API envs at:

```text
api-staging-vps.uselotus.xyz
read-staging-vps.uselotus.xyz
orderbook-staging-vps.uselotus.xyz
```

Run a manual pass:

```text
Markets load
Route counts stable
Orderbooks update
Rules/resolution sources show real venue metadata
Wallet panel loads
Funding modal loads
Venue balances load
Polymarket preview works
Limitless preview works
Opinion quote readiness works
Predict quote readiness works
```

Only after that, switch production DNS.

## Execution Cutover

Before changing `POLYMARKET_EXECUTION_RELAY_URL` to the VPS relay:

```bash
curl https://poly-relay-staging-vps.uselotus.xyz/health
```

Then run:

```bash
npm run test:execution-system
```

For live execution testing, follow the live test identity rules in `rules.md`.

Do not run live user-funded execution tests from random wallets or admin wallets.

## Rollback

Keep Render/AWS alive.

If VPS fails:

1. Change DNS/API envs back to Render/AWS.
2. Change `POLYMARKET_EXECUTION_RELAY_URL` back to the known-good relay.
3. Restart frontend/backend if envs changed.
4. Confirm `/health`.
5. Confirm market load and venue balance load.

Rollback should take minutes, not hours, if old services were left running.

## Deployment Updates After VPS Is Live

Use this sequence for future deploys:

```bash
cd /opt/lotus/lotus-rfq-service
sudo -u lotus git fetch origin
sudo -u lotus git checkout main
sudo -u lotus git pull --ff-only
sudo -u lotus npm ci
sudo -u lotus npm run build
sudo systemctl restart lotus-backend lotus-read-service lotus-orderbook-stream lotus-polymarket-relay
```

Check:

```bash
sudo systemctl status lotus-backend
curl https://api.uselotus.xyz/health
```

## Can Codex Do This?

Codex can do most of the migration if given controlled access:

```text
VPS IP address
SSH username
SSH key access from this machine
Target staging subdomains
Confirmation of which services should run on the VPS
Permission to copy Render envs into /etc/lotus/*.env without printing them
DNS provider access or instructions
```

Codex should not:

```text
Ask you to paste secrets into chat
Commit env files
Run live execution tests without explicit approval
Turn off Render/AWS before rollback is proven
```

Best operator flow:

1. Human creates VPS and DNS records.
2. Human grants SSH access.
3. Codex installs system packages, clones repo, creates service files, copies envs safely from local/Render if available, starts services, and runs checks.
4. Human approves staging frontend cutover.
5. Human approves production cutover after staging passes.

## Done Criteria

The VPS migration is complete only when:

```text
All health endpoints are 200
Redis is stable
VPS-local PostgreSQL 17 is healthy and accessible from all services
Markets load consistently
Orderbook updates are live
Venue balances load
Funding modal loads
Rules/resolution source metadata displays
Polymarket relay health is good
Execution-system tests pass
Beta readiness report is acceptable
Rollback path has been tested
Render/AWS retirement is explicitly approved
```

## Current Vultr VPS Bootstrap State

As of the first VPS bootstrap pass:

```text
Host: 198.13.44.245
SSH user: codex
App user: lotus
Repo path: /opt/lotus/lotus-rfq-service
Env root: /etc/lotus
Prod env path: /etc/lotus/prod/*.env
Staging env path: /etc/lotus/staging/*.env
Logs: /var/log/lotus/prod and /var/log/lotus/staging
Redis: localhost only
```

Prod service units are installed but disabled:

```text
lotus-prod-backend.service             port 3000 localhost, active/enabled after VPS cutover prep
lotus-prod-read.service                port 3001 localhost, active/enabled after VPS cutover prep
lotus-prod-orderbook.service           port 3002 localhost, active/enabled after VPS cutover prep
lotus-prod-polymarket-relay.service    port 3003 localhost, active after relay cutover prep
lotus-prod-predictfun-relay.service    port 3004 localhost, active after relay cutover prep
lotus-prod-worker.service              port 3093 localhost, active; owns recorder/materializer/watchers
```

Staging service units:

```text
lotus-staging-backend.service          port 3100 localhost, active
lotus-staging-read.service             port 3101 localhost, active
lotus-staging-orderbook.service        port 3102 localhost, active
lotus-staging-polymarket-relay.service port 3103 localhost, active
lotus-staging-predictfun-relay.service port 3104 localhost, active
lotus-staging-worker.service           port 3193 localhost, active; owns recorder/materializer/watchers
```

Prod env files were generated from the current server-side env bundle with these safety changes:

```text
HOST=127.0.0.1
REDIS_URL=redis://127.0.0.1:6379/0
DATABASE_URL=postgresql://lotus_prod:<password>@127.0.0.1:5432/lotus_prod  (VPS-local PG17, post-migration)
SUPABASE_DB_URL=postgresql://lotus_prod:<password>@127.0.0.1:5432/lotus_prod  (same as DATABASE_URL)
frontend VITE_* values, Render API keys, smoke keys, and test DB keys excluded
```

Market orderbook recording is code-owned by the worker service. Do not add the
legacy `MARKET_ORDERBOOK_RECORDER_ENABLED` flag to prod or staging env files;
the recorder no longer reads it. If the worker service is active,
recorder/materializer duties are expected to run. This keeps
`/markets?quoteReadyOnly=true` backed by fresh/stable Redis/materialized
snapshots instead of stale DB rows.

Redis market catalog snapshots are deploy-namespaced in code from
`LOTUS_DEPLOY_ENV`, `LOTUS_ENV`, `APP_ENV`, or the public service hostname. Keep
`LOTUS_DEPLOY_ENV=prod` in production env files and
`LOTUS_DEPLOY_ENV=staging` in staging env files. Prod and staging may share the
same local Redis server only if their snapshot prefixes remain separated; do not
revert to the legacy `lotus:market-catalog-snapshot:*` shared prefix.

PostgreSQL connection pool notes (VPS-local, post-migration):

```text
VPS-local PG17 has max_connections=100 and no session-pool limit.
EMAXCONNSESSION no longer applies — that was a Supabase session-pooler constraint.
PG_POOL_MAX can be left at application defaults for all services.
If you re-add PG_POOL_MAX, keep worker ≥ API since the worker runs concurrent recorder/materializer jobs.
```

Staging env files are templates only. They intentionally have empty DB/JWT fields until a real staging-only JWT/venue-secret bundle is provided. Do not start staging by copying prod envs.

Smoke result from the VPS:

```text
npm run build: passed
prod backend /health: 200
prod read /health: 200
prod orderbook /health: 200
prod orderbook /ready: 200
prod polymarket relay /health: 200
prod predictfun relay /health: 200
```

After the first smoke, prod backend/read/orderbook were stopped and left disabled to avoid duplicate background execution refreshers against the same production database before cutover. During full VPS cutover prep on 2026-05-31, prod backend/read/orderbook were started and enabled on boot after local and Nginx Host-header smoke checks passed. Prod relay processes can stay active because they do not submit orders unless the backend calls their authenticated `/internal/*` routes.

To re-run the localhost smoke:

```bash
sudo systemctl start lotus-prod-backend lotus-prod-read lotus-prod-orderbook lotus-prod-polymarket-relay lotus-prod-predictfun-relay
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3002/ready
curl http://127.0.0.1:3003/health
curl http://127.0.0.1:3004/health
sudo systemctl stop lotus-prod-backend lotus-prod-read lotus-prod-orderbook lotus-prod-polymarket-relay lotus-prod-predictfun-relay
```

## VPS Relayer Nginx Front Door

The VPS uses Nginx for relay routing. The active config is:

```text
/etc/nginx/conf.d/lotus-relayer.conf
```

Backups from the first install were stored under:

```text
/etc/nginx/conf.d/backup-20260531T034930Z
/etc/lotus/backups/env-20260531T035546Z
```

The relayer front door is intentionally narrow:

```text
GET  /polymarket/health                 public
GET  /predictfun/health                 public
GET  /polymarket/readiness              IP allowlisted only
GET  /predictfun/readiness              IP allowlisted only
POST /polymarket/internal/*             IP allowlisted + relay HMAC
POST /predictfun/internal/*             IP allowlisted + relay HMAC
```

Current allowlist in Nginx:

```text
127.0.0.1
198.13.44.245
74.220.49.0/24  # Render backend outbound bridge
74.220.57.0/24  # Render backend outbound bridge
```

If a future backend/builder service must call the relayer through the public hostname, add only that service's fixed egress IP to the Nginx allowlist. Do not open `/internal/*` to the internet.

Required checks after any relay proxy change:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -H 'Host: relayer.uselotus.xyz' http://127.0.0.1/polymarket/health
curl -H 'Host: relayer.uselotus.xyz' http://127.0.0.1/predictfun/health
curl -i -X POST -H 'Host: relayer.uselotus.xyz' -H 'Content-Type: application/json' --data '{}' \
  http://127.0.0.1/polymarket/internal/polymarket/v2/submit-order
```

The unsigned internal call from localhost should reach the relay and return `POLYMARKET_RELAY_AUTH_MISSING` or the equivalent Predict.fun HMAC error. From a non-allowlisted external IP, the same internal call should return Nginx `403`.

Before TLS:

```bash
curl --noproxy '*' -H 'Host: relayer.uselotus.xyz' http://198.13.44.245/polymarket/health
curl --noproxy '*' -H 'Host: staging-relayer.uselotus.xyz' http://198.13.44.245/predictfun/health
```

After DNS points to the VPS, issue HTTPS certificates and verify:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d relayer.uselotus.xyz -d staging-relayer.uselotus.xyz
curl https://relayer.uselotus.xyz/polymarket/health
curl https://relayer.uselotus.xyz/predictfun/health
```

Current certificate state after the first VPS relayer TLS setup:

```text
Certificate name: relayer.uselotus.xyz
Domains covered:
  - relayer.uselotus.xyz
  - staging-relayer.uselotus.xyz
Certificate path: /etc/letsencrypt/live/relayer.uselotus.xyz/fullchain.pem
Private key path: /etc/letsencrypt/live/relayer.uselotus.xyz/privkey.pem
Expiry: 2026-08-29
Renewal: certbot.timer
```

Post-TLS checks that passed on 2026-05-31:

```bash
curl --noproxy '*' https://relayer.uselotus.xyz/polymarket/health
curl --noproxy '*' https://relayer.uselotus.xyz/predictfun/health
curl --noproxy '*' https://staging-relayer.uselotus.xyz/polymarket/health
curl --noproxy '*' https://staging-relayer.uselotus.xyz/predictfun/health
curl --noproxy '*' -i https://relayer.uselotus.xyz/polymarket/readiness
curl --noproxy '*' -i -X POST -H 'Content-Type: application/json' --data '{}' \
  https://relayer.uselotus.xyz/polymarket/internal/polymarket/v2/submit-order
```

Expected results:

```text
health routes: 200
external readiness: 403
external internal submit path: 403
allowlisted but unsigned internal request from VPS: venue relay HMAC error, not Nginx 403
```

Do not update backend relay URLs to the public HTTPS domain until HTTPS is live and internal allowlisting includes the backend source IP. On the VPS itself, backend envs should prefer localhost relay URLs:

```text
prod Polymarket relay: http://127.0.0.1:3003
prod Predict.fun relay: http://127.0.0.1:3004
staging Polymarket relay: http://127.0.0.1:3103
staging Predict.fun relay: http://127.0.0.1:3104
```

### Render Egress For Temporary Relay Access

If the Render backend must call the VPS relayer before the backend is fully moved to the VPS, do not remove the Nginx allowlist. Add Render's outbound source ranges or dedicated IPs to the allowlist.

Render has two relevant egress models:

```text
Default outbound IP ranges:
  Shared CIDR ranges for the service region. These are available from the service page:
  Service -> Connect -> Outbound.

Dedicated IPs:
  Render Pro+ feature. A dedicated IP set provides three fixed IPv4 addresses for a region/environment.
```

For Lotus execution relays, the safer temporary choice is Render dedicated outbound IPs. If using default shared ranges, the Nginx allowlist may need to allow a wider regional CIDR range that is shared with other Render services in the same region. That is acceptable only as a short migration bridge because relay HMAC still protects `/internal/*`, but it is not the final production shape.

Once the backend runs on the VPS, use localhost relay URLs and remove Render egress ranges from the relay allowlist.

Current Render bridge allowlist was added on 2026-05-31. Backup:

```text
/etc/nginx/render-egress-backup-20260531T122857Z/lotus-relayer.conf
```

Remove these Render CIDRs after full VPS backend cutover:

```text
74.220.49.0/24
74.220.57.0/24
```

## VPS Production API Front Door

The VPS has an Nginx production API/read proxy config:

```text
/etc/nginx/conf.d/lotus-api.conf
```

Current routing:

```text
api.uselotus.xyz -> 127.0.0.1:3000
ops.uselotus.xyz -> 127.0.0.1:3001
```

The API proxy includes WebSocket upgrade headers for backend `/ws` traffic.

Backup from first install:

```text
/etc/nginx/api-cutover-backup-20260531T123303Z
```

Pre-DNS Host-header checks that passed:

```bash
curl --noproxy '*' -H 'Host: api.uselotus.xyz' http://198.13.44.245/health
curl --noproxy '*' -H 'Host: api.uselotus.xyz' \
  'http://198.13.44.245/markets?limit=1&quoteReadyOnly=false'
curl --noproxy '*' -H 'Host: ops.uselotus.xyz' http://198.13.44.245/health
```

Expected:

```text
api health: 200
api markets: 200 with market payload
ops health: 200
```

To move production traffic, change Vercel DNS:

```text
api.uselotus.xyz A -> 198.13.44.245
ops.uselotus.xyz A -> 198.13.44.245
```

Remove the old Render CNAME records for these names before adding the A records.

After public DNS resolves to the VPS, issue HTTPS:

```bash
sudo certbot --nginx -d api.uselotus.xyz -d ops.uselotus.xyz
sudo nginx -t
sudo systemctl reload nginx
curl --noproxy '*' https://api.uselotus.xyz/health
curl --noproxy '*' https://ops.uselotus.xyz/health
curl --noproxy '*' 'https://api.uselotus.xyz/markets?limit=1&quoteReadyOnly=false'
```

Current API/read certificate state after the first VPS API TLS setup:

```text
Certificate name: api.uselotus.xyz
Domains covered:
  - api.uselotus.xyz
  - ops.uselotus.xyz
Certificate path: /etc/letsencrypt/live/api.uselotus.xyz/fullchain.pem
Private key path: /etc/letsencrypt/live/api.uselotus.xyz/privkey.pem
Expiry: 2026-08-29
Renewal: certbot.timer
```

Backup from certificate install:

```text
/etc/nginx/api-certbot-backup-20260531T123832Z
```

Post-TLS checks that passed on 2026-05-31:

```bash
curl --noproxy '*' https://api.uselotus.xyz/health
curl --noproxy '*' https://ops.uselotus.xyz/health
curl --noproxy '*' 'https://api.uselotus.xyz/markets?limit=1&quoteReadyOnly=false'
curl --noproxy '*' -i http://api.uselotus.xyz/health
curl --noproxy '*' -i http://ops.uselotus.xyz/health
```

Expected:

```text
api health over HTTPS: 200
ops health over HTTPS: 200
api markets over HTTPS: 200
HTTP api/ops: 301 redirect to HTTPS
```

### API TLS / HTTP2 Requirements

The frontend opens several API requests during login, market list load, terminal open, wallet/funding refresh, and order placement. Keep API TLS hosts HTTP/2-enabled so browser requests can multiplex over one TLS session instead of creating avoidable connection pressure.

Current Nginx requirements:

```nginx
listen 443 ssl http2;
listen [::]:443 ssl http2;
```

For the relayer IPv6 primary listener that uses `ipv6only=on`, keep the protocol options together:

```nginx
listen [::]:443 ssl http2 ipv6only=on;
```

Do not leave mixed protocol options across `api.uselotus.xyz`, `ops.uselotus.xyz`, `staging-api.uselotus.xyz`, `relayer.uselotus.xyz`, and `staging-relayer.uselotus.xyz`; Nginx will warn about redefined protocol options and the frontend may fall back to HTTP/1.1.

For normal API proxying, do not force upstream `Connection: close`. The active config uses the websocket-aware map:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' '';
}
```

Then API locations can use:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

This preserves websocket upgrades while allowing upstream keepalive for ordinary API requests.

Verification:

```bash
sudo nginx -t
sudo systemctl reload nginx
printf '' | openssl s_client -alpn h2 -connect api.uselotus.xyz:443 -servername api.uselotus.xyz 2>/dev/null | grep -i 'ALPN protocol'
printf '' | openssl s_client -alpn h2 -connect staging-api.uselotus.xyz:443 -servername staging-api.uselotus.xyz 2>/dev/null | grep -i 'ALPN protocol'
```

Expected:

```text
ALPN protocol: h2
```

Keep Render services running until the frontend has loaded markets, wallets, funding, orderbook, and at least one dry-run/preview path successfully against the VPS-backed domains.

## VPS Staging API Front Door

Staging must not share the production API host. Use a separate staging hostname that routes to the staging backend service and staging database/env bundle.

Current intended hostname:

```text
staging-api.uselotus.xyz -> 127.0.0.1:3100 on the VPS
```

VPS Nginx config:

```text
/etc/nginx/conf.d/lotus-staging-api.conf
```

Current staging service target:

```text
lotus-staging-backend.service -> 127.0.0.1:3100
```

Pre-DNS Host-header check:

```bash
curl --noproxy '*' -H 'Host: staging-api.uselotus.xyz' http://127.0.0.1/health
```

Expected:

```text
200 {"status":"ok","service":"lotus-rfq-service"}
```

DNS requirement:

```text
staging-api.uselotus.xyz A -> 198.13.44.245
```

Do not point staging frontend at `api.uselotus.xyz`; that makes staging use production API/data. After DNS points to the VPS, issue TLS:

```bash
sudo certbot --nginx -d staging-api.uselotus.xyz
sudo nginx -t
sudo systemctl reload nginx
curl --noproxy '*' https://staging-api.uselotus.xyz/health
```

Then set staging/preview frontend envs:

```text
VITE_LOTUS_API_BASE_URL=https://staging-api.uselotus.xyz
NEXT_PUBLIC_LOTUS_API_BASE_URL=https://staging-api.uselotus.xyz
```

Keep production frontend envs on:

```text
https://api.uselotus.xyz
```

## VPS Local Staging Database

The VPS has a local Postgres staging database:

```text
Postgres version: 17 (cluster 17/main, port 5432)
Database: lotus_staging
Role: lotus_staging
Staging Redis: redis://127.0.0.1:6379/1
Staging backend: localhost:3100
Staging read service: localhost:3101
Staging orderbook service: localhost:3102
```

This database is separate from production (`lotus_prod`). Both databases live in the same PostgreSQL 17 cluster at `127.0.0.1:5432`.

The staging database was migrated with all repo migrations and then populated with:

```text
global market/catalog/readiness data from production
only the approved Turnkey user account scoped to turnkey_4c25...548abf6e
```

The copy intentionally avoids a broad production user dump. User-scoped data copied for that approved account includes wallet, venue-account, funding, execution/order, signed-bundle, notification, and position rows where the table has `user_id`.

The initial staging smoke showed:

```text
canonical_events: 276
venue_market_profiles: 588
canonical_executable_markets: 591
frontend_market_approvals: 262
user_wallets for approved account: 2
user_venue_accounts for approved account: 5
```

Staging health checks:

```bash
curl http://127.0.0.1:3100/health
curl http://127.0.0.1:3101/health
curl http://127.0.0.1:3102/ready
curl 'http://127.0.0.1:3100/markets?limit=3&quoteReadyOnly=false'
```

Do not point staging at production databases. Keep `DATABASE_URL`, `SUPABASE_DB_URL`, `REDIS_URL`, ports, and `LOTUS_ENV` pointed at the staging-specific values. If staging needs live provider behavior, copy only the required provider/API env keys into `/etc/lotus/staging/*.env`.

## Orderbook Snapshot Pruning Timers

`venue_orderbook_snapshots` is a high-write time-series table. Without pruning it grows unboundedly (was 7.4 GB in staging before the first prune). Systemd timers prune rows older than 24 hours once per day.

Timer unit files (enabled and active):

```text
/etc/systemd/system/lotus-prod-prune-orderbook.timer
/etc/systemd/system/lotus-prod-prune-orderbook.service

/etc/systemd/system/lotus-staging-prune-orderbook.timer
/etc/systemd/system/lotus-staging-prune-orderbook.service
```

What the service runs:

```sql
-- prod
DELETE FROM public.venue_orderbook_snapshots WHERE received_at < NOW() - INTERVAL '24 hours';

-- staging (identical, targets lotus_staging)
```

Timer schedule:

```text
prod:    OnCalendar=daily, RandomizedDelaySec=600   (fires near 00:00 UTC ± 10 min)
staging: OnCalendar=daily, RandomizedDelaySec=1200  (fires near 00:00 UTC ± 20 min, offset from prod)
```

Check timer status:

```bash
sudo systemctl status lotus-prod-prune-orderbook.timer
sudo systemctl status lotus-staging-prune-orderbook.timer
```

Run a prune immediately (e.g. after a large backlog):

```bash
sudo systemctl start lotus-prod-prune-orderbook.service
sudo systemctl start lotus-staging-prune-orderbook.service
```

After a large bulk delete, reclaim disk space with:

```bash
sudo -u postgres psql -d lotus_prod -c "VACUUM ANALYZE public.venue_orderbook_snapshots;"
sudo -u postgres psql -d lotus_staging -c "VACUUM FULL ANALYZE public.venue_orderbook_snapshots;"
```

Use `VACUUM FULL` only on staging (it locks the table briefly). On prod, plain `VACUUM ANALYZE` is safer during active writes.

---

## DB Retention And Compaction

Lotus keeps live market state in latest/hot paths and keeps detailed history for debugging. The DB retention job reduces old noisy history without changing execution authority.

The policy is:

```text
venue_orderbook_latest_snapshots: never pruned by retention job
venue_orderbook_snapshots: keep detailed recent rows, compact older rows into hourly buckets
venue_orderbook_snapshot_hourly_compactions: durable hourly chart/debug history
funding_audit_events: remove exact old duplicates only
funding_reconciliation_records: remove old successful ready rows only after keeping recent rows per leg
failures/unresolved rows: preserved
```

Run report-only first:

```bash
npm run report:db:hygiene
npm run db:retention:compact
```

Apply only after reading `artifacts/db/db-retention-compaction-summary.md`:

```bash
npm run db:retention:compact -- --apply
```

Useful bounded options:

```bash
npm run db:retention:compact -- --orderbook-detail-days=14 --batch-limit=50000
npm run db:retention:compact -- --funding-audit-duplicate-days=7
npm run db:retention:compact -- --funding-reconciliation-success-days=60 --funding-reconciliation-keep-per-leg=3
```

Production rule:

```text
Run on VPS/local staging first.
Confirm app health and market/funding pages.
Only then run against production Supabase.
Never run --apply if the target printed in the artifact is not the intended DB.
```

## API And Worker Service Split

Production traffic must not share a Node process with long-running watchers. The API process should serve frontend/API requests only. Background work runs in the worker service.

API service:

```text
LOTUS_SERVICE_MODE=api
```

Worker service:

```text
LOTUS_SERVICE_MODE=worker
```

The worker owns:

```text
funding readiness watcher
funding intent cleanup watcher
market orderbook recorder
market catalog/readiness snapshot materializer
execution status watcher
execution order refresher
future market/readiness/materialized snapshot builders
```

The API owns:

```text
HTTP API routes
WebSocket gateway
auth/session routes
quote/preview/place/signature request handling
health and metrics
```

Do not run worker jobs inside the production API service. If the worker is down, the API should remain up and return explicit stale/resyncing/unavailable states from existing hot snapshots rather than crashing or rebuilding everything live.

Linux start commands:

```bash
npm run start
npm run start:worker-service
```

Use separate systemd units for production API and production worker. Use separate units again for staging API and staging worker. Do not reuse a prod env file for staging.

## VPS-Local PostgreSQL 17

Both production and staging databases now run on the VPS itself. The Supabase-hosted database was fully migrated on 2026-06-06.

### Cluster

```text
PostgreSQL version: 17 (cluster 17/main)
Port: 5432
Data directory: /var/lib/postgresql/17/main
Log: /var/log/postgresql/postgresql-17-main.log
```

Manage:

```bash
sudo pg_ctlcluster 17 main status
sudo pg_ctlcluster 17 main restart
sudo pg_ctlcluster 17 main reload
pg_lsclusters
```

### Databases and roles

```text
Database: lotus_prod   — owner: lotus_prod
Database: lotus_staging — owner: lotus_staging
```

The `postgres` superuser is used only for admin tasks (create extension, vacuumdb, pg_dump). Service env files use the least-privilege role for each database.

### Tuning (applied 2026-06-06)

```text
shared_buffers              = 512MB  (was default 128MB)
effective_cache_size        = 2GB
work_mem                    = 8MB
wal_buffers                 = 16MB
random_page_cost            = 1.1
checkpoint_completion_target = 0.9
```

Config file: `/etc/postgresql/17/main/postgresql.conf`

Backup before tuning: `/etc/postgresql/17/main/postgresql.conf.backup-before-tuning-*`

`shared_buffers` requires a cluster restart; `work_mem`, `effective_cache_size`, and `checkpoint_completion_target` take effect on reload.

### Production DB Guardrail (removed)

The runtime check `validateDatabaseTargetSafety()` previously rejected any production boot where `DATABASE_URL` pointed at localhost or a non-Supabase host. That guard was removed in commit `9653640` after the database migration made VPS-local Postgres the authoritative source.

The separation guarantee is now enforced by database credentials and database names, not by hostname checks:

```text
Prod services   → DATABASE_URL → lotus_prod   (user: lotus_prod, port 5432)
Staging services → DATABASE_URL → lotus_staging (user: lotus_staging, port 5432)
```

Do not point staging service envs at `lotus_prod`. Do not point prod service envs at `lotus_staging`.

### Venue orderbook snapshots tables

The `venue_orderbook_snapshots` and `venue_orderbook_snapshot_hourly_compactions` tables were excluded from the initial Supabase dump because they rebuild from live stream data. These tables were manually created in `lotus_prod` on 2026-06-06 using the schema from `lotus_staging`:

```sql
-- already applied; do not re-run unless recreating lotus_prod from scratch
CREATE TABLE public.venue_orderbook_snapshots ( ... );
CREATE TABLE public.venue_orderbook_snapshot_hourly_compactions ( ... );
```

If you ever restore `lotus_prod` from a bare migration run (no dump), create these tables before starting the worker service, or the recorder will fail.

### Backup and restore

Full cluster dump (excluding bulk snapshot tables):

```bash
sudo -u postgres pg_dump -d lotus_prod \
  --exclude-table=public.venue_orderbook_snapshots \
  --exclude-table=public.venue_orderbook_snapshot_hourly_compactions \
  -Fc -f /tmp/lotus_prod_dump.dump
```

Restore to a fresh database:

```bash
sudo -u postgres pg_restore -d lotus_prod --no-owner --role=lotus_prod \
  -j 4 /tmp/lotus_prod_dump.dump
```

Remove dump file after restore:

```bash
rm /tmp/lotus_prod_dump.dump
```

## Market Snapshot Stability Rule

The market grid must not be poisoned by an empty quote-ready cache result.

If Redis contains an empty cached response for:

```text
/markets?quoteReadyOnly=true
```

the API ignores it and rebuilds from repository/readiness data. This prevents one bad readiness timeout from making the frontend show `0` markets until the cache expires.

Long-term production behavior should be:

```text
worker builds market/readiness snapshots
API reads Redis/materialized latest snapshots
API falls back to last-known display snapshots
fresh preview/execution still revalidates live gates
```

The worker prebuilds these common quote-ready market keys:

```text
/markets?limit=80&quoteReadyOnly=true
/markets?limit=80&quoteReadyOnly=true&routeCoverage=all
/markets?limit=80&quoteReadyOnly=true&routeCoverage=pair
/markets?limit=80&quoteReadyOnly=true&routeCoverage=tri
/markets?limit=80&quoteReadyOnly=true&routeCoverage=strict_all
/markets?limit=250&quoteReadyOnly=true
/markets?limit=250&quoteReadyOnly=true&routeCoverage=all
/markets?limit=250&quoteReadyOnly=true&routeCoverage=pair
/markets?limit=250&quoteReadyOnly=true&routeCoverage=tri
/markets?limit=250&quoteReadyOnly=true&routeCoverage=strict_all
```

The materializer intentionally skips writing an empty quote-ready snapshot. Empty quote-ready results should come from a real current DB/readiness state, not from a poisoned Redis snapshot.
