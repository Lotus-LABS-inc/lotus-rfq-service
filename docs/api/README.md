# Lotus API Documentation

Status: static OpenAPI docs  
Last updated: 2026-04-25

## Where The Spec Lives

The repo-wide OpenAPI spec is:

```text
docs/api/openapi.yaml
```

This is a static documentation file. The service does not currently mount Swagger UI and the repo does not currently include an OpenAPI validation script.

## How To View It

Use Swagger Editor:

1. Open https://editor.swagger.io/
2. Paste the contents of `docs/api/openapi.yaml`
3. Review endpoints by tag

No runtime server changes are required to view the spec.

## Implemented vs Planned

Every documented endpoint uses Lotus vendor extensions:

- `x-lotus-status`: `implemented`, `planned`, `unregistered`, `stub`, `deprecated`
- `x-lotus-callable`: whether engineers should call the endpoint
- `x-lotus-auth`: `public`, `user`, `admin`, `internal`, `lp`
- `x-lotus-side-effects`: expected side effect class
- `x-lotus-danger`: `low`, `medium`, `high`, `critical`

Do not call endpoints marked `x-lotus-callable: false`.

## Auth Labels

- `public`: no route middleware in the current server.
- `user`: requires user JWT middleware.
- `admin`: requires admin JWT middleware.
- `admin-preview`: requires admin JWT, except simulation preview can allow loopback access when `DEV_SIMULATION_PREVIEW_ENABLED=true`.
- `lp`: requires LP authentication middleware.

## How Frontend Should Use This

Frontend should treat implemented callable APIs as usable contracts and planned APIs as future alignment only.

RFQ accept can start execution, but the returned execution may still fail closed if lane approval, execution-scope token, funding readiness, venue readiness, settlement, or ghost-fill checks fail.

Funding endpoints are planned only. Do not build frontend flows that call them until backend implementation exists.

## How Funding Co-Dev Should Use This

Use planned funding schemas and endpoints as shape guidance, not as existing backend behavior.

The funding implementation must still follow `docs/runbooks/funding-flow-v0-handoff.md`:

- LiFi route quote does not equal ready-to-trade.
- Venue capability matrix decides target chain/token.
- Execution preflight requires `READY_TO_TRADE`.
- Predict.fun is not PredictIt.

## Validation

OpenAPI validation command: not configured.

Current repo checks:

```bash
npm run typecheck
npm run test
```

If a validation script is added later, document it here and keep it non-mutating.
