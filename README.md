# Lotus RFQ Service

Lotus RFQ Service is the backend for cross-venue prediction-market quoting,
routing, execution readiness, signed order relay, funding readiness, and live
execution status tracking.

## Production Surface

- Fastify API service with Redis-backed WebSocket updates.
- Postgres-backed shared core for approved canonical markets and venue mappings.
- Venue integrations for quote sourcing, readiness checks, and execution relay.
- Conservative live-submit gating: routes fail closed when quote, readiness,
  balance, allowance, settlement, or venue evidence is incomplete.
- Persistent signed-bundle execution records and verified position accounting.

## Repository Layout

- `src/` - API, execution system, integrations, routing, persistence, and workers.
- `sql/migrations/` - production database migrations.
- `scripts/` - admin, sync, smoke, report, and operational scripts.
- `tests/` and `test/` - unit and integration coverage.
- `docs/` - architecture, API, delivery, runbook, and security documentation.
- `.github/workflows/` - CI checks.

Generated evidence, local JWTs, smoke artifacts, temp files, and session notes
are intentionally local-only and ignored by Git.

## Local Checks

```bash
npm install
npm run build
npm run test:execution-system
```

## Configuration

Use `.env.example` as the public configuration template. Real `.env` files,
secrets, generated artifacts, and local operator evidence must not be committed.

## License

This repository is proprietary and unlicensed for public reuse. See `LICENSE`.
