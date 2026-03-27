# Predict Phase 4 Checklist

## Completed

- Predict REST client with runtime validation
- Predict market adapter
- Predict orderbook adapter
- Predict events adapter
- Predict websocket client
- Predict orderbook recorder
- Predict match-event recorder
- Predict fallback interface with fail-closed availability gate
- Predict simulation surface
- Predict size estimator
- `PREDICT_ONLY` baseline
- Predict route modes in historical simulation type surface
- Predict storage migration
- Predict env/example settings
- Predict runbook and delivery checklist

## Still Required Before Promotion

- wire documented websocket topic/request payloads for the selected recorder markets
- decide recorder deployment schedule for mainnet/testnet
- accumulate native recorder history
- add canonical/qualification bootstrap jobs for live Predict market ingestion
- add admin-console coverage panes for recorder/fallback counts if operators need direct visibility
- keep Predexon fallback disabled until a documented Predict historical surface exists in Predexon

## Hard Rules

- no undocumented endpoints
- no silent source mixing
- no production Predict trading enablement in this phase
- no Predict Account dependence in this phase
