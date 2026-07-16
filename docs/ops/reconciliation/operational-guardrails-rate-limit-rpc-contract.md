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
| `p_bytes` | `bigint` | Required server-derived byte count validated by the fixed purpose policy. |

The return type is `TABLE(allowed boolean, decision text)` and permits only
`(true, 'ALLOWED')` or `(false, 'RATE_LIMITED')`. It returns no count, limit,
remaining quota, reset timestamp, raw IP, user id, row id, timestamp, or error
detail. Errors abort the call; the future runtime must not continue the
protected action.

## Fixed policy map

Callers do not supply a threshold or window. The future function owns these
approved constants:

| Purpose | Scope | Maximum | Window | Bytes |
| --- | --- | --- | --- | --- |
| `post_create` | verified user | 10 | rolling 3600 seconds | exactly 0 |
| `comment_create` | verified user | 60 | rolling 3600 seconds | exactly 0 |
| `circle_create` | verified user | 5 | rolling 86400 seconds | exactly 0 |
| `post_media_upload` | shared upload IP group | 10 | rolling 3600 seconds | 1 through 157286400 (150 MiB) |
| `external_video_upload` | shared upload IP group | 10 | rolling 3600 seconds | 1 through 157286400 (150 MiB), accepted bytes <= 314572800 (300 MiB) in rolling 24 hours |

The two upload purposes share one IP-scoped hourly bucket. External video uses
the same shared-IP transaction-scoped advisory lock to evaluate both that
hourly count and its 24-hour byte sum before recording its accepted attempt.
The database clock, not the worker clock, determines every boundary.

For V1, `public.forum_upload_attempts` is the only authoritative external-video
daily-byte ledger. The accepted reservation remains charged if later upload or
media work fails. No `post_media` read, reservation status, idempotency field,
or cleanup schema is introduced by this contract.

`verification_email_resend` is rejected by this function. Its existing
browser-executable resend RPC remains a separate contract and must not be
reused.

## Validation and retries

The function rejects an unknown purpose, nil user id, blank or non-64-hex IP
hash, bytes outside the relevant purpose range, and nonzero bytes for create
purposes. Values outside the PostgreSQL `bigint` range fail before conversion.
Validation and permission failure roll back and record no attempt.

V1 intentionally provides no idempotency guarantee. `ALLOWED` records exactly
one accepted attempt; `RATE_LIMITED` records none. A later user-initiated
request is a new attempt. The future runtime must never automatically retry an
RPC call. A timeout or connection loss can leave commit state ambiguous and
must return a fixed `503` without continuing.

The function has `lock_timeout = '1s'` and `statement_timeout = '3s'`; the
future runtime deadline is at most 4s. Lock/statement timeout, permission
denial, missing function, transport failure, malformed result, unexpected
decision, or missing trusted-server client each map to fail-closed `503`.
