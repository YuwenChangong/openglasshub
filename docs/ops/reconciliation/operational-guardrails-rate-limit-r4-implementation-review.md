# W6 R4 Fail-Closed Runtime Implementation Review

Status: `R4_IMPLEMENTATION_READY`, repository-only. No Preview, Production,
Supabase, Cloudflare, SQL, secret, or deployment operation occurred.

The new server-only boundary is
`src/lib/server/consume-forum-rate-limit.server.ts`. It constructs a private
service-role client only to call the fixed
`public.consume_forum_rate_limit(uuid,text,text,bigint)` RPC. It exports no raw
client or key, uses an abort signal plus an exact 4000 ms deadline race, makes
no retry, validates exactly one result row, and accepts only boolean/decision
pairs `true/ALLOWED` and `false/RATE_LIMITED`.

`src/lib/server/rate-limit.ts` no longer selects from or inserts into
`forum_upload_attempts`. Its five migrated callers are posts, comments,
circles, media upload guard, and external-video upload. `RATE_LIMITED` remains
429; service/configuration/timeout/malformed failures return 503 and stop the
protected action. External-video now reserves quota before R2 signing; a later
upload failure does not refund the accepted reservation. Resend remains on its
separate RPC.

Stage C remains `BLOCKED_RUNTIME_MIGRATION_REQUIRED`: source integration does
not prove a Preview function, binding value, or deployment. Production binding
metadata is ready, but R6 remains `R6_BLOCKED_GENERIC_PRIVILEGED_CLIENT`.
