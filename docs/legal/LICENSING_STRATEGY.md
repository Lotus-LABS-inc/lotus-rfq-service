# Lotus Licensing Strategy

## 1. Purpose

Lotus is proprietary execution infrastructure. The licensing structure protects
the core RFQ service, canonical matching, routing, execution, funding,
withdrawal, operator, protection, and monetization systems from unauthorized
copying, forking, redistribution, or commercial reuse.

## 2. Current Repo License

The current Lotus RFQ service repository is licensed as Proprietary / All Rights
Reserved. Unless a file explicitly states otherwise, all code, documentation,
configuration, scripts, tests, schemas, and assets in this repository are
proprietary.

The npm package metadata must remain private and unlicensed for public
distribution:

- `"private": true`
- `"license": "UNLICENSED"`

## 3. Component License Map

| Component | License posture |
|---|---|
| Core RFQ/backend service | Proprietary / All Rights Reserved |
| Canonical matcher/routing logic | Proprietary |
| Execution adapters | Proprietary |
| Funding/withdrawal orchestration | Proprietary |
| Admin/operator UI | Proprietary |
| Monetization logic | Proprietary |
| Ghost-fill protection and recovery logic | Proprietary |
| Future smart fee router contracts | BUSL-1.1 or source-available protective license |
| Public SDK/API clients | MIT or Apache-2.0 |
| Examples/widgets | MIT or Apache-2.0 |
| Docs/litepaper/diagrams | CC BY-NC-ND 4.0 or All Rights Reserved |
| Brand/logo/assets | All Rights Reserved + trademark later |

## 4. Why Not MIT/Apache For The Core Backend

MIT and Apache-2.0 are permissive licenses that allow copying, modification,
redistribution, and commercial reuse. That is appropriate for public SDKs,
examples, and integration clients, but not for the current core backend. The
core backend contains Lotus' market mapping, routing, execution, operations,
protection, and monetization systems, which should not be freely reused by
competitors or outside operators.

## 5. Smart Contract Licensing Plan

Future smart contracts should live in a separate package or repository with an
explicit license. The default posture should be BUSL-1.1 or a similarly
protective source-available license unless Lotus intentionally chooses a more
permissive license for a specific contract.

## 6. SDK/API Client Licensing Plan

Future public SDKs, API clients, examples, and widgets should live in separate
packages, repositories, or clearly separated folders with their own `LICENSE`
files. Those public integration surfaces may use MIT or Apache-2.0 when the goal
is adoption and easy integration.

Do not accidentally apply MIT or Apache-2.0 to the core backend. Do not
accidentally apply the core proprietary license to a future public SDK that is
intended to be open source.

## 7. Docs And Brand Licensing

Internal docs, diagrams, runbooks, and architecture notes for the core backend
are proprietary unless explicitly relicensed. Public docs, litepapers, diagrams,
and educational material may be released under CC BY-NC-ND 4.0 or All Rights
Reserved. Brand, logo, UI, and visual assets remain All Rights Reserved unless a
separate written license says otherwise.

## 8. Contributor/IP Policy

External contributions require prior written approval and a signed contributor
agreement, CLA, contractor agreement, employment agreement, or IP assignment.
Contributors must confirm they have the right to submit the work. Accepted
contributions become part of the proprietary Lotus codebase unless Lotus agrees
otherwise in writing.

## 9. Third-Party Dependency Policy

Third-party packages and dependencies remain governed by their own licenses.
Lotus must not alter, remove, or misrepresent third-party license terms.
Dependency license compatibility should be reviewed before production use,
redistribution, or public SDK packaging.

## 10. Future Open-Source Release Rules

Any future open-source release must be intentionally scoped, separated, and
licensed. A public release should include its own license file, package metadata,
README license section, and review confirming that no proprietary backend logic,
secrets, internal runbooks, market mapping strategy, execution logic, or
monetization systems are included by mistake.
