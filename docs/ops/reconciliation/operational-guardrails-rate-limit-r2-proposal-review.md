# W6 R2 Atomic Server-Only Rate-Limit Proposal Review

Status: `COMPLETE_STATICALLY_VALID`. This is a repository-only R2 design
record. No SQL has been executed locally or remotely, no Cloudflare or Supabase
operation occurred, and the proposal is not a canonical migration.

## Exact Contract

The proposed identity is `public.consume_forum_rate_limit(uuid, text, text,
bigint)` with named arguments `p_user_id`, `p_ip_hash`, `p_purpose`, and
`p_bytes`. It returns only `TABLE(allowed boolean, decision text)` using the
two approved results `ALLOWED` and `RATE_LIMITED`. It returns no count, limit,
remaining quota, user id, IP hash, row id, or timestamp.

| Purpose | Source caller | Subject | Bytes | Maximum/window | Status |
| --- | --- | --- | --- | --- | --- |
| `post_create` | `posts.ts#POST` | verified user | exactly 0 | 10 / rolling 3600s | `APPROVED` |
| `comment_create` | `comments.ts#POST` | verified user | exactly 0 | 60 / rolling 3600s | `APPROVED` |
| `circle_create` | `circles.ts#POST` | verified user | exactly 0 | 5 / rolling 86400s | `APPROVED` |
| `post_media_upload` | `media-upload-guard.ts#POST` | shared upload IP | 1..157286400 | 10 / rolling 3600s | `APPROVED` |
| `external_video_upload` | `external-video-upload.ts#POST` | shared upload IP | 1..157286400 | 10 / rolling 3600s and accepted sum <= 314572800 / rolling 24 hours | `APPROVED` |
| `verification_email_resend` | `resend-confirmation.ts#POST` | shared IP | rejected by this function | existing separate RPC | `SOURCE_PROVEN_SEPARATE_RPC` |

`verification_email_resend` is explicitly rejected by this function. Its
browser-executable resend RPC is a separate contract and is not reused.

## Atomicity, Windows, and Locks

PostgreSQL `now()` is the single database-owned clock. Create purposes lock a
server-derived `user:<purpose>:<verified-user-id>` scope. Both upload purposes
lock the one server-derived `upload-ip:<ip-hash>` scope. External video has one
shared-IP lock for both its hourly count and its rolling 24-hour byte sum, so
there is one deterministic lock acquisition before either read and before the
accepted-row insert. There is no second lock or lock-order cycle.

The external-video byte predicate is exactly `created_at >= v_now - INTERVAL
'24 hours'`; it is not a calendar-day calculation. Under the shared-IP lock,
the function first checks the shared hourly accepted-attempt count, then the
`external_video_upload` byte sum in `public.forum_upload_attempts`, then
inserts one accepted row only if both checks pass. It does not query
`post_media` or another media/upload table.

The V1 byte ledger is deliberately conservative: an accepted external-video
reservation remains charged even if the later upload or media workflow fails.
This avoids a cross-table atomicity gap and concurrent oversubscription without
adding a status/cleanup schema. R3 must prove this behavior and rollback of an
uncommitted function call in a disposable database.

## Failure, Retry, and Timeout Contract

Validation and permission errors abort the transaction and insert no attempt.
`RATE_LIMITED` inserts no attempt. `ALLOWED` inserts exactly one accepted
attempt. V1 has no idempotency token or request UUID: a later user-initiated
request is a new attempt and can consume another slot.

The function configuration is exactly `lock_timeout = '1s'` and
`statement_timeout = '3s'`. The future runtime RPC deadline is at most 4s. An
advisory-lock timeout, statement timeout, permission denial, missing function,
transport failure, malformed result, unexpected decision, or missing trusted
server client must produce a fixed fail-closed `503` and must not automatically
retry. A connection loss or other ambiguous transport outcome also returns
`503` without retry; the runtime must treat commit state as ambiguous.

## Security Contract

The proposed function is `SECURITY DEFINER`, `VOLATILE`, `PARALLEL UNSAFE`,
not leakproof, owned by `postgres`, with fixed `search_path = pg_catalog,
public, pg_temp`. Table and function references are schema-qualified. The
future ACL revokes execute from `PUBLIC`, `anon`, and `authenticated`, then
grants only `service_role`. This is a proposal, not a grant made by R2.

The static postflight inspects `pg_proc`, identity arguments, result type,
`prosecdef`, `provolatile`, `proparallel`, `proleakproof`, `proconfig`, owner,
and `aclexplode` ACL rows, including grantee OID `0` rendered as `PUBLIC`.

## Readiness

All function-relevant quota, retry, and timeout decisions are approved. R2 is
complete and static validation is passing. R3 is
`ELIGIBLE_PENDING_SEPARATE_APPROVAL` for disposable local database behavior and
concurrency simulation only. Production function-owner confirmation and the
Production server-role binding remain separate deployment prerequisites.

Stage C remains `BLOCKED_RUNTIME_MIGRATION_REQUIRED`; no runtime, migration,
grant, policy removal, Preview, or Production action is authorized by this
review.
