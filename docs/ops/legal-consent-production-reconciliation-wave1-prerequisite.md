# Wave 1 Circle Access Prerequisite

Status: `PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED`. The separately approved Stage
1 transaction committed and its postflight verified
`public.can_access_public_circle(uuid)` with one overload, body MD5
`67b9d428d658222c17d640a50f0b3127`, owner `postgres`,
`SECURITY DEFINER=true`, `search_path=public`, and ACL `PUBLIC=false`,
`anon=true`, `authenticated=true`, `service_role=false`.

The later Wave 1 positive public-post smoke is
`DEFERRED_NO_ELIGIBLE_PRODUCTION_CANDIDATE`. No fixture was created because no
naturally eligible post existed; the expected body hashes, production negative
authorization smokes, and `LOCAL_DOCKER_ONLY` positive behavior remain the
recorded evidence.

## Failure evidence

The approved Wave 1 transaction from commit
`7387e9e8abaf0033c3e069b6b3eabc5b240af7ee` failed before `COMMIT` with:

`function public.can_access_public_circle(uuid) does not exist`

Rollback verification showed the two Wave 1 functions retained their reviewed
production hashes and broad ACLs. The missing prerequisite, not a Wave 1 body
or ACL mismatch, prevented that original execution. The prerequisite was later
applied under separate approval, after which the fresh Wave 1 preflight and
Stage 2 transaction committed and passed postflight.

## Authoritative local contract

The expected function is source-proven by
`supabase/migrations/20260713_comment_read_circle_visibility_authorization.sql`
and the verified local normalized replay catalog:

- Signature: `public.can_access_public_circle(target_circle_id uuid)`.
- Returns: `boolean`.
- Language: `sql`; volatility: `stable`; strict: `false`; leakproof: `false`;
  parallel safety: `unsafe`.
- Owner: `postgres`; `SECURITY DEFINER`; `search_path=public`.
- ACL: PUBLIC denied; anon and authenticated EXECUTE allowed; owner retained.
- Body: `exists` over the exact `public.circles` row where `id` equals the
  supplied id, `status = 'active'`, the lowercased slug is not
  `rls-test-circle`, `rls-test`, or `test-circle`, and the lowercased name does
  not contain `rls test`.

The function references only `public.circles.id`, `.status`, `.slug`, and
`.name`, plus built-in `exists`, `lower`, and `coalesce`. It uses no dynamic
SQL, caller-selected relation/column, membership lookup, data mutation, or
external call. It returns only a boolean. `NULL`, a missing circle, an inactive,
`hidden`, `deleted`, or canonical QA/test-hidden circle yield `false`; an
active canonical public circle yields `true`. The schema has no private-circle
membership relation, so authentication and membership do not alter this
function's result.
The read-only predicate is safe for its source-proven SECURITY DEFINER use only
with the exact fixed `public` search path and the reviewed ACL.

Exact source-proven definition:

    create or replace function public.can_access_public_circle(target_circle_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select exists (
        select 1
        from public.circles as circle_ref
        where circle_ref.id = target_circle_id
          and circle_ref.status = 'active'
          and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle')
          and lower(coalesce(circle_ref.name, '')) not like '%rls test%'
      );
    $$;

The expected ACL is `REVOKE ALL ... FROM public`, followed only by EXECUTE
grants to `anon` and `authenticated`; the owner remains `postgres`.

## Dependency boundary review

The one-shot production CSV is complete: 32 rows, manifest present, all seven
sections present, and no malformed, secret-like, email-like, auth-user, or
business-row evidence. It proves the target signature is absent with zero
overloads; `public.circles`, its id/status/slug/name columns and types, RLS
state, owner/ACL, and roles `postgres`, `anon`, and `authenticated` match
the verified local contract.

The following production differences remain real reconciliation work but do
not block this exact function:

- `circles_status_check` additionally permits `hidden`. The helper has the
  fixed `status = 'active'` predicate, so it compiles against that constraint
  and returns false for hidden rows. Narrowing the constraint is neither
  necessary nor safe here because production may contain hidden rows. Status
  reconciliation remains `SEPARATE_RECONCILIATION_REQUIRED`.
- `circles_select_public` uses `USING true`. The helper is
  `SECURITY DEFINER`, has a fixed `search_path=public`, reads only the fixed
  `public.circles` relation, and applies its own predicate. The broad SELECT
  policy therefore does not change the helper's boolean result and creating
  the helper does not broaden it. The policy remains
  `SEPARATE_SECURITY_RECONCILIATION_REQUIRED`, including as an independent
  public-visibility blocker.
- `circles_delete_owner_or_staff` is an extra DELETE policy. It has no effect
  on function compilation, fixed SELECT behavior, boolean output, caller ACL,
  or the post-view RPC. It remains `HUMAN_REVIEW_OR_LATER_WAVE`.

These objects are surrounding domain drift, not direct compile or runtime
security dependencies of the helper. The separately authored
`20260714_circle_cover_public_visibility_authorization.sql` is the later
source-backed policy reconciliation; it is not included in this prerequisite.

## Local-only simulation

The disposable normalized local replay has the exact expected catalog contract
and deterministic definition hash
`7a589d45d7e5896e4d4c2198a3f6346a96bfe86637714df67cd66fb6a2e3b579`.
Inside a rolled-back local transaction, the simulation removes only this
signature, retains the production-compatible `hidden` status constraint,
retains `circles_select_public USING true`, and retains the extra delete
policy. The existing exact Wave 1 proposal then fails only for the missing
helper. Applying the function-only proposal and postflight yields the expected
body hash, owner, `SECURITY DEFINER`, search path, and ACL; active circles are
allowed while hidden, deleted, NULL, and nonexistent circles are denied.
Calling as `anon` yields the same boolean result despite the broad policy.
The complete existing Wave 1 proposal and postflight then converge, while the
three surrounding drift definitions remain unchanged. The transaction rolls
back all local test state. These are LOCAL_DOCKER_ONLY checks, not evidence of
production compatibility.

## Dependency evidence and gate

The historical forward-reconciliation manifest preserves evidence that the
function and its anon/authenticated grants were missing in production, and
labels the `circles` dependency `ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED`.
Historical migration presence was not proof that production contained the
required table, columns, roles, RLS state, or compatible constraints.

The original multi-result packet remains available for audit history, but is
deprecated for manual Dashboard export because the Dashboard conveniently
exports only one result set:

- [can-access-public-circle-preflight.sql](reconciliation/can-access-public-circle-preflight.sql)

Use the one-shot packet for production evidence instead:

- [can-access-public-circle-preflight-one-shot.sql](reconciliation/can-access-public-circle-preflight-one-shot.sql)

It returns one unified table with stable columns
`packet_version`, `section_order`, `section`, `row_key`,
`object_schema`, `object_name`, `attribute`, `value`, and
`evidence_status`. It includes a manifest and all seven required sections,
including deterministic MISSING sentinels, so a truncated export cannot be
mistaken for complete evidence.

## One-run operator process

1. Open the one-shot SQL file.
2. Copy all content.
3. Run it once in the confirmed production Dashboard SQL Editor.
4. Export the single complete result as CSV.
5. Save it exactly as
   `C:\\Users\\1\\Downloads\\can-access-public-circle-preflight.csv`.
6. Resume the fully offline review with:

   `node scripts/validate-can-access-public-circle-preflight.mjs "C:\\Users\\1\\Downloads\\can-access-public-circle-preflight.csv"`

The validator requires the exact file name, packet version, manifest, all
seven sections, explicit sentinels, unique rows, and catalog-only content. It
fails closed for malformed, truncated, duplicate, secret-like, email-like,
auth-user, or business-row evidence.

The historical one-shot result had to prove the function was absent with no
unexpected overload and that `public.circles`, its four referenced columns and types,
RLS state, and roles `anon`, `authenticated`, and `postgres` are present
and compatible. A difference is a STOP condition only when it is a direct
compile or runtime-security dependency of the fixed function. The known
constraint and policy differences above remain explicitly tracked surrounding
reconciliation work.

## Historical prerequisite packet

- [can-access-public-circle-proposal.sql](reconciliation/can-access-public-circle-proposal.sql)
- [can-access-public-circle-postflight.sql](reconciliation/can-access-public-circle-postflight.sql)

The approved proposal contained only the exact helper creation, owner,
`SECURITY DEFINER` mode, fixed search path, explicit privilege revocation, and
anon/authenticated EXECUTE grants. It changed no table, policy,
constraint, data, or existing Wave 1 target.

## Two-stage production sequence

Stage 1 committed after its fresh one-shot prerequisite preflight and approved
transaction, then passed its read-only postflight.

Stage 2 was separately approved work: the combined Wave 1 preflight was rerun,
the exact Wave 1 proposal committed, and its postflight passed. Nothing in this
historical sequence approves further production work.

If a future prerequisite attempt fails, roll back its transaction. After a
committed failure, use a reviewed secure forward-fix; never broaden PUBLIC
EXECUTE, repair migration history, or add unrelated authorization objects.
