# W6 Atomic Rate-Limit RPC Readiness Checklist

Current status: `DESIGN_COMPLETE_IMPLEMENTATION_BLOCKED`.

## Proposed security contract

- The function is proposed as `SECURITY DEFINER`, `VOLATILE`, parallel unsafe,
  and not leakproof. It has a fixed `search_path` of `pg_catalog, public,
  pg_temp`; all relation references are schema-qualified.
- Proposed owner is `postgres`, matching the observed table and reviewed
  functions, but R2/R6 must re-confirm and explicitly approve it. A dedicated
  non-login owner is not source-proven.
- `PUBLIC`, `anon`, and `authenticated` have no execute permission. The owner
  has inherent execution. The only additional grantee is the R1-proven trusted
  server role; `service_role` is pending R1 configuration and approval.
- The owner needs the table privileges already observed for `postgres`. RLS is
  enabled and not forced; R2 must prove that owner/definer behavior remains
  compatible without disabling RLS globally. Do not set `row_security` unless a
  reviewed local test shows it is necessary and safe.
- A finite statement/lock timeout must be chosen in R2 and mapped to a fixed
  route `503`. No current source proves an appropriate duration.

## Required deterministic checks

The R2/R3 suite must cover the allowlist, verified user plus IP identity,
rejection of anonymous/IP-only or null identity, invalid purpose, negative and
oversize bytes, exact-threshold concurrency, one request above the threshold,
rollback, RPC unavailable, permission denial, malformed result, timeout,
transport error, no browser direct table use, ACL denial for PUBLIC/anon/
authenticated, safe owner/search path, no resend reuse, and no policy removal
before R7/R8 verification.

## Remaining human decisions

1. Approve the exact trusted server identity, its `SUPABASE_SERVICE_ROLE_KEY`
   binding scope, and its preview/production rotation procedure; do not infer
   it from the existing legal-consent factory.
2. Approve an upper byte cap for `post_media_upload` by upload kind.
3. Decide whether duplicate network requests intentionally consume multiple
   attempts or require a new idempotency key contract.
4. Approve a lock/statement timeout after local contention measurements.
5. Approve the proposed `postgres` function owner or introduce a separately
   reviewed owner role.
6. Decide whether external-video's daily 300 MiB cross-table quota becomes a
   companion atomic server-only boundary or is redesigned; it cannot retain a
   fail-open direct attempt read.
7. Approve R6 and R7 independently. Neither follows from this design record.
