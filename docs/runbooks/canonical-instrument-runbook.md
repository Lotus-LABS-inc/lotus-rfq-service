# Canonical Instrument Layer Runbook

This runbook covers the canonical instrument dependency used by RFQ creation, validation, routing, and combo construction.

Postgres remains authoritative for persisted RFQ state. The canonical instrument layer is an external dependency used to validate and normalize market identity before state is committed.

## Scope

Primary components:
- `src/core/rfq-engine/canonical-market-client.ts`
- `src/core/rfq-engine/create-rfq-service.ts`
- `src/api/routes/rfq.ts`
- `src/api/server.ts`

## Inspect Canonical Dependency Health

Check service health first:

```bash
curl -X GET "http://localhost:3000/health"
curl -X GET "http://localhost:3000/metrics"
```

Look for:
- sustained increase in `rfq_created_total` with simultaneous increase in `execution_failure_total`
- unexpected drop in `quote_received_total`
- `active_rfq_sessions` growth with low downstream progress

## Verify Canonical Market Resolution

When an RFQ appears malformed or unexpectedly rejected:
1. inspect the RFQ payload submitted to `POST /rfqs`
2. confirm `canonicalMarketId` was present and non-empty
3. trace the request through:
   - `src/api/routes/rfq.ts`
   - `src/core/rfq-engine/create-rfq-service.ts`
   - `src/core/rfq-engine/canonical-market-client.ts`
4. confirm the canonical lookup target configured in `src/api/server.ts`

If lookup fails, treat the canonical layer as unavailable and fail closed. Do not substitute market identifiers locally.

## Inspect Persisted RFQ Sessions

Use Postgres to confirm that only canonical-market-backed sessions were persisted:

```sql
SELECT id, taker_id, canonical_market_id, side, quantity, state, created_at
FROM rfq_sessions
ORDER BY created_at DESC
LIMIT 20;
```

Expected:
- `canonical_market_id` populated
- session states consistent with the RFQ lifecycle state machine

## Canonical Failure Procedure

Use this when the canonical dependency is timing out, returning malformed payloads, or rejecting valid instruments.

1. Confirm the issue is upstream and not local request validation.
2. Check recent RFQ creation failures in application logs.
3. Correlate with:
   - `rfq_created_total`
   - `execution_failure_total`
   - `active_rfq_sessions`
4. Stop treating new requests as executable until canonical resolution is healthy.
5. Keep the service fail-closed. Do not bypass canonical validation.

## Rollback / Safe Mode

If canonical resolution is degraded:
1. stop accepting affected RFQ creation traffic at the edge if possible
2. do not patch market IDs manually
3. preserve logs and sample payloads for incident review
4. notify routing and risk operators because both layers depend on canonical identity

## Post-Incident Checklist

- confirm canonical resolution is healthy again
- verify new RFQs persist with correct `canonical_market_id`
- inspect recent `rfq_sessions`
- inspect `rfq_created_total`, `quote_received_total`, `execution_failure_total`
- validate no temporary bypass or local mapping logic was introduced
- capture incident timestamps and affected payload samples
