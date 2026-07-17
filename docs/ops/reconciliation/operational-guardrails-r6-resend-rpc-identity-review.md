# R6 Resend RPC Identity Reconciliation

Status: `R6_RESEND_EXPECTATION_DEFECT` (repository-only correction).

## Preserved Redacted R6-2 Evidence

The once-executed, catalog-only R6-2 preflight returned 15 rows: 14 `PASS` and one blocking `FAIL`. The operator-held row is not committed.

| Field | Recorded redacted value |
| --- | --- |
| Check ID | `resend_separation` |
| Packet expectation | `public.consume_verification_email_resend` |
| Actual state | `false` |
| Status | `FAIL` |
| Classification | `INSUFFICIENT_EVIDENCE` |
| Evidence fingerprint | `6e6de54c8ffd0680fca9bdb436896435` |

That row proves only that the old, incorrectly encoded identity was absent. It does not export a function body, business row, credential, connection value, or secret.

## Exact Source-Backed Contract

| Source | Reference | Contract fact | Confidence | Conflict |
| --- | --- | --- | --- | --- |
| `src/lib/server/rate-limit.ts` | `consumeVerificationEmailResendLimit` | Runtime calls `consume_verification_email_resend_limit` with `input_ip_hash`, `max_attempts`, and `window_hours`; it expects one `{ allowed: boolean }` row. | Exact source | None |
| `src/pages/api/auth/resend-confirmation.ts` | `POST` | The unauthenticated resend route derives a salted request-IP hash and invokes that helper before Auth resend. | Exact source | None |
| `supabase/migrations/20260607_auth_resend_confirmation_limit.sql` | function declaration | Canonical identity is `public.consume_verification_email_resend_limit(text,integer,integer)` with result `TABLE(allowed boolean, attempts integer)`. | Exact migration | None |
| same migration | function attributes | The function is `SECURITY DEFINER`; its fixed configuration is `search_path=public, pg_temp`. PostgreSQL defaults establish `VOLATILE`, `PARALLEL UNSAFE`, and non-leakproof. No timeout setting is source-backed. | Exact migration/defaults | None |
| same migration | ACL statements | `PUBLIC` is revoked; `anon` and `authenticated` receive `EXECUTE`. The checked-in normalized fingerprint and prior redacted catalog review record `service_role=false` and owner `postgres`. | Migration plus reviewed catalog record | None |
| `docs/ops/legal-consent-production-operational-guardrails-reconciliation.md` | effective privilege record | The prior redacted catalog record states the exact resend RPC exists with owner `postgres`, security definer, fixed search path, `anon`/`authenticated` execute, and no `PUBLIC` or `service_role` execute. | Reviewed redacted operational record | None |
| repository-wide search | RPC/migration aliases | No historical rename or explicit compatibility alias is checked in. Similar names are not accepted as aliases. | Exact source search | None |

## Four-Identity Comparison

| Identity | Value | Result |
| --- | --- | --- |
| A. Runtime-called | `public.consume_verification_email_resend_limit(text,integer,integer)` | Exact source-backed contract |
| B. Canonical migration | `public.consume_verification_email_resend_limit(text,integer,integer)` | Exact match to A |
| C. Old R6 expectation | `public.consume_verification_email_resend` | Defect: wrong name and no signature |
| D. Captured R6-2 row | Old C identity absent (`false`) | Expected failure of the defective check; the checked-in prior redacted catalog record supplies the exact-contract evidence for A/B |

The result is `R6_RESEND_EXPECTATION_DEFECT`: the runtime and canonical source prove one exact contract, prior reviewed redacted catalog evidence records that contract in Production, and only R6 encoded the wrong expectation. This does not normalize a production alias or accept a similarly named function.

## Packet Correction and Future Gate

R6-2 now checks the exact function signature, complete source-backed metadata, independent ACL matrix, single-overload condition, and exact identity separation from `public.consume_forum_rate_limit`. It records separate redacted metadata and ACL fingerprints. R6-6 repeats those checks and requires both fingerprints to match the operator-held R6-2 baseline. Neither packet returns a body/source, business data, or mutation.

The previous Stage 1 approval is not reusable. No cloud query, Production SQL, secret creation, deployment, or policy/grant change occurred in this review. Only after the corrected packets pass a fresh read-only R6-2 execution may an operator seek `APPROVE_R6_STAGE1_RESTART_WITH_RESEND_RECONCILED_PACKETS`.
