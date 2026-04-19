# Scripts Layout

`scripts/` is now grouped by execution intent.

- `scripts/reports/`: report runners only
- `scripts/sync/`: current-state and graph synchronization entrypoints
- `scripts/ingest/`: acquisition, ingestion, and recorder entrypoints
- `scripts/backfill/`: historical recovery and backfill entrypoints
- `scripts/batch/`: batch orchestration and operator passes
- `scripts/db/`: schema, migration, and local seed utilities
- `scripts/stress/`: stress and chaos programs
- `scripts/dev/`: local diagnostics, previews, verification, and one-off helpers

Rules:

- report builders stay in `src/reports/`
- script files are executable entrypoints only
- package script names remain stable even when file locations change
- new scripts should not be added to the root `scripts/` directory unless they are category READMEs

Migration rule:

- any migration that depends on an existing table must either sort after that base `CREATE TABLE` migration in the repo's ordered migration runner or guard on `to_regclass(...)` so it is safe on a fresh empty database
