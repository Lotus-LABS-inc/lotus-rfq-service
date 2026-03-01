# Risk Engine Runbook

This runbook outlines operational procedures for the Pre-Trade Risk & Exposure Engine in Lotus RFQ.

## 1. How to Inspect Exposure via SQL

To inspect authoritative exposure for a user directly from the Postgres database, run:

```sql
SELECT 
    id, user_id, canonical_market_id, side, gross_notional, net_notional, version, last_updated 
FROM exposure 
WHERE user_id = 'user-uuid' AND canonical_market_id = 'market-id';
```

**Expected Output:**
```
id              | user_id   | canonical_market_id | side | gross_notional | net_notional | version | last_updated
----------------+-----------+---------------------+------+----------------+--------------+---------+----------------------------
uuid-1234       | user-uuid | market-id           | buy  | 1000.00        | 0.00         | 5       | 2026-03-01 12:00:00.000+00
```

To view the recent history of exposure changes (journal):

```sql
SELECT 
    change, prev_gross, new_gross, source, reference_id, created_at
FROM exposure_journal
WHERE exposure_id = 'uuid-1234'
ORDER BY created_at DESC
LIMIT 10;
```

## 2. How to Inspect via Admin API

You can compare authoritative (Postgres) and rolling (Redis) exposure using the admin API.

**Command:**
```bash
curl -X GET "http://localhost:3000/admin/risk/exposure?userId=user-uuid&marketId=market-id&side=buy" \
     -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

**Expected Output:**
```json
{
  "postgres": {
    "gross": "1000.00",
    "net": "0.00"
  },
  "redis": {
    "rolling_gross": 1000
  },
  "status": "in_sync"
}
```

## 3. How to Clear Stuck Reservation

If an RFQ execution fails ungracefully and the risk lock isn't released, Takers may be blocked from further executions for up to 5 seconds. To clear a stuck lock immediately:

**Command:**
```bash
curl -X POST "http://localhost:3000/admin/risk/clear-reservation" \
     -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "reservationId": "rfq-session-uuid"
     }'
```

**Expected Output:**
```json
{
  "status": "success",
  "cleared": true
}
```

## 4. How to Run Reconciliation Manually

To manually run the reconciliation job and audit Redis rolling exposure against Postgres:

**Command:**
```bash
npx tsx scripts/reconcile-exposure.sh
```

**To enforce auto-fixing of discrepancies:**
```bash
RISK_AUTO_FIX=true npx tsx scripts/reconcile-exposure.sh
```

**Expected Output:**
```
Starting exposure reconciliation...
Found 100 exposure records to verify.
Verified 100 records. Mismatches: 0. Fixed: 0.
Reconciliation complete.
```

## 5. Emergency Kill-Switch Steps

If the risk engine is behaving erratically or blocking valid trading activity system-wide, use the following Redis commands to bypass validation temporarily.

**Set Risk Engine Kill-Switch:**
```bash
redis-cli set risk:kill_switch "true"
```
*(Bypasses quota checks and exposure updates)*

**Set Global RFQ Kill-Switch (Pauses all RFQs):**
```bash
redis-cli set rfq:kill_switch "true"
```
*(Pauses the entire RFQ system if risk issues cause broader platform instability)*

## 6. Post-Incident Checklist

After resolving a risk engine or exposure issue, ensure the following steps are completed:

- [ ] **Run Reconcile**: Execute `RISK_AUTO_FIX=true npx tsx scripts/reconcile-exposure.sh` to ensure Redis state matches Postgres.
- [ ] **Verify Journal Integrity**: Query `exposure_journal` to ensure no orphaned `pre-exec-reserve` entries without matching `execution-success` or `execution-failure` entries limit exhaustion.
- [ ] **Check Metrics**: Review Prometheus metrics (`risk_reconcile_mismatches_total`, `risk_internal_errors_total`) in Grafana to ensure system stability has returned to normal.
- [ ] **Notify Stakeholders**: Inform the Risk Team and impacted LPs/Takers that exposure tracking is fully restored and accurate.
