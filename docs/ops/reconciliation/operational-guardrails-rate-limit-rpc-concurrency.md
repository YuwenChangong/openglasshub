# W6 Rate-Limit Concurrency Decision

## Selected design

The selected R2 design is one Transaction-scoped advisory lock followed by all
applicable reads and one accepted-row insert. Create purposes use a
server-derived `user:<purpose>:<uuid>` lock. Upload purposes use a
server-derived `upload-ip:<sha256>` lock. Each current invocation has exactly
one scope, so there is one lock acquisition and no multi-lock ordering or deadlock cycle.

For `external_video_upload`, that one shared-IP lock serializes both quota
constraints in deterministic order: hourly shared upload attempt count first,
then rolling 24-hour external-video byte sum, then one insert. The byte window
is database-clock `created_at >= now() - INTERVAL '24 hours'`, not a calendar
day. The daily sum is only `public.forum_upload_attempts` rows for
`external_video_upload`; no cross-table read is permitted.

An accepted external-video reservation remains charged even if later upload or
media work fails. This approved V1 behavior preserves quota safety without a
cross-table transaction, status column, or cleanup path. A hash collision can
serialize unrelated callers but cannot permit a quota bypass.

The function configuration sets `lock_timeout = '1s'` and
`statement_timeout = '3s'`. The future runtime has an at-most-4s RPC deadline
and no automatic retry. Any timeout, database failure, missing function,
permission failure, malformed result, or ambiguous transport outcome fails
closed with `503` in the future runtime migration.

R3 must use a disposable local database to prove exact-threshold races,
one-above-limit denial, rollback, lock release, shared-IP isolation, accepted
reservation charging, ACL denial, and no result leakage. R2 authorizes none of
that execution; a separate R3 approval remains mandatory.
