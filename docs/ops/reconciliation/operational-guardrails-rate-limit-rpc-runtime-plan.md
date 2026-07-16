# W6 Fail-Closed Runtime Migration Plan

## Current callers and target behavior

| Route | Action and purpose | Current limit | Current storage failure | Future allow/deny/error |
| --- | --- | --- | --- | --- |
| `posts.ts#POST` | Create post, `post_create` | 10/user/hour | Helper returns `allowed: true`. | `ALLOWED` continues; `RATE_LIMITED` is existing `429 RATE_LIMITED`; RPC failure is sanitized `503`. |
| `comments.ts#POST` | Create comment, `comment_create` | 60/user/hour | Helper returns `allowed: true`. | Same fail-closed mapping. |
| `circles.ts#POST` | Create circle, `circle_create` | 5/user/day | Helper returns `allowed: true`. | Same fail-closed mapping. |
| `media-upload-guard.ts#POST` | Guard media upload, `post_media_upload` | 10/shared-IP/hour | Helper returns `allowed: true`. | Same fail-closed mapping after a per-kind byte cap is approved. |
| `external-video-upload.ts#POST` | Sign external video upload, `external_video_upload` | 10/shared-IP/hour | Helper returns `allowed: true`; daily attempt-byte read becomes zero on error. | Same attempt mapping plus a separately approved atomic daily-byte replacement. |

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

No browser code receives direct table access. The current resend RPC is not a
replacement because it is executable by `anon` and `authenticated` and has a
different IP-only contract.

## R1 through R9

| Stage | Prerequisites and allowed work | Stop condition / evidence / rollback | Approval |
| --- | --- | --- | --- |
| R1 | Prove a server-only trusted binding for local, preview, and production; document rotation/owner. No code or database write. | Missing or ambiguous binding stops. Evidence is redacted binding presence and route-scoped factory review. Remove binding as rollback. | Security/operator approval. |
| R2 | Author unexecuted RPC forward proposal and static ACL/owner/search-path validation. | Any public/browser execute path, dynamic SQL, missing revoke, or unapproved byte policy stops. No execution. | Security review. |
| R3 | Apply only to disposable local DB; run behavior, race, rollback, and ACL tests. | Any non-atomic result, unexpected exposure, or failed cleanup stops. Tear down local DB. | Local-test approval. |
| R4 | Propose runtime helper/route migration only after R1-R3; remove all direct attempt reads/writes and resolve external daily bytes. | Missing trusted identity, unresolved media cap, or direct table dependency stops. Revert runtime commit only. | Code/security review. |
| R5 | Preview deployment with authenticated, non-destructive verification. | Preview identity/RPC mismatch or any fail-open path stops. Roll back preview. | Preview approval. |
| R6 | Fresh production preflight then separate approved RPC execution. | Metadata/ACL/hash/postflight mismatch stops; use reviewed forward rollback only. | Production database approval. |
| R7 | Separately deploy verified runtime. | Runtime smoke failure or 503/429 contract mismatch stops; roll back deployment. | Production deployment approval. |
| R8 | Read-only production postflight and residue verification. | Direct access, unexpected grants, or row-exposure evidence stops. | Security/operator review. |
| R9 | Reconsider only `forum_upload_attempts_insert_self` and `forum_upload_attempts_select_self` after R7-R8 prove no direct caller. | No proof of runtime migration or policy equivalence means retain both. | Separate policy-removal approval. |
