# Artifact Layout

JSON artifacts now have a canonical home under:

- `artifacts/crypto/core`
- `artifacts/crypto/optional`
- `artifacts/sports/core`
- `artifacts/sports/optional`
- `artifacts/politics/core`
- `artifacts/politics/optional`
- `artifacts/shared/core`
- `artifacts/shared/optional`

Rules:

1. Core folders keep the small operator-facing artifact set for each domain.
2. Optional folders keep audits, diagnostics, deltas, debug outputs, and other deep evidence artifacts.
3. No loose JSON files should live directly under `artifacts/`; only category folders and this README belong at the top level.
4. `docs/*.json` may still exist as legacy compatibility mirrors while older readers are migrated.
5. New JSON artifact writers should go through the shared artifact helper so the canonical `artifacts/` copy is always written.
