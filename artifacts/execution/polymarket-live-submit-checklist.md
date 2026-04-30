# Polymarket Live Submit Harness Checklist

This harness is operator-controlled and is not part of normal CI or startup flow.

## Required Operator Env

- `POLYMARKET_EXECUTION_MODE=v2`
- `POLYMARKET_LIVE_EXECUTION_ENABLED=true`
- `POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED=true`
- `POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM=I_UNDERSTAND_THIS_PLACES_A_REAL_POLYMARKET_ORDER`
- `POLYMARKET_LIVE_SUBMIT_MAINNET_ACK=true` if `POLYMARKET_CHAIN_ID=137`
- `POLYMARKET_LIVE_SUBMIT_VENUE_MARKET_ID=<condition-or-market-id>`
- `POLYMARKET_LIVE_SUBMIT_VENUE_OUTCOME_ID=<token-id>`
- `POLYMARKET_LIVE_SUBMIT_SIDE=buy|sell`
- `POLYMARKET_LIVE_SUBMIT_SIZE=<small-positive-size>`
- `POLYMARKET_LIVE_SUBMIT_PRICE=<0-to-1-limit-price>`
- `POLYMARKET_LIVE_SUBMIT_MAX_SIZE=<safety-cap>`

## Current Result

- Mode: LIVE_SUBMIT_READY
- Submitted: true
- Error: none
- Blockers: none
- Warnings: Polygon mainnet detected; use the smallest possible operator-approved order.

Secrets are intentionally omitted from this artifact.
