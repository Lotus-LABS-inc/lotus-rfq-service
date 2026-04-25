# Execution System v0 Operator Summary

Generated: 2026-04-25T00:00:00.000Z

## Authority

- Matcher/readiness evidence is not executable authority.
- Only operator-approved sandbox or limited-prod lanes can execute.
- Execution-scope tokens are required for market-lane execution.

## Safety Posture

- Live venue submission fails closed unless a venue adapter is explicitly configured.
- Polymarket V2 adapter status is now visible through `GET /admin/execution-venues/POLYMARKET`.
- Polymarket can be structurally ready while operationally blocked by venue auth or endpoint state.
- The latest guarded harness result is read from `artifacts/execution/polymarket-live-submit-checklist.json`.
- `/admin/execution-venues` is read-only and does not enable live submission.
- Polymarket credentials remain server-side only and are not returned in readiness, status, metadata, receipts, or harness summaries.
- Accounting updates only after settlement/finality verification.
- Polymarket ghost-fill protection hooks are present for protected modes.
- Fallback can only use approved fallback scope; otherwise execution fails closed.

## Venue Readiness Admin Surface

- `GET /admin/execution-venues` lists execution adapter readiness.
- `GET /admin/execution-venues/POLYMARKET` returns the Polymarket V2 adapter readiness detail.
- `NOT_CONFIGURED` means required adapter config is missing or the V2 feature flag is not selected.
- `LIVE_DISABLED` means dry-run may be configured but live submission is disabled.
- `STRUCTURALLY_READY` means local adapter/env structure is present.
- `EXTERNALLY_BLOCKED` means local structure is ready, but the latest guarded harness attempt was blocked by venue auth or endpoint state.
- Readiness inspection is not executable authority; approved lanes, scope tokens, preflight, settlement verification, and ghost-fill protection remain mandatory.

## Remaining Blockers

- Configure real venue execution clients before live venue submission.
- Resolve external Polymarket V2 auth/endpoint readiness before enabling live Polymarket execution.
- Keep `POLYMARKET_LIVE_EXECUTION_ENABLED=false` unless credentials, builder code, settlement proof, harness checklist, and operator signoff are complete.
- Expand dedicated execution tables only after v0 metadata shape stabilizes.
