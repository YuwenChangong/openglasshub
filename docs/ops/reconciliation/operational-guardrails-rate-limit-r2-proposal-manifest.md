# W6 R2 Proposal Manifest

Status: `UNEXECUTED_REPOSITORY_DESIGN_ONLY` and
`COMPLETE_STATICALLY_VALID`.

| Artifact | Purpose | Execution status |
| --- | --- | --- |
| `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql` | Exact V1 function metadata, quota body, owner, and ACL. | Do not run. |
| `operational-guardrails-rate-limit-r2-static-postflight.sql` | Future read-only catalog identity/metadata/ACL query. | Do not run. |
| `operational-guardrails-rate-limit-r2-expected-fingerprint.md` | Source-file hash and expected catalog contract. | Static only. |
| `operational-guardrails-rate-limit-r2-proposal-review.md` | Approved quota, retry, timeout, and failure contract. | Review only. |
| `operational-guardrails-rate-limit-r3-simulation-readiness.md` | R3 local completion record. | Passed only in a disposable local database. |

The proposal creates no migration-history record, has no operator runner, and
contains no Cloudflare, Supabase, credential, plaintext-secret, policy-removal,
index, deployment, or SQL execution command. All function-relevant quota
decisions are closed. R3 passed only in a disposable local database, the
proposal remains unexecuted outside it, and Stage C remains blocked pending a
runtime migration.
