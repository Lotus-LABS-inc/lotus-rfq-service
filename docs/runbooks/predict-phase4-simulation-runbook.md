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

## Bootstrap Paths

Current-state bootstrap:
- `npm run sync:predict:current-state -- --environment=mainnet`
- purpose:
  - populate `predict_market_metadata`
  - populate current `predict_orderbook_snapshots` when documented orderbooks are available
  - project Predict markets through canonical graph persistence
  - seed `historical_market_states` with current-state evidence only
- result:
  - Predict enters local simulation inventory as current-state evidence
  - precision remains conservative unless recorder or realized-event history exists

Live market probe:
- `npm run scan:predict:live-markets -- --environment=mainnet --maxMarkets=10 --maxPages=10`
- purpose:
  - identify currently reachable Predict market ids that actually return live orderbooks
  - feed explicit market ids into the recorder instead of guessing

Predexon fallback bootstrap:
- `npm run ingest:predict:predexon-fallback -- --environment=mainnet --marketIds=<ids> --start=<iso> --end=<iso>`
- purpose:
  - ingest documented Predexon Predict orderbook history when it actually exists
- important:
  - this is orderbook-only
  - this is YES-side-only per the documented Predexon endpoint
  - zero-row ingests are valid and must not be treated as hidden success

Predexon fallback coverage scan:
- `npm run scan:predict:predexon-fallback -- --environment=mainnet --marketIds=<ids> --start=<iso> --end=<iso>`
- purpose:
  - persist explicit fallback window evidence in `predict_fallback_coverage_scans`
  - distinguish:
    - no documented fallback rows
    - non-empty fallback-covered windows
  - keep fallback admission auditable per market/window

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
- bootstrap command:
  - `npm run record:predict:orderbooks -- --environment=mainnet --durationMs=60000 --maxMarkets=5`

Operational expectations:
- subscribe only to documented Predict websocket topics/request formats
- maintain deterministic event ordering
- checkpoint by environment + market
- keep mainnet and testnet archives separated
- if the command reports `no_recordable_predict_markets_found`, that is an honest zero-coverage result, not a hidden recorder failure
- a recorder checkpoint without historical rows means `RECORDER_ACCUMULATING`, not historical qualification

## Historical Admission Gate

Predict is not automatically admitted into cross-venue historical simulation just because it has canonical overlap.

Admission states:
- `CURRENT_STATE_ONLY`
  - current-state bootstrap exists, but there is no recorder or ingested fallback history
- `RECORDER_ACCUMULATING`
  - recorder checkpoints exist, but the requested historical window is still not backed by usable rows
- `HISTORICAL_READY_NATIVE`
  - native recorder or native realized-event evidence exists for the market/window
- `HISTORICAL_READY_FALLBACK`
  - ingested Predexon fallback snapshots exist for the market/window
- `UNUSABLE`
  - no reliable Predict evidence exists

Promotion rule:
- `PREDICT_ONLY` may remain visible as conservative current-state evidence
- `POLYMARKET_PREDICT`, `LIMITLESS_PREDICT`, and `OPINION_PREDICT` must remain blocked until the exact Predict market is historically qualified
- current-state-only Predict rows must never make pair-mode historical routes runnable by themselves
- no historical run may silently substitute current-state Predict data for a missing historical window

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
- explicit readiness state from admin canonical coverage / route availability

Do not treat a Predict market as high-confidence historical evidence without recorder or realized-event support.

## Future Execution Boundary

Future execution-prep is `EOA`-only:
- Lotus-managed wallet signs the Predict auth message
- Lotus exchanges that signature for Predict JWT

Deferred:
- Predict Account support
- production write paths
- custody logic
