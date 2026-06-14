# Market Discovery Prod Rollout Plan

Status: planning only. Do not execute against production without explicit operator approval.

## Current State

- Cross-venue market discovery is staging-only.
- Staging contains discovery commits `46e0918`, `2627727`, and `6f245b9`.
- `main` / prod may not contain `src/market-discovery`.
- `lotus_prod` may not contain the discovery tables.
- Enabling the upstream collector in prod will call venue APIs from the prod backend.

## Preconditions

- Confirm staging is healthy after `npm run typecheck` and `npx vitest run test/unit/market-discovery-clustering.test.ts --maxWorkers=1`.
- Confirm prod backend, staging backend, Redis namespaces, DB URLs, and domains are separated.
- Keep scheduled discovery disabled in prod for the first rollout.
- Confirm no discovered market is user-facing or executable until admin approval and normal market-matching promotion gates pass.

## Code Rollout

1. Start from a clean `main`.
2. Cherry-pick discovery commits in order:
   - `46e0918`
   - `2627727`
   - `6f245b9`
3. Cherry-pick the lifecycle, archive, and scheduler commit after it passes staging.
4. Run:
   - `npm run typecheck`
   - `npx vitest run test/unit/market-discovery-clustering.test.ts --maxWorkers=1`
5. Deploy backend with discovery scheduler still disabled for prod.

## Prod SQL Migrations

Apply to `lotus_prod` in this order only after a read-only schema check confirms they are missing:

1. `sql/migrations/2026_06_13_create_market_discovery_candidates.sql`
2. `sql/migrations/2026_06_13_extend_market_discovery_v2.sql`
3. Any later discovery lifecycle/archive migration if one is added.

The current lifecycle/archive implementation derives `CLOSED` from `canonical_events.resolves_at` and uses existing discovery tables, so no extra migration is required for the scheduler or archive endpoints.

## First Prod Verification

1. Verify API health.
2. Verify admin auth and market matching routes.
3. Run read-only discovery archive preview only:
   - `GET /admin/market-matching/discovery/archive/preview?retentionDays=7`
4. Do not run discovery collection in prod until explicitly approved.
5. When approved, run one manual discovery pass from admin and inspect:
   - upstream row counts by venue;
   - `NEW_DISCOVERY`, `MERGE_SUGGESTION`, `ENRICHMENT_ONLY`, and `LOW_CONFIDENCE` counts;
   - candidate details and topic bundles;
   - venue API rate-limit/error behavior.
6. Keep auto-scheduler disabled until manual prod discovery is stable.

## Safety Notes

- Discovery candidates are admin-review-only.
- `NEW_DISCOVERY` approval creates one shared canonical event and one executable market per venue.
- Cross-venue routing still requires the existing EQUIVALENT pair/tri market-matching promotion.
- Archive apply requires admin auth, 2FA, confirmation phrase, terminal candidate state, and retention age.
- Never point prod `DATABASE_URL` or `SUPABASE_DB_URL` at staging/local DBs.
