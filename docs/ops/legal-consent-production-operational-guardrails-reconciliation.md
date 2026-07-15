# Operational Guardrails Reconciliation Preflight

Status: `ONE_SHOT_PREFLIGHT_PACKET_READY`. This is W6 only and remains
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

If either extra policy remains, the validator intentionally requires a human
security decision to retain or remove it. No proposal or postflight exists yet.

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
