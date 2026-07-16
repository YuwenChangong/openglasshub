# W6 R2 Atomic Server-Only Rate-Limit Proposal Review

Status: `COMPLETE_BUT_NOT_EXECUTABLE`. This is a repository-only R2 design
record. No SQL has been executed locally or remotely, no Cloudflare or Supabase
operation occurred, and the proposal is not a canonical migration.

## Exact Contract

The proposed identity is `public.consume_forum_rate_limit(uuid, text, text,
bigint)` with named arguments `p_user_id`, `p_ip_hash`, `p_purpose`, and
`p_bytes`. It returns only `TABLE(allowed boolean, decision text)` using the
two approved results `ALLOWED` and `RATE_LIMITED`. Invalid input, privilege
denial, a missing function, a timeout, transport failure, or malformed future
runtime result is an error; the future runtime must return a fixed `503` and
must not continue the protected action.

| Purpose | Source caller | Subject | Bytes | Maximum/window | Status |
| --- | --- | --- | --- | --- | --- |
| `post_create` | `posts.ts#POST` | verified user | exactly 0 | 10 / 3600s | `APPROVED` |
| `comment_create` | `comments.ts#POST` | verified user | exactly 0 | 60 / 3600s | `APPROVED` |
| `circle_create` | `circles.ts#POST` | verified user | exactly 0 | 5 / 86400s | `APPROVED` |
| `post_media_upload` | `media-upload-guard.ts#POST` | shared upload IP | nonnegative; cap unresolved | 10 / 3600s | `HUMAN_DECISION_REQUIRED` |
| `external_video_upload` | `external-video-upload.ts#POST` | shared upload IP | 1..157286400 | 10 / 3600s; separate 300 MiB daily rule unresolved | `HUMAN_DECISION_REQUIRED` |
| `verification_email_resend` | `resend-confirmation.ts#POST` | shared IP | exactly 0 | 5 / 86400s | `SOURCE_PROVEN_SEPARATE_RPC` |

`verification_email_resend` is explicitly rejected by this function. Its
browser-executable resend RPC is a separate contract and is not reused.

## Atomicity and Locks

The proposal uses `pg_catalog.pg_advisory_xact_lock` before every count. Create
purposes lock `user:<purpose>:<verified-user-id>`; upload purposes share the
single `upload-ip:<ip-hash>` lock. A stable rolling-window scope lock is safer
than a window-bucket lock: bucket-specific keys would permit overlapping
requests around a boundary. There is exactly one lock per invocation, so no
multi-lock ordering is applicable and no lock-order cycle exists. A hash
collision can only serialize unrelated callers; it cannot bypass a quota.

The function uses PostgreSQL `now()` as the one database-owned timestamp,
counts the index-compatible fixed scope, then inserts only an accepted attempt
inside the caller transaction. Any validation, insert, permission, timeout, or
transaction failure aborts the call and releases the transaction-scoped lock.
R2 is static reasoning only; R3 must prove races in a disposable database.

There is no source-proven combined user-and-IP quota. Every invocation requires
both server-derived identities, records both, and locks/counts only the existing
purpose scope: verified user for creation or the shared upload-IP group for
uploads. A future two-scope rule would require sorted lock materials before
acquisition; R2 intentionally does not invent one. PostgreSQL rejects a value
outside `bigint` before the function receives it. The future runtime maps that
validation error to its fixed `503` path rather than coercing or truncating it.

## Security Contract

The proposed function is `SECURITY DEFINER`, `VOLATILE`, `PARALLEL UNSAFE`,
not leakproof, owned by `postgres`, with fixed `search_path = pg_catalog,
public, pg_temp`. Table and function references are schema-qualified. The
future ACL revokes execute from `PUBLIC`, `anon`, and `authenticated`, then
grants only `service_role`, the architecture-approved server-only role already
used by two narrow server factories. This is a proposed ACL, not a grant made
by R2. It does not establish a generic service-role client or direct table API
for route business logic.

The proposed postflight inspects `pg_proc`, identity arguments, result type,
`prosecdef`, `provolatile`, `proparallel`, `proleakproof`, `proconfig`, owner,
and `aclexplode` ACL rows, including grantee OID `0` rendered as `PUBLIC`. It
must prove exactly one matching identity and no unintended overload before a
future approval can proceed.

## Failure Contract

Invalid purpose, missing/nil user, malformed IP hash, negative bytes, nonzero
bytes for creation, and invalid external-video bytes raise deterministic input
errors. The function deliberately has no successful "backend unavailable"
result. A missing function, permission denial, timeout, database error,
transport error, or malformed result is handled by the future runtime as a
fixed `503`; only the two approved return rows can produce `ALLOWED` or
`RATE_LIMITED`. No count, identifier, IP hash, limit, quota remainder, or
timestamp is returned.

## Human Decisions Still Required

1. Approve a server-owned generic `post_media_upload` per-upload byte ceiling,
   including its relationship to all four current upload kinds.
2. Approve whether the external-video daily 300 MiB aggregate becomes a
   companion atomic server-only boundary, and define the exact cross-table
   source of truth and rollback behavior.
3. Decide duplicate-request/idempotency semantics.
4. Approve lock and statement timeout values after R3 contention measurement.
5. Reconfirm the future production function owner and the Production binding.

The first two decisions make function-relevant rows
`HUMAN_DECISION_REQUIRED`; therefore R3 is not eligible. Stage C remains
`BLOCKED_RUNTIME_MIGRATION_REQUIRED`, Production remains
`BINDING_ABSENT_PRODUCTION_BLOCKED`, and legacy policy removal remains blocked.
