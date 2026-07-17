# R6 Repository Manifest

| Artifact | Binding |
| --- | --- |
| R2 RPC proposal | `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql` SHA-256 `10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb` |
| R4 runtime | commit lineage `96812e99006e99599d23ec544bcce9e224dd328e` |
| R5L Worker proof | `run-operational-guardrails-r5l-http-suite.mjs`, closure commit `1443c6a7faeb388f206b96cef9e9750fa82a65cc` |
| R6 packet | `operational-guardrails-r6-production-rollout.md` |
| R6 preflight | `operational-guardrails-r6-production-preflight.sql` SHA-256 `ee809d751a3fdd1f906116316e0b9deeb7c9321138ec69b9ec84ef9dfd877736` |
| R6 postflight | `operational-guardrails-r6-production-postflight.sql` SHA-256 `e7082fe8e25dd13a454c3b8a41aff5ded2aba4e8f499bd2afe5999222feb857e` |
| R6 compact postflight recovery | `operational-guardrails-r6-production-postflight-recovery.sql` SHA-256 `a82c692a1d3569d4fe94134c613b2382d2cb11589bbc3135c4f883ca120bd3f8` |
| R6 execution instructions | `operational-guardrails-r6-production-rpc-execution.sql` |
| R6 single-result validator | `scripts/validate-operational-guardrails-r6-single-result.mjs` |
| R6 connector emulation | `scripts/test-operational-guardrails-r6-single-result-packets.mjs` |
| R6 schema-aware capture | `scripts/capture-operational-guardrails-r6-single-result.mjs` and `scripts/test-operational-guardrails-r6-schema-aware-capture.mjs` |
| R6 envelope structure recorder | `scripts/record-operational-guardrails-r6-envelope-structure.mjs` and `scripts/test-operational-guardrails-r6-envelope-structure.mjs` |
| R6 envelope bridge | `scripts/capture-operational-guardrails-r6-envelope-structure.mjs` and `scripts/test-operational-guardrails-r6-envelope-bridge.mjs` |
| R6 compact stdin transport | `scripts/run-operational-guardrails-r6-compact-recovery-transport.mjs` and `scripts/test-operational-guardrails-r6-compact-recovery-transport.mjs` |
| R6 sealed recovery | `operational-guardrails-r6-production-postflight-recovery-sealed.sql`, `scripts/verify-operational-guardrails-r6-sealed-recovery-token.mjs`, and `scripts/test-operational-guardrails-r6-sealed-recovery.mjs` |
| R6 exact envelope fixture | `tests/fixtures/operational-guardrails-r6-exact-envelope.mjs` |
| R7 Stage C | `operational-guardrails-r7-stage-c-{preflight,policy-cleanup,postflight,rollback}.sql` |

This manifest contains no secret values, cloud target identifiers, or exported
production evidence. It is a repository linkage record only. The source-backed
resend identity correction is recorded in
`operational-guardrails-r6-resend-rpc-identity-review.md`.

R6 binding metadata is `PRODUCTION_BINDING_METADATA_READY` and the repository
consumer boundary is `R6_STAGE1_BINDING_READY`. The exact three-consumer
allowlist has no browser exposure or unapproved fourth active consumer; the
former raw legal-consent and deprecated generic factories were removed. See
`operational-guardrails-service-role-consumer-scope-reconciliation.md`.

The R6-2 and R6-6 packet hashes are updated only after their offline
single-result validator and connector-emulation tests pass. The redacted
preflight capture is operator-held and never committed; it is the required
baseline for the postflight policy, index, and grant fingerprint comparison.

Connector output must be parsed in memory as exactly one 12-column packet before
anything is written. The capture helper preserves catalog role labels such as
`service_role`, but rejects credential-shaped content, writes a canonical JSON
packet and SHA-256 sidecar atomically outside Git, then reopens and revalidates
the saved evidence. A rejected capture produces only safe error metadata.

Before an envelope-specific adapter is accepted, the separately approved
constant-only connector probe records only the response shape: keys, JSON types,
array/string lengths, candidate paths, and the fixed probe marker location. It
never records ordinary scalar values or a raw connector envelope. The structural
record is written atomically outside Git with its own SHA-256 sidecar.

The envelope bridge is Node-only. It accepts a connector response either as an
in-process object or one UTF-8 JSON payload on stdin, invokes the recorder once,
prints only a safe status summary, and rejects browser globals such as `btoa`
or `atob`, extra argv payloads, malformed UTF-8, and credential-like content.

The approved constant-only probe proved the exact connector path
`$[0].text#json.result#wrapped_json`. The single-result adapter accepts only
that fenced wrapper path plus the pre-existing direct row-array path used by
local synthetic tests.

## R6-6 recovery hold

`R6-5` was submitted exactly once. Its connector returned a success empty
result, but the once-submitted full R6-6 postflight exceeded the capture budget
before the committed bridge could persist its packet. The state is therefore
`CATALOG_STATE_UNVERIFIED_AFTER_SINGLE_MUTATION_SUBMISSION`; the operator-held
failure marker is outside Git and must not be overwritten. The original full
postflight and R2 proposal hashes above remain immutable.

The recovery packet is a single catalog-only row containing no function body,
application row, auth-user field, credential, or raw connector envelope. Its
dedicated validator compares current protected-table and resend fingerprints to
the SHA-bound operator-held R6-2 baseline. It can classify only
`COMMITTED_EXACTLY`, `NOT_COMMITTED`, `CONFLICTING_OR_PARTIAL`, or
`INSUFFICIENT_EVIDENCE`. An absent target function is evidence only; it never
authorizes a replay. Capture writes the canonical one-row packet, SHA sidecar,
and safe structure record atomically outside Git, or writes only safe failure
metadata.

The historical compact recovery rejection has only a row-count code and no
value-blind shape record. Its exact connector form is therefore unproven.
R6I adds SHA-bound structural diagnostics for future rejection but does not
normalize direct row objects or change any reviewed SQL. See
`operational-guardrails-r6-compact-recovery-capture.md`.

R6K reconciles the R6J failure-output contract repository-only. The hardened
runner now directly writes the separately approved `-failure.json` and
`-failure.sha256` paths when explicit path flags are supplied, takes connector
response only on stdin, and rejects path collisions or stale artifacts before
capture. R6J stopped before dispatch; no Production SQL occurred.

R6J2 later submitted exactly one compact, read-only recovery query. Its ad hoc
PowerShell stdin bridge failed before JSON parsing. The parser error cannot prove
a particular pipe mechanism, so the root cause remains
`TRANSPORT_ROOT_CAUSE_INSUFFICIENT`. It separately proves
`RUNNER_PREPARSE_FAILURE_EVIDENCE_DEFECT`: the old runner initialized failure
handling too late. R6L corrects that ordering repository-only and adds a
checked-in shell-free Node Buffer transport. No R6-5 replay, full postflight,
Production query, cloud action, or deployment occurred. A future recovery needs
fresh approval for `APPROVE_R6M_ONE_COMPACT_READ_ONLY_RECOVERY_EXECUTION_WITH_HARDENED_TRANSPORT`.
