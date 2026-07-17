# R6 Repository Manifest

| Artifact | Binding |
| --- | --- |
| R2 RPC proposal | `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql` SHA-256 `10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb` |
| R4 runtime | commit lineage `96812e99006e99599d23ec544bcce9e224dd328e` |
| R5L Worker proof | `run-operational-guardrails-r5l-http-suite.mjs`, closure commit `1443c6a7faeb388f206b96cef9e9750fa82a65cc` |
| R6 packet | `operational-guardrails-r6-production-rollout.md` |
| R6 preflight | `operational-guardrails-r6-production-preflight.sql` SHA-256 `ee809d751a3fdd1f906116316e0b9deeb7c9321138ec69b9ec84ef9dfd877736` |
| R6 postflight | `operational-guardrails-r6-production-postflight.sql` SHA-256 `e7082fe8e25dd13a454c3b8a41aff5ded2aba4e8f499bd2afe5999222feb857e` |
| R6 execution instructions | `operational-guardrails-r6-production-rpc-execution.sql` |
| R6 single-result validator | `scripts/validate-operational-guardrails-r6-single-result.mjs` |
| R6 connector emulation | `scripts/test-operational-guardrails-r6-single-result-packets.mjs` |
| R6 schema-aware capture | `scripts/capture-operational-guardrails-r6-single-result.mjs` and `scripts/test-operational-guardrails-r6-schema-aware-capture.mjs` |
| R6 envelope structure recorder | `scripts/record-operational-guardrails-r6-envelope-structure.mjs` and `scripts/test-operational-guardrails-r6-envelope-structure.mjs` |
| R6 envelope bridge | `scripts/capture-operational-guardrails-r6-envelope-structure.mjs` and `scripts/test-operational-guardrails-r6-envelope-bridge.mjs` |
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
