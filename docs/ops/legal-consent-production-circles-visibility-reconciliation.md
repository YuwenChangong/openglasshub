# Circles Visibility Reconciliation Preflight

Status: `ONE_SHOT_PREFLIGHT_PACKET_READY`. This is the next dedicated
`CIRCLES_VISIBILITY_FOUNDATION` review wave. Wave 1 remains
`PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED`; this packet does not reopen it.
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
update; the extra DELETE policy cannot be classified as safe or removable until
the exported role/predicate evidence is reviewed.

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

This task does not authorize a circles constraint change, policy change, data
migration, deployment, migration repair, `db push`, or Wave 2 execution. No
proposal SQL is authored by this preflight packet.
