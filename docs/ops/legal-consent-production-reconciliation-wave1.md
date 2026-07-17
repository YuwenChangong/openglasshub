# Production Reconciliation Wave 1 Review

Status: `PRODUCTION_RECONCILED_POSTFLIGHT_VERIFIED`. Wave 1 Stage 1 and Stage
2 committed and passed their approved postflights under execution record
`571c852861b34153885cfa4fcdbf3d8f74ba2fb4`. Overall production reconciliation
remains `NO_GO` because the remaining inventory, runtime/configuration, legal,
operator, and deployment prerequisites are still open.

This packet retains the reviewed Wave 1A and Wave 1B evidence without expanding
scope. It is not a canonical migration, migration-history repair, deployment,
or authorization for any further production SQL. The original offline review did
not contact production; the separately approved execution history is recorded
below.

## Exact scope

| Exact signature | Reviewed body evidence | Reviewed target ACL |
| --- | --- | --- |
| `public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)` | Exact body match: `96b887a7f28df54154c36a0e45790e61bd1cf6f10b96546ceafda8ac2c148fa2` remains unchanged. | PUBLIC/anon/authenticated denied; service_role allowed. |
| `public.increment_post_view_count(uuid)` | Production `c29ed210f5aa903e33323aff772130d038f72c42cd6ccae593e33dda5d87b1f2` is security-broadened; reviewed target is `5e5d6c9682a32dbb9deb7003be854eaf06700577593c7b7ac108ddecd55fed5d`. | PUBLIC/service_role denied; anon/authenticated allowed. |

No other function, table, policy, constraint, index, storage object, or Wave 2+
object is part of Wave 1.

`increment_post_view_count` keeps its fixed-object, `void`, `postgres`,
`SECURITY DEFINER`, `search_path=public` contract. The reviewed replacement adds
the missing `moderation_status = 'published'` and
`public.can_access_public_circle(post_ref.circle_id)` predicates. Its public
post-detail caller remains intentional. `insert_forum_notification` keeps its
exact body and `search_path=public, pg_temp`; the server-only moderation writer
is its only application RPC caller and requires service-role direct execution.

## Production execution record

Stage 1 created `public.can_access_public_circle(uuid)` and committed. Its
postflight found one overload, body MD5
`67b9d428d658222c17d640a50f0b3127`, owner `postgres`, `SECURITY DEFINER=true`,
`search_path=public`, and ACL `PUBLIC=false`, `anon=true`,
`authenticated=true`, `service_role=false`.

The fresh Stage 2 preflight passed. The exact approved Wave 1 transaction then
committed and its postflight passed:

| Exact signature | Production-applied structural SHA-256 | Body MD5 | Verified ACL |
| --- | --- | --- | --- |
| `public.increment_post_view_count(uuid)` | `5e5d6c9682a32dbb9deb7003be854eaf06700577593c7b7ac108ddecd55fed5d` | `26492d2c8a4e9d85533f6ef0d2184789` | PUBLIC/service_role denied; anon/authenticated allowed. |
| `public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)` | `96b887a7f28df54154c36a0e45790e61bd1cf6f10b96546ceafda8ac2c148fa2` | `b23bd786e278a0071ae7759b29365df6` | PUBLIC/anon/authenticated denied; service_role allowed. |

Both functions have one overload, return `void`, are owned by `postgres`, and
remain `SECURITY DEFINER`. Their verified search paths are `public` for the view
counter and `public, pg_temp` for notifications.

## Production smoke record

Negative post-count and notification authorization smokes passed: unpublished
and inaccessible-circle posts did not increment; unrelated counts stayed
unchanged; anon and authenticated notification RPC calls were denied; and the
rolled-back service-role no-op invocation passed. Recipient isolation remains
`recipient_id = auth.uid()`.

The valid public moderation-published post increment is
`DEFERRED_NO_ELIGIBLE_PRODUCTION_CANDIDATE`. Production had no naturally
eligible post. No fixture will be created solely for this smoke: the expected
body hashes are verified, negative authorization behavior passed in production,
and positive behavior passed in `LOCAL_DOCKER_ONLY`; creating and cleaning a
fixture would add unnecessary write and residue risk. A naturally occurring
eligible post may be tested later only through a separately approved smoke
operation. This is a residual verification note, not a Wave 1 rollback
condition.

## Historical execution packet

- [Fresh preflight](reconciliation/legal-consent-production-wave1-preflight.sql): read-only exact-signature catalog, body-hash, overload, ACL, and safely queryable dependency export.
- [Unexecuted proposal](reconciliation/legal-consent-production-wave1-proposal.sql): one transaction, the two reviewed functions only, no migration-history operation.
- [Read-only postflight](reconciliation/legal-consent-production-wave1-postflight.sql): exact metadata, ACL, overload, and body-hash verification after a future approved execution.
- [Execution checklist](reconciliation/legal-consent-production-wave1-execution-checklist.md): human approvals, fresh-preflight gates, stop conditions, and secure-forward-fix guidance.

The proposal first converges the post-view body and metadata, removes its broad
permissions, then grants only anon/authenticated. It then converges notification
metadata without replacing its exact body, removes broad permissions, and grants
only service_role. In-transaction assertions abort the complete packet on any
overload, metadata, ACL, or unexpected direct-grantee mismatch.

## Historical prerequisite stop condition

Production execution did not retry until the separately approved
[circle-access prerequisite proposal](reconciliation/can-access-public-circle-proposal.sql)
has completed its [read-only postflight](reconciliation/can-access-public-circle-postflight.sql).
The one-shot preflight proved direct helper dependencies; the `hidden` status
constraint, broad public SELECT policy, and extra delete policy remain separate
circles reconciliation objects. The missing function was encountered before
commit, so both Wave 1 target functions remained unchanged at that time. Stage
1 and the later separately approved Stage 2 execution are recorded above; no
further Wave 1 SQL is authorized by this document.

## LOCAL_DOCKER_ONLY validation

The disposable normalized replay database reproduced both reviewed production
drifts in one transaction: notification metadata/ACL drift and post-view
body/ACL drift. The combined proposal then converged both exact expected body
hashes, owners, SECURITY DEFINER flags, search paths, and role matrices; the
transaction rolled back afterward. Focused offline tests separately prove the
fixed moderation writer/RPC surface and visible/pending/inaccessible post-view
behavior. No unrelated object or Wave 2 object was included.

## Remaining decisions

The remaining circle drift is still open: `circles_status_check` allows
`hidden`, `circles_select_public` uses `USING true`, and
`circles_delete_owner_or_staff` remains present. The next human decision is to
review and approve a separate read-only preflight for the next unresolved repair
wave. Wave 2, deployment, migration-history work, and a positive production
smoke are not approved by this record.
