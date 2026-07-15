# Operational Guardrails Reconciliation Preflight

Status: `INDEX_STAGES_APPLIED_POSTFLIGHT_VERIFIED_POLICY_PRIVILEGE_HOLD`. This is W6 only and remains
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
  (`PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED`; historical classification
  `MISSING_IN_PRODUCTION`, P1), from `20260605_forum_rate_limit_purposes.sql`.
- `public.forum_upload_attempts.forum_upload_attempts_purpose_user_created_idx`
  (`PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED`; historical classification
  `MISSING_IN_PRODUCTION`, P1), from the same migration.
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

## Stage A production execution record

Stage A executed the reviewed standalone
`CREATE INDEX CONCURRENTLY forum_upload_attempts_purpose_ip_created_idx ON
public.forum_upload_attempts (purpose, ip_hash, created_at DESC)` statement
once, outside a transaction. Fresh preflight confirmed the target was missing,
no structural equivalent or invalid/unfinished candidate existed, and the
policy/privilege hold matched the reviewed state.

Redacted Stage A postflight verified one valid, ready, non-unique `btree` index
with the exact reviewed key order and descending `created_at`.

Stage B then executed its reviewed standalone
`CREATE INDEX CONCURRENTLY forum_upload_attempts_purpose_user_created_idx ON
public.forum_upload_attempts (purpose, user_id, created_at DESC)` statement
once, outside a transaction. Its fresh preflight confirmed Stage A remained
exact and valid/ready, Stage B was missing, and no structural equivalent or
invalid/unfinished candidate existed. Redacted postflight verified both exact
index shapes, with no invalid, unfinished, failed, or duplicate Stage B-shaped
index remaining.

`forum_upload_attempts_insert_self` and `forum_upload_attempts_select_self`
remain unchanged; no grant, privilege, policy, application-data, or unrelated
catalog change was made. The next safe action is a separately reviewed policy
and authenticated-privilege reconciliation; it is not authorized by this index
execution record. W6 and the overall reconciliation remain `NO_GO`.

## Authenticated privilege-contract review

This review is read-only. It does not authorize policy removal, table grants,
or runtime changes. Both production indexes are complete and outside this
scope.

### Runtime access-path inventory

| Path | Intended role | Required privilege | Applicable RLS | Source-backed behavior | Current evidence / gap |
| --- | --- | --- | --- | --- | --- |
| Browser client | No direct table role | None | None | No browser source calls `forum_upload_attempts`. | Source search finds no browser-table client. |
| Authenticated forum API: post, comment, and circle creation | Caller bearer token via anon-key client | `SELECT`, then `INSERT` | Canonical `forum_upload_attempts_select_authenticated` (`USING true`) and `forum_upload_attempts_insert_authenticated` (`user_id = auth.uid() OR user_id IS NULL`) | `enforceUserRateLimit` counts then inserts a caller-derived record. | Prior catalog evidence reports effective authenticated `SELECT=false`, `INSERT=false`; helper returns `allowed: true` on either DB error. Fresh ACL/RLS evidence is required. |
| Authenticated forum API: media guard and external video upload | Caller bearer token via anon-key client | `SELECT`, then `INSERT` | Same canonical policies | `enforceUploadRateLimit` counts then inserts; external-video also directly reads `bytes` for its daily cap. | Same privilege gap; both failure paths treat unavailable attempt data as zero/allowed. |
| Unauthenticated resend-confirmation API | `anon` RPC caller | `EXECUTE` on one RPC, not table `SELECT`/`INSERT` | RLS/table grants bypassed only inside the reviewed security-definer RPC | `consumeVerificationEmailResendLimit` calls `consume_verification_email_resend_limit`; the function reads and inserts the `verification_email_resend` attempt. | Source migration grants RPC execute to `anon` and `authenticated`; fresh function ACL/metadata evidence is required. |
| Service-role server client | None for this table | None established | Not applicable | Repository service-role factories are used for legal-consent and moderation-notification work, but no `forum_upload_attempts` caller uses one. | No service-role bypass is source-backed for this table. |
| Background job / direct database function | Resend RPC only | RPC `EXECUTE` | Function is `SECURITY DEFINER` with `search_path = public, pg_temp` in source | No worker, cron, or other RPC/table reference is present in repository search. | Fresh RPC catalog evidence must confirm production still matches the reviewed contract. |

### Current grant and RLS matrix

The last redacted supplemental catalog review established RLS enabled (not
forced), all four policies present, and effective authenticated `SELECT=false`
and `INSERT=false`. It also established that the two extra policies are
RLS-redundant: permissive policies compose with `OR`, so the canonical INSERT
policy already covers the narrower `insert_self` rows and canonical SELECT is
already `USING true`.

RLS is not a grant. With the observed effective table privileges, the bearer
clients used by forum APIs cannot rely on either RLS policy to access the table.
The helper deliberately turns a table error into an available result, so this
is a rate-limit enforcement gap rather than evidence that the protected route
itself fails.

Granting `authenticated` table access is not currently an approved remedy:

- an authenticated `SELECT` grant would activate canonical `USING true` and
  expose every readable upload-attempt row to any authenticated REST/browser
  caller;
- an authenticated `INSERT` grant would activate a permissive self-or-null
  insert path for direct callers, not only the server route;
- no source-backed service-role path currently provides a separate privileged
  boundary for forum rate-limit reads or writes.

Therefore neither `forum_upload_attempts_insert_self` nor
`forum_upload_attempts_select_self` is safe to remove now. Removal is
RLS-redundant but not behavior-preserving until the table/RPC privilege
contract is freshly verified and a security reviewer selects an intended
server-side enforcement boundary.

### Required fresh evidence

The existing snapshot is insufficient to confirm the current direct ACL,
PUBLIC/inherited privilege contribution, policy definitions, and resend RPC
ACL after the index stages. Use this new catalog-only packet; it returns no
application rows and executes no write SQL:

```powershell
Get-Content -Raw "D:\OpenGlass Hub interaction-release-fresh\docs\ops\reconciliation\operational-guardrails-authenticated-privilege-preflight.sql" | Set-Clipboard
```

Run it once in the confirmed production Dashboard, export its sole result set,
and obtain explicit approval before any later review or remediation. Do not
run a policy DROP, GRANT, REVOKE, or proposal from this packet.

### Recommended next action

Obtain and validate the fresh read-only ACL/RLS/RPC packet, then make one
explicit product/security decision: either introduce a narrowly authorized
server-side rate-limit boundary (preferred), or explicitly accept direct
authenticated table access and replace the broad canonical policies before
granting it. Until that decision and evidence exist, retain both policies and
all grants unchanged.

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
