# Operational Guardrails Reconciliation Preflight

Status: `INDEX_STAGES_UNEXECUTED_REVIEW_READY_POLICY_PRIVILEGE_HOLD`. This is W6 only and remains
`LEGAL_TRUST_CONSENT_FOUNDATION_V1_PRODUCTION_RECONCILIATION_NO_GO`.

## Why W6 is next

W6 is dependency-complete after W0 and is the smallest unresolved bounded
security wave: four objects on one table in one domain. It contains two P0
extra policies and two P1 missing rate-limit indexes. W3B (11 objects), W4 (7
objects across posts/reports), and W5 (13 media objects) are larger or depend
on later authorization evidence. W6 therefore has the highest direct runtime
and security impact among safely preflightable candidates without reopening
Wave 1 or Wave 3A.

Exact scope:

- `public.forum_upload_attempts.forum_upload_attempts_purpose_ip_created_idx`
  (`MISSING_IN_PRODUCTION`, P1), from
  `20260605_forum_rate_limit_purposes.sql`.
- `public.forum_upload_attempts.forum_upload_attempts_purpose_user_created_idx`
  (`MISSING_IN_PRODUCTION`, P1), from the same migration.
- `public.forum_upload_attempts.forum_upload_attempts_insert_self`
  (`EXTRA_IN_PRODUCTION`, P0), from
  `20260531_forum_phase6_upload_guardrails.sql`.
- `public.forum_upload_attempts.forum_upload_attempts_select_self`
  (`EXTRA_IN_PRODUCTION`, P0), from the same migration.

Source-backed runtime callers are `src/lib/server/rate-limit.ts` and
`src/pages/api/forum/external-video-upload.ts`. Direct dependencies are only
the table, its five rate-limit columns, the two indexes, and the two reviewed
policy names. The packet returns catalog definitions plus aggregate-only safety
counts; it returns no user identifiers, IP values, timestamps, or attempt rows.
Its ACL section reads catalog ACL entries with `aclexplode`; PUBLIC is represented
by ACL grantee OID `0`, not as a `pg_roles` name. The aggregate purpose contract
also includes `verification_email_resend`, which is added by the existing
rate-limit migration.

The supplemental production export is complete: all four existing indexes are
valid and ready but none is a structural equivalent of either expected
purpose-leading index. Both extra policies are RLS-redundant: the canonical
INSERT policy permits every reviewed `insert_self` row, and canonical SELECT
already uses `USING true` for `authenticated`. The catalog also proves a
separate availability blocker: `authenticated` has no effective `SELECT` or
`INSERT` privilege on this table, while the source-backed rate-limit callers
use bearer-bound anon-key clients. RLS policy removal is therefore held until a
separate reviewed privilege-contract reconciliation can prove runtime behavior.

The two indexes are independently eligible for review as sequential concurrent
operations. Their unexecuted packet is:

- [fresh execution preflight](reconciliation/operational-guardrails-index-execution-preflight.sql)
- [Stage A concurrent index](reconciliation/operational-guardrails-index-stage-a-proposal.sql)
- [Stage B concurrent index](reconciliation/operational-guardrails-index-stage-b-proposal.sql)
- [read-only postflight](reconciliation/operational-guardrails-index-postflight.sql)
- [staged checklist](reconciliation/operational-guardrails-index-execution-checklist.md)

Each `CREATE INDEX CONCURRENTLY` statement is intentionally a single standalone
statement outside a transaction. The index path requires fresh preflight before
each stage and explicit production approval; no policy DROP is included.

## Supplemental catalog review

The primary packet proves only that the two named indexes are missing and that
the two extra policies exist. Before any W6 remediation, run the supplemental
catalog packet. It records every table index, all overlapping policies, direct
ACL entries, effective privileges for real roles, RLS state, and safe catalog
dependencies. It returns no table rows and creates no proposal.

1. Copy the supplemental packet:

   ```powershell
   Get-Content -Raw "D:\OpenGlass Hub interaction-release-fresh\docs\ops\reconciliation\operational-guardrails-production-preflight-supplemental-one-shot.sql" | Set-Clipboard
   ```

2. Run it once in the confirmed production Dashboard and export its only result
   set to `C:\Users\1\Downloads\operational-guardrails-production-preflight-supplemental.csv`.
3. Validate fully offline:

   ```powershell
   node scripts/validate-operational-guardrails-production-preflight-supplemental.mjs "C:\Users\1\Downloads\operational-guardrails-production-preflight-supplemental.csv"
   ```

4. Resume W6 proposal review only with that validator result. A later missing
   index must use sequential `CREATE INDEX CONCURRENTLY` outside a transaction;
   the supplemental packet itself contains no executable remediation SQL.

## One-run operator workflow

1. Copy the one-shot SQL:

   ```powershell
   Get-Content -Raw "docs/ops/reconciliation/operational-guardrails-production-preflight-one-shot.sql" | Set-Clipboard
   ```

2. Run it once in the confirmed production Supabase Dashboard SQL Editor.
3. Export the only result set.
4. Save it exactly as `C:\Users\1\Downloads\operational-guardrails-production-preflight.csv`.
5. Run fully offline:

   ```powershell
   node scripts/validate-operational-guardrails-production-preflight.mjs "C:\Users\1\Downloads\operational-guardrails-production-preflight.csv"
   ```

6. Resume proposal review only with the CSV and validator result. The packet is
   read-only and creates no fixture, migration, proposal, or postflight.
