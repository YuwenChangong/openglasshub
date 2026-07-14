# Wave 1 Circle Access Prerequisite

Status: `ADDITIONAL_PREFLIGHT_REQUIRED`. No production SQL was executed for
this prerequisite package. No proposal or postflight has been authored because
the existing offline production export does not prove the direct production
dependencies of `public.can_access_public_circle(uuid)`.

## Failure evidence

The approved Wave 1 transaction from commit
`7387e9e8abaf0033c3e069b6b3eabc5b240af7ee` failed before `COMMIT` with:

`function public.can_access_public_circle(uuid) does not exist`

Rollback verification showed the two Wave 1 functions retained their reviewed
production hashes and broad ACLs. The missing prerequisite, not a Wave 1 body
or ACL mismatch, prevented execution. The Wave 1 postflight was therefore not
run.

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
external call. It returns only a boolean. `NULL`, a missing circle, an inactive
circle, or a canonical QA/test-hidden circle yield `false`; an active canonical
public circle yields `true`. The schema has no private-circle membership
relation, so authentication and membership do not alter this function's result.
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

## Local-only simulation

The disposable normalized local replay has the exact expected catalog contract
and deterministic definition hash
`7a589d45d7e5896e4d4c2198a3f6346a96bfe86637714df67cd66fb6a2e3b579`.
Inside a rolled-back local transaction, removing only this signature makes the
existing exact Wave 1 proposal fail with the same missing-function message;
the rollback restores the verified local baseline. The existing combined Wave 1
simulation continues to converge when the prerequisite is present. These are
LOCAL_DOCKER_ONLY checks, not evidence of production compatibility.

## Dependency evidence and gate

The existing forward-reconciliation manifest proves the function and its
anon/authenticated grants are missing in production, but labels the `circles`
dependency `ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED`. Historical migration
presence is not proof that production contains the required table, columns,
roles, RLS state, or compatible constraints.

Run the exact read-only packet before considering a proposal:

- [can-access-public-circle-preflight.sql](reconciliation/can-access-public-circle-preflight.sql)

It must prove the function remains absent with no unexpected overload and that
`public.circles`, its four referenced columns and types, relevant constraints,
RLS state, circle policies, and roles `anon`, `authenticated`, and `postgres`
are present and compatible. Any missing or divergent dependency is a STOP
condition. The packet returns catalog data only; it reads no business rows,
auth-user rows, credentials, or settings.

## Two-stage production sequence

Stage 1 is not approved: attach fresh prerequisite preflight output, obtain
database/security review, and decide whether the exact function-only proposal
is eligible. The prerequisite proposal and postflight do not yet exist. If
approved later, author and validate only those two exact function-scoped files,
then seek separate execution approval.

Stage 2 is separately approved work: rerun the combined Wave 1 preflight,
obtain a new explicit approval, then execute the existing exact Wave 1 proposal
and postflight. Stage 2 must never start automatically after Stage 1.

If a future prerequisite attempt fails, roll back its transaction. After a
committed failure, use a reviewed secure forward-fix; never broaden PUBLIC
EXECUTE, repair migration history, or add unrelated authorization objects.
