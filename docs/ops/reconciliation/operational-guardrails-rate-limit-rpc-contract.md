# W6 Atomic Rate-Limit RPC Contract

Status: proposed interface only. This document intentionally contains no
executable SQL, migration, grant, or runtime implementation.

## Interface

Proposed function: `public.consume_forum_rate_limit`.

| Argument | PostgreSQL type | Contract |
| --- | --- | --- |
| `p_user_id` | `uuid` | Required verified actor id, derived after bearer verification. Never taken from a request body. |
| `p_ip_hash` | `text` | Required server-derived SHA-256 hexadecimal hash. Raw IP addresses never enter the database function. |
| `p_purpose` | `text` | Required fixed allowlist value. |
| `p_bytes` | `bigint` | Required server-derived nonnegative byte count. |

The return type is `TABLE(allowed boolean, decision text)` and permits only
`(true, 'ALLOWED')` or `(false, 'RATE_LIMITED')`. It returns no count, limit,
remaining quota, reset timestamp, raw IP, user id, row id, timestamp, or error
detail. Invalid input and internal failures are function errors, not an
alternate successful result. The server maps either error to a fixed `503`
rate-limit-unavailable response and does not continue.

All current forum callers are authenticated and supply both a verified user id
and an IP hash. Null, blank, malformed, or mismatched identity inputs are
rejected. `verification_email_resend` is intentionally rejected: its existing
browser-executable resend function remains a separate contract and must not be
reused.

## Fixed policy map

Callers do not supply a threshold or window. The future function owns these
source-backed constants:

| Purpose | Scope | Maximum | Window | Bytes |
| --- | --- | --- | --- | --- |
| `post_create` | verified user | 10 | 3600 seconds | exactly 0 |
| `comment_create` | verified user | 60 | 3600 seconds | exactly 0 |
| `circle_create` | verified user | 5 | 86400 seconds | exactly 0 |
| `post_media_upload` | shared upload IP group | 10 | 3600 seconds | nonnegative, pending an approved upper cap |
| `external_video_upload` | same shared upload IP group | 10 | 3600 seconds | 1 through 157286400 bytes (150 MiB) |

The two upload purposes share one IP-scoped bucket because the current helper
counts both before inserting either one. The database clock, not the worker
clock, determines the window boundary. The design records the accepted attempt
inside the same transaction as the decision. A failed or rolled-back call
records no attempt.

`post_media_upload` currently accepts a request number without a source-owned
maximum. R4 is blocked until product/security approve a per-kind server-side
upper cap. The external-video route also has a separate 300 MiB daily byte
check using `forum_upload_attempts` and `post_media`; this interface does not
silently absorb that cross-table policy. R4 must either design an atomic
server-only companion boundary for it or remove/replace it under separate
approval before direct table access can disappear.

## Validation and retries

The future function must reject an unknown purpose, nil user id, blank or
non-64-hex IP hash, negative bytes, nonzero bytes for create purposes, and
bytes over an approved per-purpose cap. Values outside PostgreSQL `bigint`
range fail before conversion; the server treats that as unavailable/rejected,
not as zero. No idempotency key exists in the current request contracts. Until
one is separately designed, each successful invocation is one attempt and a
transport retry can consume another attempt. That explicit product decision is
still required.
