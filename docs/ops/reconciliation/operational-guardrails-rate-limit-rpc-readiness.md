# W6 Atomic Rate-Limit RPC Readiness Checklist

Current status: `R2_CORRECTED_R3_PASSED_LOCAL_DISPOSABLE_ONLY`.

The R2 proposal package is repository-only and unexecuted:

- [unexecuted SQL proposal](operational-guardrails-rate-limit-r2-unexecuted-proposal.sql)
- [static catalog postflight](operational-guardrails-rate-limit-r2-static-postflight.sql)
- [proposal review](operational-guardrails-rate-limit-r2-proposal-review.md)
- [expected static fingerprint](operational-guardrails-rate-limit-r2-expected-fingerprint.md)
- [R3 simulation readiness](operational-guardrails-rate-limit-r3-simulation-readiness.md)

It is not a canonical migration, must not be executed anywhere, and does not
unblock Stage C. All function-relevant quota decisions are approved; R3 is
eligible only after separate approval for a disposable local simulation.

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
- The approved function settings are `lock_timeout = '1s'` and
  `statement_timeout = '3s'`; the future runtime deadline is at most 4s and
  maps listed infrastructure/result failures to fixed `503` without retry.

## Required deterministic checks

The R2/R3 suite must cover the allowlist, verified user plus IP identity,
rejection of anonymous/IP-only or null identity, invalid purpose, negative and
oversize bytes, exact-threshold concurrency, one request above the threshold,
rollback, RPC unavailable, permission denial, malformed result, timeout,
transport error, no browser direct table use, ACL denial for PUBLIC/anon/
authenticated, safe owner/search path, no resend reuse, and no policy removal
before R7/R8 verification.

## Remaining deployment prerequisites

1. R3 passed in a disposable local database; its evidence is local-only and
   does not authorize a runtime or production change.
2. Reconfirm the proposed `postgres` function owner or introduce a separately
   reviewed owner role before any production execution review.
3. Establish and separately prove the Production server-only binding. It
   remains `BINDING_ABSENT_PRODUCTION_BLOCKED`.
4. Approve R4, R6, and R7 independently. None follows from this design record.
