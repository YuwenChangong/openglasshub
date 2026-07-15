# Production Reconciliation Wave 1 Review

Status: `BLOCKED_PENDING_CIRCLE_ACCESS_PREREQUISITE_EXECUTION_AND_POSTFLIGHT`.
Wave 1 remains `PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED`; its approved
production attempt proved `public.can_access_public_circle(uuid)` is absent,
and the function-only prerequisite is now authored and locally validated; overall production
reconciliation remains `NO_GO`.

This packet combines the already reviewed Wave 1A and Wave 1B evidence without
expanding scope. It is not a canonical migration, migration-history repair,
deployment, or authorization to run SQL against production. No Supabase cloud
operation, production SQL, production data operation, or deployment occurred.

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

## Execution-ready packet

- [Fresh preflight](reconciliation/legal-consent-production-wave1-preflight.sql): read-only exact-signature catalog, body-hash, overload, ACL, and safely queryable dependency export.
- [Unexecuted proposal](reconciliation/legal-consent-production-wave1-proposal.sql): one transaction, the two reviewed functions only, no migration-history operation.
- [Read-only postflight](reconciliation/legal-consent-production-wave1-postflight.sql): exact metadata, ACL, overload, and body-hash verification after a future approved execution.
- [Execution checklist](reconciliation/legal-consent-production-wave1-execution-checklist.md): human approvals, fresh-preflight gates, stop conditions, and secure-forward-fix guidance.

The proposal first converges the post-view body and metadata, removes its broad
permissions, then grants only anon/authenticated. It then converges notification
metadata without replacing its exact body, removes broad permissions, and grants
only service_role. In-transaction assertions abort the complete packet on any
overload, metadata, ACL, or unexpected direct-grantee mismatch.

## Prerequisite stop condition

Production execution must not retry until the separately approved
[circle-access prerequisite proposal](reconciliation/can-access-public-circle-proposal.sql)
has completed its [read-only postflight](reconciliation/can-access-public-circle-postflight.sql).
The one-shot preflight proved direct helper dependencies; the `hidden` status
constraint, broad public SELECT policy, and extra delete policy remain separate
circles reconciliation objects. The missing function was encountered before
commit, so both Wave 1 target functions remained unchanged. No Stage 2 retry is
authorized by this document.

## LOCAL_DOCKER_ONLY validation

The disposable normalized replay database reproduced both reviewed production
drifts in one transaction: notification metadata/ACL drift and post-view
body/ACL drift. The combined proposal then converged both exact expected body
hashes, owners, SECURITY DEFINER flags, search paths, and role matrices; the
transaction rolled back afterward. Focused offline tests separately prove the
fixed moderation writer/RPC surface and visible/pending/inaccessible post-view
behavior. No unrelated object or Wave 2 object was included.

## Required human decision

Before any future execution, a named human operator must attach a fresh
production preflight, confirm the target and reviewed observed hashes/ACLs,
obtain database/security and application review, confirm backup/restore and
incident ownership, and explicitly approve this exact SQL file. Preflight drift
or a postflight mismatch is a STOP condition. After any committed issue, use a
reviewed secure forward-fix; never restore `PUBLIC EXECUTE` or blindly restore
the known-broadened post-view body.
