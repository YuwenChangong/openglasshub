# R6 Repository Manifest

| Artifact | Binding |
| --- | --- |
| R2 RPC proposal | `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql` SHA-256 `10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb` |
| R4 runtime | commit lineage `96812e99006e99599d23ec544bcce9e224dd328e` |
| R5L Worker proof | `run-operational-guardrails-r5l-http-suite.mjs`, closure commit `1443c6a7faeb388f206b96cef9e9750fa82a65cc` |
| R6 packet | `operational-guardrails-r6-production-rollout.md` |
| R6 preflight | `operational-guardrails-r6-production-preflight.sql` SHA-256 `df458bb5fd4534d010d3a51bce8fac413a3ed1c5ecf2c3d0c44d081522eac6d4` |
| R6 postflight | `operational-guardrails-r6-production-postflight.sql` SHA-256 `1d434113ac62458936715022f4cb88fefe441db82d9c1c7e9258168f5ffabdb1` |
| R6 execution instructions | `operational-guardrails-r6-production-rpc-execution.sql` |
| R6 single-result validator | `scripts/validate-operational-guardrails-r6-single-result.mjs` |
| R6 connector emulation | `scripts/test-operational-guardrails-r6-single-result-packets.mjs` |
| R7 Stage C | `operational-guardrails-r7-stage-c-{preflight,policy-cleanup,postflight,rollback}.sql` |

This manifest contains no secret values, cloud target identifiers, or exported
production evidence. It is a repository linkage record only.

The R6-2 and R6-6 packet hashes are updated only after their offline
single-result validator and connector-emulation tests pass. The redacted
preflight capture is operator-held and never committed; it is the required
baseline for the postflight policy, index, and grant fingerprint comparison.
