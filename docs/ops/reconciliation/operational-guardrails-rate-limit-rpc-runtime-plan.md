# W6 Fail-Closed Runtime Migration Plan

## Current callers and target behavior

| Route | Action and purpose | Limit | Historical direct-table storage failure | Current repository R4 allow/deny/error |
| --- | --- | --- | --- | --- |
| `posts.ts#POST` | Create post, `post_create` | 10/user/hour | Helper returns `allowed: true`. | `ALLOWED` continues; `RATE_LIMITED` is existing `429 RATE_LIMITED`; RPC failure is sanitized `503`. |
| `comments.ts#POST` | Create comment, `comment_create` | 60/user/hour | Helper returns `allowed: true`. | Same fail-closed mapping. |
| `circles.ts#POST` | Create circle, `circle_create` | 5/user/day | Helper returns `allowed: true`. | Same fail-closed mapping. |
| `media-upload-guard.ts#POST` | Guard media upload, `post_media_upload` | 10/shared-IP/hour, 1..157286400 bytes | Helper returns `allowed: true`. | Same fail-closed mapping with the RPC's defense-in-depth cap; a lower source-proven route cap remains authoritative. |
| `external-video-upload.ts#POST` | Sign external video upload, `external_video_upload` | 10/shared-IP/hour, 1..157286400 bytes, 314572800 accepted bytes/shared-IP/rolling 24h | Helper returns `allowed: true`; daily attempt-byte read becomes zero on error. | Same fail-closed mapping through the one atomic RPC ledger; accepted reservations remain charged if later upload/media work fails. |

Every current repository caller has a verified bearer actor, hashes the request IP with
`RATE_LIMIT_SALT`, and passes a server-derived byte value. The direct table
client was historical; R4 uses a private server-only service-role RPC client
after bearer authentication, route authorization, and the existing payload
validation needed to derive the contract inputs. It must not
accept a user id, IP hash, purpose, byte count, or client instance from a
browser payload.

The current repository state machine is:

1. RPC result is exactly `ALLOWED`: continue.
2. RPC result is exactly `RATE_LIMITED`: return the documented `429` response.
3. RPC throws, is missing, is inaccessible, times out, returns malformed data,
   or the trusted identity is unavailable: return a fixed `503` and do not
   continue the protected action.

The RPC deadline is 4s maximum. The committed database function has a 1s
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
| R5 | Historical `R5_READINESS_PACKET_COMPLETE_UNEXECUTED` Preview plan; Preview identity and runtime verification were not established. | Preview evidence cannot substitute for Production target, binding, or runtime proof. | Its historical approval text does not authorize present work. |
| R6 | `COMMITTED_EXACTLY`: R6P closed the once-submitted RPC's catalog recovery against the R6-2 baseline. | R6-5 is non-replayable; this catalog proof is not runtime proof. | Consumed single-use SQL/recovery approvals. |
| R7 | Separately deploy and verify the current fail-closed runtime. | Target/commit/binding mismatch, runtime smoke failure, or 503/429 contract mismatch stops; roll back deployment under review. | New Production deployment approval required. |
| R8 | Read-only Production postflight and residue/direct-access verification after low-volume canary. | Direct access, unexpected grants, row exposure, or cleanup residue stops. | Separate security/operator review. |
| R9 | Optionally reconsider `forum_upload_attempts_insert_self` and `forum_upload_attempts_select_self` after R7-R8; both may remain through Beta. | No post-runtime proof or separate approval means retain both. | Separate Stage C policy-removal approval. |

## R6 catalog closure and next runtime gate

R6P classified the once-submitted R6-5 SQL/RPC mutation `COMMITTED_EXACTLY`
against the protected R6-2 baseline and closed R6-6 catalog recovery. Its
approval is consumed; R6-5 is non-replayable. The exact seven direct
service-role consumers now pass the reviewed allowlist and privileged-surface
scanner. See `w6-policy-privilege-runtime-beta-reconciliation.md`.

The next stage is `DEPLOY_AND_VERIFY_CURRENT_FAIL_CLOSED_RUNTIME`, under a
separate explicit Production deployment approval after target, commit, and
server-only binding checks. Then run low-volume Production runtime smoke/canary
and residue/direct-access verification. Only afterward may Stage C policy
cleanup be considered under its own approval. R6 SQL catalog closure does not
prove deployment, runtime behavior, canary, or residue, and this repository
plan authorizes none of those actions. Production remains `NO_GO`.
