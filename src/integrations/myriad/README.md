# Myriad Historical Extraction And Simulation Intake

This module now implements the Myriad extraction and historical-ingestion surface for Lotus simulation readiness.

## Official Sources Used

- Myriad API reference: `https://docs.myriad.markets/builders/myriad-api-reference`
- Myriad CLI repo: `https://github.com/MyriadProtocol/myriad-cli`

## REST Endpoints Used

- `GET /questions`
- `GET /questions/:id`
- `GET /markets`
- `GET /markets/:id`
- `GET /markets/:id/events`

No unsupported historical endpoints are invented.
No write or trading endpoints are used.

## Pagination

Myriad list endpoints use:

- `page`
- `limit`

with:

- default `limit = 20`
- max `limit = 100`

The crawlers in this module always:

- clamp `limit` to `100`
- keep fetching while `pagination.hasNext === true`
- return deterministically sorted output after crawl completion

## Normalization

The extraction surface is split into:

- `myriad-client.ts`
  - transport
  - auth header injection
  - retry / backoff
  - rate-limit handling
  - endpoint construction
- `myriad-schemas.ts`
  - all external payload validation
  - exported normalized types
- crawler / enricher / backfill modules
  - paginated question discovery
  - paginated market discovery
  - market detail enrichment
  - event-history backfill
- `myriad-topic-normalizer.ts`
  - derived Lotus category tagging
- `myriad-phase4-shortlist.ts`
  - candidate building and shortlist generation
- `myriad-cli-validation.ts`
  - safe read-only CLI spot checks

All external responses are validated with Zod before normalization.

## Question vs Market Layer

Myriad `questions` are treated as the canonical proposition hint layer.

Myriad `markets` are treated as the execution / venue market layer.

This module does not move Lotus canonical logic into the adapter layer. It emits normalized question and market records that the canonical graph can persist and project authoritatively.

## Shortlist Logic

The shortlist generator favors markets that are:

- open or resolved
- non-voided
- liquid
- high-volume
- clearly tagged
- simple binary where possible
- have usable event history
- have usable price history
- have resolution metadata

It emits:

- `highLiquidity`
- `categoryBalanced`
- `recentlyResolved`

## Simulation Readiness Flags

Each generated `MyriadPhase4Candidate` includes:

- `hasQuestionGrouping`
- `hasResolutionMetadata`
- `hasOutcomeMetadata`
- `hasUsablePriceHistory`
- `hasUsableEventHistory`
- `likelyGoodForReplay`
- `likelyGoodForCanaryShadowTesting`

## Data Gaps vs Other Venues

Compared with the existing Predexon and Limitless extraction surfaces:

- Myriad documents `price_charts` inside market detail, not as a standalone historical candles endpoint
- Myriad event history is action-oriented and market-scoped
- This module does not assume standalone orderbook history or venue-level quote depth
- Resolution metadata exists at market detail level, but later canonical pairing and risk eligibility still belong above this extraction layer

## Feeding Lotus Historical Simulation

Recommended flow:

1. crawl `questions`
2. crawl `markets` with Phase 4 filters
3. enrich shortlisted markets with `GET /markets/:id`
4. backfill `GET /markets/:id/events`
5. convert price-chart and event history into conservative historical state fragments
6. pass those normalized records upward into:
   - canonical graph persistence
   - executable-market projection
   - historical simulation intake

## Current Ingestion And Replay Rules

The implemented Myriad path is intentionally conservative:

- `questions` are proposition hints only
- `markets` are execution entities
- `price_charts` provide historical price evidence
- `/markets/:id/events` provides historical activity evidence
- historical best bid, best ask, spread, orderbook snapshots, and trade tape are not invented

Operational implication:

- Myriad is currently enabled as `MYRIAD_ONLY`
- pair and tri-venue Myriad routing remain blocked until exact compatibility edges are curated
- historical fill modeling must stay evidence-bounded and AMM-style conservative

Manual ingest entrypoint:

```bash
npm run ingest:myriad -- --mode=backfill --category=crypto --batchSize=20
```
