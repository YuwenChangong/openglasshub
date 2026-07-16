# W6 R2 Proposal Manifest

Status: `UNEXECUTED_REPOSITORY_DESIGN_ONLY`.

| Artifact | Purpose | Execution status |
| --- | --- | --- |
| `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql` | Exact proposed function metadata, body, owner, and ACL. | Do not run. |
| `operational-guardrails-rate-limit-r2-static-postflight.sql` | Future read-only catalog identity/metadata/ACL query. | Do not run. |
| `operational-guardrails-rate-limit-r2-expected-fingerprint.md` | Source-file hash and expected catalog contract. | Static only. |
| `operational-guardrails-rate-limit-r2-proposal-review.md` | Quota matrix, failure mapping, and open decisions. | Review only. |
| `operational-guardrails-rate-limit-r3-simulation-readiness.md` | Explicit R3 preconditions. | R3 blocked. |

The proposal creates no migration-history record, has no operator runner, and
contains no Cloudflare, Supabase, credential, plaintext-secret, policy-removal,
index, or deployment command. It is complete as a static proposal and not
eligible for any execution while function-relevant quota decisions remain open.
