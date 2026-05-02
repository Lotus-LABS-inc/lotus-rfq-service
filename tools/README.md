# Lotus Backend Tools

Backend-owned scripts live under `scripts/`.

Frontend smoke-test tools are intentionally kept outside this backend repository in the workspace sibling folder:

```text
../lotus-test-frontends
```

Current extracted tools:

- `turnkey-funding-signer`: local operator UI for user-authorized Turnkey funding and bridge-back smoke tests.
- `matching-simulator`: reserved location for the early matching simulator frontend if its source is recovered.

Do not place frontend-only dependencies, local `.env.local` files, generated `dist/` output, or `node_modules/` under this backend repo.

