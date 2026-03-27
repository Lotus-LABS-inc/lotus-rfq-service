# Predict Phase 4 Simulation Runbook

Status: SIMULATION READY, LIVE TRADING DISABLED
Last Updated: 2026-03-27

## Scope

Predict is integrated into Lotus as:
- a market-discovery venue
- an orderbook-aware simulation venue
- a recorder-backed historical venue
- a qualification evidence source

Out of scope in this pass:
- production order submission
- custody
- Predict Account / smart-wallet flows

## Documented Predict Surfaces Used

REST:
- `GET /v1/markets`
- `GET /v1/markets/{id}`
- `GET /v1/markets/{id}/stats`
- `GET /v1/markets/{id}/last-sale`
- `GET /v1/markets/{id}/orderbook`
- `GET /v1/orders`
- `GET /v1/orders/{hash}`
- `GET /v1/orders/matches`
- `GET /v1/account`
- `GET /v1/account/activity`
- `GET /v1/positions`
- `GET /v1/positions/{address}`
- `GET /v1/auth/message`
- `POST /v1/auth`

Environments:
- BNB mainnet
- BNB testnet

## Precision Labels

- `REALIZED`
  - native historical match events exist and trade-level replay is possible
- `RECORDED_HISTORICAL`
  - Lotus recorder evidence exists for historical orderbook/match-event coverage
- `ESTIMATED_CONSERVATIVE`
  - only current orderbook and/or coarse evidence exists
- `INSUFFICIENT_DATA`
  - not enough evidence to support a defensible simulation

## Provenance Labels

- `NATIVE_PREDICT`
- `PREDExON_FALLBACK`
- `MIXED_WITH_PROVENANCE`

Rules:
- native Predict is primary
- Predexon fallback is availability-gated and fail-closed
- mixed provenance must be explicit in result metadata

## Recorder Policy

Recorder purpose:
- build Lotus-owned historical depth and match-event archives because native historical depth must not be assumed

Recorder components:
- `predict-ws-client.ts`
- `predict-orderbook-recorder.ts`
- `predict-match-event-recorder.ts`

Operational expectations:
- subscribe only to documented Predict websocket topics/request formats
- maintain deterministic event ordering
- checkpoint by environment + market
- keep mainnet and testnet archives separated

## Simulation Readiness

A Predict market is simulation-ready at the following levels:

1. `RECORDED_HISTORICAL`
- native recorder coverage exists for the requested time window
- orderbook and/or match-event evidence is available

2. `REALIZED`
- native match events exist but full depth history does not

3. `ESTIMATED_CONSERVATIVE`
- only current orderbook or coarse fallback evidence exists

4. `INSUFFICIENT_DATA`
- neither recorder evidence, realized events, nor defensible fallback exists

## Qualification And Canary Interpretation

Qualification outputs should treat Predict readiness using:
- native data quality
- recorder coverage
- fallback usage
- precision level
- environment-specific readiness

Do not treat a Predict market as high-confidence historical evidence without recorder or realized-event support.

## Future Execution Boundary

Future execution-prep is `EOA`-only:
- Lotus-managed wallet signs the Predict auth message
- Lotus exchanges that signature for Predict JWT

Deferred:
- Predict Account support
- production write paths
- custody logic
