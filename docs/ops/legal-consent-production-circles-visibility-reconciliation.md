# Circles Visibility Reconciliation Preflight

Status: `PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED`. This dedicated
`CIRCLES_VISIBILITY_FOUNDATION` wave committed once after a matching fresh
execution preflight. Wave 1 remains `PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED`;
this record does not reopen it.
Production remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PRODUCTION_RECONCILIATION_NO_GO`.

## Exact scope

The one-shot packet collects catalog and aggregate-only evidence for exactly:

- `public.circles` constraint `circles_status_check`.
- `public.circles` SELECT policy `circles_select_public`.
- `public.circles` DELETE policy `circles_delete_owner_or_staff`.
- The source-backed helper dependencies `public.can_access_public_circle(uuid)`
  and `public.is_moderator_or_admin()`.

The local expected status constraint is `CHECK (status = ANY (ARRAY['active',
'deleted']))`. The expected public policy is permissive `SELECT` for `anon` and
`authenticated`, using `can_access_public_circle(id)` with retained owner and
staff branches. The application management route uses a soft delete status
update. The explicit product/security decision is
`REMOVE_DIRECT_HARD_DELETE_POLICY`: no supported application caller uses direct
circle DELETE, hard delete is irreversible, and future permanent removal must
be a separately reviewed server-only operation.

The packet returns no circle names, slugs, IDs, owner IDs, member identities,
timestamps, descriptions, or user-generated content. Its only table data reads
are aggregate counts over `public.circles`: status counts, expected-constraint
violations, anonymous current-versus-expected visibility counts, and a total
potential DELETE-policy impact count.

## One-run operator workflow

1. Open [circles-visibility-production-preflight-one-shot.sql](reconciliation/circles-visibility-production-preflight-one-shot.sql).
2. Copy all SQL.
3. Run it once in the confirmed production Supabase Dashboard SQL Editor.
4. Export the single result set.
5. Save it exactly as `C:\Users\1\Downloads\circles-visibility-production-preflight.csv`.
6. Run:

   ```powershell
   node scripts/validate-circles-visibility-production-preflight.mjs "C:\Users\1\Downloads\circles-visibility-production-preflight.csv"
   ```

7. Resume fully offline proposal review with the CSV and validator result.

The validator requires the stable ten-column schema and all ten sections. It
fails closed for absent or duplicate sections/rows, malformed CSV, secrets,
email-like text, individual identifiers, individual business rows, missing
helpers, or any export that does not stay within catalog and aggregate-only
circles evidence.

## Decision boundary

The CSV determines whether hidden, null, or unknown status rows require a data
migration, status mapping, continued support, or a product decision; whether
the broad `USING true` policy is a security broadening; and whether the extra
DELETE policy is equivalent, broadening, or a human-decision-required legacy
surface. It does not authorize a constraint or policy change.

## Reviewed proposal package

The offline packet confirms eight active and 53 deleted circles, with zero
hidden, null, or unknown statuses. The reviewed broad SELECT policy currently
exposes 61 circles anonymously; the expected predicate exposes seven, so the
54-row narrowing is intentional security remediation rather than a data
migration decision.

- [Execution preflight](reconciliation/circles-visibility-production-execution-preflight.sql)
  is catalog-and-aggregate read-only and must be rerun immediately before any
  execution.
- [Proposal](reconciliation/circles-visibility-production-proposal.sql) is
  `UNEXECUTED`, `PRODUCTION_REVIEW_PROPOSAL`, and not a migration or
  migration-history repair.
- [Postflight](reconciliation/circles-visibility-production-postflight.sql) is
  catalog-and-aggregate read-only and confirms the three-object convergence.

The transaction adds and validates a narrowed replacement status constraint,
then swaps names; replaces `circles_select_public` with the exact
`can_access_public_circle(id)` plus owner/staff predicate; and drops exactly
`circles_delete_owner_or_staff`. It does not mutate circles, memberships, posts,
comments, reports, media, notifications, table grants, Wave 1 functions, or
helper bodies/ACLs. Local Docker-only simulation reproduced the reviewed drift
with eight active and 53 deleted synthetic rows, converged all three objects,
retained owner/staff reads and supported soft delete, denied direct hard DELETE,
and left Wave 1 contracts unchanged. No production or cloud operation occurred.

## Production execution record

The original divergent evidence, one-shot preflight, reviewed proposal, and
local Docker-only simulation remain preserved above. The approved proposal was
sent once without modification, committed as one transaction, and immediately
passed its read-only postflight.

- `circles_status_check`: `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED` with exactly
  `active` and `deleted` accepted.
- `circles_select_public`: `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED` with the
  reviewed public-helper, owner, and staff predicate for `anon,authenticated`.
- `circles_delete_owner_or_staff`:
  `PRODUCTION_REMOVED_POSTFLIGHT_VERIFIED`; no replacement direct hard-DELETE
  policy exists. The product decision remains
  `REMOVE_DIRECT_HARD_DELETE_POLICY`.
- RLS, table owner, table ACL, helper hashes, and the Wave 1 function contracts
  remained unchanged. No circle rows or other production data were mutated.

The read-only smoke returned seven anonymously visible active circles, zero
anonymously visible deleted circles, and one inaccessible active circle.
Owner/staff read branches and the supported soft-delete update policy remain;
no production write probe or fixture was created. This closes Wave 3A only.
The wider reconciliation remains `NO_GO`.

## Rollback and incident stance

| Operation | Classification | Incident stance |
| --- | --- | --- |
| Add/validate/swap the status constraint | Transactionally reversible | The reviewed transaction rolls back atomically before commit. After commit, use a reviewed secure forward fix; do not reintroduce `hidden` without a new product decision. |
| Replace the broad SELECT policy | Secure forward-fix preferred | Never restore `USING true` as emergency rollback. Investigate any denied access and apply a narrowly reviewed forward fix. |
| Drop direct hard DELETE | Manual incident decision required | Never restore broad direct DELETE merely to reproduce insecure state. A future permanent-deletion workflow needs separate server-only design and approval. |

No migration-history change is permitted during incident handling. Wave 1 and
Wave 3A are `PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED`. The next safe action is
the separate W6 operational-guardrails read-only preflight; it authorizes no
repair SQL.
