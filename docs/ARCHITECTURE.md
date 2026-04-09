# Lotus RFQ Architecture Map

This document explains the architecture that current cleanup work must preserve.

`rules.md` holds the enforceable constraints.
This file is the developer-facing map for where code and artifacts belong.

## Core Runtime

- `src/core/`
  - primary runtime domain logic
  - RFQ engine, SOR, routing, risk, state machines, execution-domain logic
- `src/api/`
  - transport and registration only
  - HTTP routes, auth, schemas, websocket registration, composition/wiring
- `src/integrations/`
  - venue and external-system adapters only
- `src/repositories/`
  - persistence adapters only

## Control Plane And Evidence

- `src/rollout/`
  - pair-route rollout policy and readiness logic
- `src/qualification/`
  - qualification logic and route readiness classification
- `src/shadow/`
  - shadow evidence capture, aggregation, and supporting runtime hooks
- `src/reports/`
  - deterministic JSON/MD artifact builders
- `src/operations/`
  - operational programs and reusable sync/backfill/batch helpers
- `src/simulation/`
  - simulation engines, baselines, and simulation-only support code

## Product Frontier Positioning

- Crypto is the current narrow production frontier.
  - pair-first only
  - exact-safe only
  - fail-closed
  - no tri dependency by default
- Sports and esports are not a broad rollout frontier.
  - they sit on a fixture-backed supply and discovery track
  - absence/presence of venue overlap must be proven explicitly

## Repo Layout Expectations

- `docs/`
  - human-facing docs live here
  - design/runbooks/alerts/delivery docs belong in their own subfolders
  - generated markdown reports belong under `docs/generated/<category>/`
  - the top-level `docs/` folder should stay small and human-oriented
- `artifacts/`
  - canonical machine-readable JSON artifact tree
  - split by category first: `crypto`, `sports`, `politics`, `shared`
  - split by artifact weight second: `core` and `optional`
  - `core` is the small operator-facing set
  - `optional` is audits, diagnostics, deltas, and other deep evidence outputs
  - no loose JSON files should sit directly at the `artifacts/` root
  - legacy `docs/*.json` files may remain as compatibility mirrors while readers are migrated
- `scripts/`
  - executable entrypoints are grouped by intent
  - `scripts/reports/`, `scripts/sync/`, `scripts/ingest/`, `scripts/backfill/`, `scripts/batch/`, `scripts/db/`, `scripts/stress/`, and `scripts/dev/` are the canonical homes
  - new root-level script files should be avoided
- `tests/`
  - one top-level test tree is the target end-state
  - long-term split ownership between `test/` and `tests/` is not desired

## Current Cleanup Direction

The intended cleanup sequence is:

1. codify architecture in `rules.md`
2. maintain this architecture map
3. separate human docs from generated artifacts
   - markdown stays in `docs/`
   - canonical JSON artifacts belong in `artifacts/<category>/<core|optional>/`
4. group scripts by intent
5. converge to one top-level test tree
6. move report-builder logic into `src/reports/` where misplaced
7. split oversized composition roots without changing runtime behavior

This is a structure-preservation effort, not a redesign effort.
