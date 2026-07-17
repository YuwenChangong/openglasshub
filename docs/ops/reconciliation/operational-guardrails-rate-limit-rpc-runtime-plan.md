# W6 Fail-Closed Runtime Migration Plan

## Current callers and target behavior

| Route | Action and purpose | Current limit | Current storage failure | Future allow/deny/error |
| --- | --- | --- | --- | --- |
| `posts.ts#POST` | Create post, `post_create` | 10/user/hour | Helper returns `allowed: true`. | `ALLOWED` continues; `RATE_LIMITED` is existing `429 RATE_LIMITED`; RPC failure is sanitized `503`. |
| `comments.ts#POST` | Create comment, `comment_create` | 60/user/hour | Helper returns `allowed: true`. | Same fail-closed mapping. |
| `circles.ts#POST` | Create circle, `circle_create` | 5/user/day | Helper returns `allowed: true`. | Same fail-closed mapping. |
| `media-upload-guard.ts#POST` | Guard media upload, `post_media_upload` | 10/shared-IP/hour, 1..157286400 bytes | Helper returns `allowed: true`. | Same fail-closed mapping with the RPC's defense-in-depth cap; a lower source-proven route cap remains authoritative. |
| `external-video-upload.ts#POST` | Sign external video upload, `external_video_upload` | 10/shared-IP/hour, 1..157286400 bytes, 314572800 accepted bytes/shared-IP/rolling 24h | Helper returns `allowed: true`; daily attempt-byte read becomes zero on error. | Same fail-closed mapping through the one atomic RPC ledger; accepted reservations remain charged if later upload/media work fails. |

Every caller presently has a verified bearer actor, hashes the request IP with
`RATE_LIMIT_SALT`, and passes a server-derived byte value. The direct table
client is anon-key plus that verified bearer. The future trusted client is
constructed only after bearer authentication, route authorization, and the
existing payload validation needed to derive the contract inputs. It must not
accept a user id, IP hash, purpose, byte count, or client instance from a
browser payload.

The only permitted future state machine is:

1. RPC result is exactly `ALLOWED`: continue.
2. RPC result is exactly `RATE_LIMITED`: return the documented `429` response.
3. RPC throws, is missing, is inaccessible, times out, returns malformed data,
   or the trusted identity is unavailable: return a fixed `503` and do not
   continue the protected action.

The future RPC deadline is 4s maximum. The proposed database function has a 1s
lock timeout and 3s statement timeout. No automatic RPC retry is permitted:
timeout, connection loss, or any ambiguous transport outcome returns `503` and
the runtime must not infer whether an accepted reservation committed. V1 has no
idempotency token; a later user-initiated request is a new attempt.

No browser code receives direct table access. The current resend RPC is not a
replacement because it is executable by `anon` and `authenticated` and has a
different IP-only contract.

## R1 through R9

| Stage | Prerequisites and allowed work | Stop condition / evidence / rollback | Approval |
| --- | --- | --- | --- |
| R1 | Preview is `PREVIEW_R1_READY`: redacted operator-held metadata proves the encrypted Preview binding record. Local configuration and Production remain separately required; document rotation/owner. No code or database write. | Missing, ambiguous, plaintext, browser-exposed, or duplicate binding stops. Preview metadata does not prove value validity or authorize runtime/deployment work. | Security/operator approval. |
| R2 | Static proposal, fingerprint, catalog postflight, ACL/owner/search-path validation, complete quota matrix, timeout, and retry contract are complete and unexecuted. | No SQL execution. R3 is eligible only for separately approved disposable local simulation. | Local-test approval. |
| R3 | Completed only in a disposable local DB: behavior, race, rollback, timeout, ACL, and teardown tests passed. | Local evidence is not production evidence; Stage C remains blocked. | Completed local-test approval. |
| R4 | `R4_IMPLEMENTATION_READY` repository-only migration: the five protected routes call the fixed server-only `consume_forum_rate_limit` RPC wrapper. Direct `forum_upload_attempts` reads/writes are removed from those routes and the external-video reservation occurs before R2 signing. | Typed malformed, timeout, unavailable, configuration, and permission failures return a sanitized `503`; only `RATE_LIMITED` returns `429`. Missing trusted identity, unresolved media cap, or a direct table dependency stops. Revert runtime commit only. | Code/security review completed locally; no binding or deployment occurred. |
| R5 | `R5_READINESS_PACKET_COMPLETE_UNEXECUTED`: Preview deployment with authenticated, non-destructive verification, using the dedicated preflight, proposal reference, postflight, and checklist. | Preview identity/RPC mismatch, missing service-role binding, fail-open path, or behavior mismatch stops. Roll back Preview only. The exact R2 SQL remains separately approved and unexecuted. | Requires `APPROVE_R5_PREVIEW_RPC_SQL_RUNTIME_DEPLOYMENT_AND_VERIFICATION_STAGED_EXECUTION`. |
| R6 | Fresh production preflight then separate approved RPC execution. | Metadata/ACL/hash/postflight mismatch stops; use reviewed forward rollback only. | Production database approval. |
| R7 | Separately deploy verified runtime. | Runtime smoke failure or 503/429 contract mismatch stops; roll back deployment. | Production deployment approval. |
| R8 | Read-only production postflight and residue verification. | Direct access, unexpected grants, or row-exposure evidence stops. | Security/operator review. |
| R9 | Reconsider only `forum_upload_attempts_insert_self` and `forum_upload_attempts_select_self` after R7-R8 prove no direct caller. | No proof of runtime migration or policy equivalence means retain both. | Separate policy-removal approval. |

## R6 rollout packet status

Repository-only R6 planning is `R6_RESEND_IDENTITY_PACKET_READY` in
`operational-guardrails-r6-production-rollout.md`. The previous multi-result
R6 packet was connector-incompatible and did not mutate Production. Corrected
R6-2/R6-6 packets return one deterministic redacted result set each; their
offline validator binds the safe target marker and compares postflight baseline
fingerprints. The prior R6-2 attempt stopped with 14 of 15 checks passing because
its resend check used the wrong identity; the source-backed resend correction is
recorded in `operational-guardrails-r6-resend-rpc-identity-review.md`. Fresh
approval `APPROVE_R6_STAGE1_RESTART_WITH_RESEND_RECONCILED_PACKETS`
is required before any future R6-2 execution. This preserves
`R5_PREVIEW_BLOCKED_TARGET_IDENTITY`, the encrypted Production binding metadata
record, and the overall no-go state. R6 source review is now
`R6_STAGE1_BINDING_READY`: raw privileged-client exports were removed and the
exact narrow-consumer allowlist passes. Future execution still requires the exact
`APPROVE_R6_PRODUCTION_STAGED_EXECUTION_WITH_LOCAL_STAGING_ONLY_RISK_ACCEPTANCE`
approval; Stage C separately requires R7 approval after R6 runtime and canary
success.
