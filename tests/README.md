# Test Layout

The target end-state is one top-level test tree rooted at `tests/`.

Preferred structure:

- `tests/unit/`
- `tests/integration/`
- `tests/helpers/`
- `tests/support/`
- `tests/benchmarks/`

Current repo state still contains both `test/` and `tests/`.
Future cleanup should consolidate into `tests/` and keep command behavior stable while paths are migrated.
