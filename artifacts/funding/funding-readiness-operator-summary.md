# Funding Readiness Operator Summary

Generated: 2026-04-26T02:12:29.659Z

## Totals

- Funding intents: 3
- Route legs: 3
- READY_TO_TRADE rows: 3
- VENUE_CREDIT_PENDING rows: 0
- DESTINATION_NOT_CONFIRMED rows: 0
- FAILED rows: 0
- UNKNOWN rows: 0
- Split-capable intents: 0
- Partial-ready intents: 0

## Counts By Venue

- PREDICT_FUN: 1
- MYRIAD: 1
- OPINION: 1

## Counts By Readiness Status

- UNKNOWN: 0
- DESTINATION_NOT_CONFIRMED: 0
- VENUE_CREDIT_PENDING: 0
- READY_TO_TRADE: 3
- FAILED: 0

## Counts By Checker Mode

- DISABLED: 0
- STUB: 0
- LIVE_READ: 3
- NOT_CONFIGURED: 0

## Counts By Route Provider

- LIFI: 3

## Stale Age Buckets

- NEVER_CHECKED: 0
- UNDER_1H: 3
- ONE_TO_24H: 0
- ONE_TO_7D: 0
- OVER_7D: 0

## Review Needed

- Destination not confirmed: 0
- Venue credit pending: 0
- Checker disabled or not configured: 0
- Failed: 0
- Unknown/malformed: 0

## Safety Notes

- This report is read-only.
- Live LI.FI execution remains controlled by runtime flags.
- Funding preflight enforcement remains controlled by runtime flags.
- READY_TO_TRADE requires persisted venue readiness reconciliation.
- Raw LI.FI transaction internals, provider secrets, auth headers, and private keys are not included.
