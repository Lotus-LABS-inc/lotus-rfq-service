# Admin API Smoke

Generated: 2026-04-30T22:11:48.631Z
Status: PASSED
Base URL: https://lotus-backend-g1e1.onrender.com
Auth mode: LOGIN_KEY

| Endpoint | Status | Elapsed ms | Bytes | Secret Findings |
|---|---:|---:|---:|---|
| /admin/ops/summary | 200 | 645 | 1111 | none |
| /admin/executions | 200 | 319 | 17 | none |
| /admin/funding/summary | 200 | 317 | 747 | none |
| /admin/funding/readiness/summary | 200 | 427 | 747 | none |
| /admin/execution-venues | 200 | 250 | 830 | none |
| /admin/monetization/summary | 200 | 334 | 195 | none |
| /admin/schema-map | 200 | 1368 | 219323 | none |

## Safety

- This smoke is read-only.
- Full response payloads are not stored.
- Admin JWTs and login keys are not stored.
- Secret scanning checks sensitive key names with populated values.
