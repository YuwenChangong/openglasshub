# Moderation Notification RPC Offline Review

Status: offline source and static-SQL review complete. This is not qualified legal review, human security approval, or live database validation.

Reviewed range: `d8a8f7d448bc9866a2e61524c1e048544414b848..99e220a96bbac5155b88af117a625d10e60aeaf8`

Reviewed release commit: `99e220a96bbac5155b88af117a625d10e60aeaf8`

## Scope

The reviewed commit changes exactly these files:

```text
docs/ops/legal-consent-api-ordering-audit.md
docs/ops/legal-consent-predeployment-readiness.md
docs/ops/legal-trust-policy-management.md
package.json
scripts/profile-service-role-audit.cjs
scripts/test-legal-consent-predeployment-readiness.mjs
scripts/test-legal-consent-service-role-audit.cjs
scripts/test-moderation-notification-writer.mjs
scripts/test-reports.mjs
scripts/test-user-safety-privilege-boundary.mjs
scripts/test-user-safety.mjs
scripts/verify-forum-permissions.cjs
src/lib/server/moderation-notifications.server.ts
src/lib/server/reports.server.ts
src/lib/server/user-safety.server.ts
src/pages/api/admin/reports/[id]/action.ts
src/pages/api/admin/users/[id]/ban.ts
src/pages/api/admin/users/[id]/clear-warning.ts
src/pages/api/admin/users/[id]/suspend.ts
src/pages/api/admin/users/[id]/unban.ts
src/pages/api/admin/users/[id]/warn.ts
supabase/migrations/20260717_security_definer_execute_hardening.sql
```

Runtime scope is limited to the server-only writer, dependency injection through `applyUserSafetyAction` and `applyAdminReportAction`, and the six staff routes. Test, audit, package-script, migration, and operations-document changes support that scope. No unrelated runtime behavior was found in the reviewed diff.

Changed runtime exports are `ModerationNotificationWriter`, `createModerationNotificationWriter`, `notifyPostModerated`, `notifyCommentModerated`, `notifyUserWarned`, and `notifyUserRestricted`. The existing exported helpers `applyUserSafetyAction` and `applyAdminReportAction` gain an optional `notificationWriter` dependency; their domain behavior is otherwise unchanged.

## Trust Boundary

```text
verified bearer
  -> requireModerator
  -> database-backed profiles.role check
  -> requireAuthenticatedLegalConsent
  -> route payload and target selection
  -> target/resource and privilege authorization
  -> primary safety/moderation/report mutation
  -> typed writer.send command
  -> lazy service-role client
  -> fixed insert_forum_notification RPC
  -> minimal boolean result and existing route response
```

`createModerationNotificationWriter` is a pure closure factory. Routes construct it after moderator authorization and legal-consent success, but it does not construct a service client or issue an RPC. The first privileged operation is inside `ModerationNotificationWriter.send`, after the relevant helper has authorized the target and reached the notification stage.

The writer is a `.server.ts` module. It reads `SUPABASE_SERVICE_ROLE_KEY` only in its internal client factory, creates no browser client, exposes no table/storage/function executor, and catches repository failures as `false` without returning raw database error text.

## Writer Commands

| Command | Recipient source | Actor source | Allowed target fields | Unsupported combinations |
| --- | --- | --- | --- | --- |
| `post_moderated` | Server-read post author from report target | `auth.user.id` after `requireModerator` | UUID `postId`; no comment/circle | Missing or non-UUID post; any comment/circle field |
| `comment_moderated` | Server-read comment author from report target | `auth.user.id` after `requireModerator` | UUID `postId` and UUID `commentId`; no circle | Missing/non-UUID post or comment; any circle field |
| `user_warned` | Route path target or report-derived target user | `auth.user.id` after `requireModerator` | No post/comment/circle | Any target ID field |
| `user_restricted` | Route path target or report-derived target user | `auth.user.id` after `requireModerator` | No post/comment/circle | Any target ID field |

The writer rejects malformed UUIDs, unsupported type values, self-recipient commands, and invalid target combinations before constructing the privileged client. `p_actor_id` is always the mandatory verified actor captured by the factory. Request bodies have no actor, recipient, RPC-name, table, schema, or notification-type field.

## Route Ordering

All six routes derive the actor as `auth.user.id` from `requireModerator`. `requireModerator` uses `getBearerToken`, `createUserClient`, `client.auth.getUser(token)`, and a database `profiles.role` lookup. It rejects missing/invalid bearer tokens and non-moderator/admin roles before returning the authenticated client.

| Route | Consent and target authorization | First persistent mutation | Notification stage |
| --- | --- | --- | --- |
| `admin/users/[id]/ban.ts#POST` | `requireAuthenticatedLegalConsent`; `applyUserSafetyAction` loads actor/target profiles and calls `authorizeUserSafetyAction` | `upsertUserSafetyState`, then `insertUserSafetyEvent` | `notifyUserRestricted` after both writes |
| `admin/users/[id]/clear-warning.ts#POST` | Same consent and hierarchy path | Conditional safety-state/event write | No notification command for `clear_warning` |
| `admin/users/[id]/suspend.ts#POST` | Same consent and hierarchy path; future timestamp is validated by transition logic | `upsertUserSafetyState`, then event | `notifyUserRestricted` after both writes |
| `admin/users/[id]/unban.ts#POST` | Same consent and hierarchy path | Conditional safety-state/event write | No notification command for `unban` |
| `admin/users/[id]/warn.ts#POST` | Same consent and hierarchy path | `upsertUserSafetyState`, then event | `notifyUserWarned` after both writes |
| `admin/reports/[id]/action.ts#POST` | `fetchAdminReportDetail`; branch-specific `applyModerationAdminAction` or `applyUserSafetyAction` authorization | Target moderation/safety mutation, then the applicable report status/event write | Post/comment commands occur after target moderation and report event. User warn/suspend/ban commands occur inside `applyUserSafetyAction` after safety writes and target-role authorization. |

For the five user routes, the path ID supplies only `targetUserId`; the body supplies a bounded reason/until value. `authorizeUserSafetyAction` denies self-targeting, missing or unknown roles, moderator-to-moderator/admin targeting, and admin-to-admin targeting before safety-state reads or writes. Report payload `action` is checked against `ALLOWED_ACTIONS`; recipient and notification type remain derived from the resolved report target and permitted branch.

Each route returns immediately on `if (!consent.ok) return consent.response` before writer-factory construction. Missing/stale consent retains the existing `403`; consent repository failure retains the existing `503`. A failed target authorization or failed primary mutation returns before `send`, so it creates no notification. Successful route response shapes and error codes are unchanged; notification delivery remains best-effort and does not expose repository errors.

## Direct RPC Removal

Full source search found `insert_forum_notification` in application runtime only in `src/lib/server/moderation-notifications.server.ts`. No authenticated bearer client directly invokes that RPC, no `createModerationNotification` compatibility helper remains, and no generic `rpc(name, args)` or privileged table path exists.

Database-side notification trigger functions remain legitimate `SECURITY DEFINER` callers: `public.notify_comment_created`, `public.notify_post_like`, and `public.notify_comment_like` use `perform public.insert_forum_notification(...)` from their fixed trigger bodies. They execute under their function owner and do not require a client-facing `anon` or `authenticated` EXECUTE grant.

## Migration 12 ACL Review

Migration: `supabase/migrations/20260717_security_definer_execute_hardening.sql`

| Exact signature | PUBLIC | anon | authenticated | Explicit grant |
| --- | --- | --- | --- | --- |
| `public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)` | revoked | revoked | revoked | `service_role` |
| `public.increment_post_view_count(uuid)` | revoked | granted | granted | no additional service-role grant |
| `public.can_create_user_report_target(text, uuid)` | revoked | revoked | granted | no additional service-role grant |

Each ACL statement is schema-qualified and overload-specific. REVOKE appears before the corresponding GRANT. The migration contains no `GRANT ALL`, no grant to `PUBLIC`, no function recreation, no table/data change, no RLS change, and no historical migration edit. It is inventory position 12, after `20260716_profile_media_delivery_authorization.sql`, and remains UNEXECUTED.

`increment_post_view_count` is called by `safeIncrementPostViewCount` from the public post detail page. Its current function body can update only the supplied post ID when status and moderation status are `published` and `public.can_access_public_circle(post_ref.circle_id)` holds. It cannot choose a table or column and does not broaden post reads.

`can_create_user_report_target` is a stable boolean helper called by the authored `reports_insert_self` policy, which is `TO authenticated` and separately requires `reporter_id = auth.uid()` plus neutral report state. The helper only tests target accessibility; it cannot independently insert a report. Anonymous execution is unnecessary.

## Search-Path Review

Historical definitions were reviewed directly:

| Function | Current source definition | Search path | Dynamic selection |
| --- | --- | --- | --- |
| `insert_forum_notification` | `20260703_moderation_action_notifications.sql` | `public, pg_temp` | None; fixed `public.forum_notifications` writes |
| `increment_post_view_count` | `20260713_forum_posts_circle_authorization.sql` | `public` | None; fixed `public.posts` update and `public.can_access_public_circle` call |
| `can_create_user_report_target` | `20260713_forum_report_target_authorization.sql` | `public` | None; fixed `public` relations/functions and `CASE` branches |

All three use explicit paths and schema-qualified relations/functions in their current bodies. Source search found no migration that grants CREATE on schema `public`, but schema CREATE privileges and live function ACLs cannot be proven from source alone. The isolated non-production procedure must inspect both before approval to proceed; this is an unstarted live-verification prerequisite, not a source-level finding. Migration 12 does not change any search path.

## Negative Security Review

| Attempted failure mode | Offline evidence that blocks it |
| --- | --- |
| Ordinary authenticated direct notification RPC | Migration 12 revokes `PUBLIC`, `anon`, and `authenticated`; the source has no authenticated direct caller. |
| Client imports writer or obtains service credential | Writer is server-only, and the service key appears only in the narrowly audited server module. |
| Actor or recipient override | Actor is `auth.user.id`; recipient is a path/report-target/server profile value. No payload fields populate either RPC argument. |
| Unsupported type or arbitrary targets | Closed TypeScript union plus `normalizeCommand` UUID/combination validation rejects before client construction. |
| Arbitrary RPC, table, or schema | Writer has one literal RPC and no `from`, `storage`, or `functions` API. |
| Pre-auth/pre-consent writer effect | Route source and static tests require moderator auth, consent guard, and immediate denial return before writer construction; client construction is lazy. |
| Notification after target denial or primary failure | Safety helper authorizes before safety-state writes and dispatches after writes; report helper returns on failed target moderation/safety action before dispatch. |
| Wrong overload, missing PUBLIC revoke, authenticated notification grant, unexpected grantee, or ordering drift | Readiness assertions use exact signatures, REVOKE-before-GRANT order, exact grant statements, denied-role checks, and exact 12-file inventory order. |
| Broken anonymous post views or report predicate | Existing post and report authorization tests inspect the public post route/RPC body and `reports_insert_self` RLS predicate; the migration preserves their minimal grants. |

No additional runtime, migration, caller, overload, or deterministic search-path blocker was found in this offline review.

## Automated Evidence

The following offline checks were inspected and run for this review: `test-moderation-notification-writer.mjs` verifies lazy construction, exact actor/recipient RPC arguments, rejected command cases, sanitized repository failure, all six route consent short-circuits, the full source RPC graph, and helper ordering. `test-user-safety-privilege-boundary.mjs` proves hierarchy denials make zero state/event/notification writes. `test-legal-consent-mutation-guard.mjs` proves current-consent `403` and repository-failure `503` behavior. `test-user-notifications-api-safety.mjs` verifies recipient isolation and consent-denied zero writes. `test-forum-posts-authorization.mjs` and `test-forum-reports-authorization.mjs` cover post-view and report-target/RLS behavior. `test-legal-consent-service-role-audit.cjs` rejects arbitrary RPC, table access, service-key exposure, and pre-auth writer construction. The readiness test performs exact migration 12 ACL and ordering assertions.

All reviewed tests use local fakes, static source, Vite SSR module loading, or local file hashes. No real service operation occurs.

## Isolated Non-Production Execution Packet

This procedure is documentation only. Do not execute it without explicit human approval.

### Preconditions

1. Record explicit human approval, the exact non-production Supabase project/ref, and independent proof that the target is not production.
2. Confirm backup/restore readiness, rollback or forward-fix owner, server secrets configured without printing values, clean release branch at `99e220a96bbac5155b88af117a625d10e60aeaf8`, and no unexpected migration drift.
3. Recompute and match this reviewed inventory checksum list:

```text
20260703_moderation_action_notifications.sql 2d8f4455c4acb2e32fa18f469b0690b59623f629
20260712_legal_policy_acceptances.sql 154cd44992d567b66dbab8a8ce1e5587cc57db23
20260713_comment_creation_circle_authorization.sql 2b30bd66fc22b7a3a3b3fa100c51c32c502d3766
20260713_comment_reaction_visibility_authorization.sql b4a757dd5cf51170c1e9dd7c261f13fe8cbc7556
20260713_comment_read_circle_visibility_authorization.sql 2ebf6d8bc93dca9017e38613624a5eb507e0e913
20260713_forum_posts_circle_authorization.sql 01c044e23a75004675cf6da9d1e412c016df575f
20260713_forum_report_target_authorization.sql cbc0ab2697543775cc9e40967eb66d32a977003b
20260713_post_bound_media_provenance.sql c0973150f364bd98f81c804d87b4f5fc2b00b273
20260714_circle_cover_public_visibility_authorization.sql 51c3e0957dff95742e29323bea7b307d6812f3d0
20260715_post_media_delivery_visibility_authorization.sql 4760542a23ed82340d3d628b9f947c9d3fc2090c
20260716_profile_media_delivery_authorization.sql 34b5b1139d8bc00a01a1245421f8fb92d8f1322f
20260717_security_definer_execute_hardening.sql dc621f29aef02ed79c128118c15c282a338ef24b
```

### Execution and Verification Sequence

1. Apply migrations 1 through 11 in the documented order, stopping after each logical group for expected function, policy, index, constraint, trigger, and RLS checks.
2. Apply migration 12 last. Do not deploy application code until all database verification below passes.
3. Inspect all three exact function ACLs: no `PUBLIC EXECUTE`; notification RPC service-role-only; post-view supports intended anon/authenticated calls; report-target helper supports authenticated RLS evaluation; no unexpected grantee.
4. Verify the schema `public` CREATE privilege and effective function owners/search paths. Stop on any ambiguity or unexpected capability.
5. Run isolated smoke checks: authorized moderation notification succeeds; ordinary authenticated direct notification RPC fails; missing-consent moderation creates zero notification; recipient privacy remains intact; anonymous and authenticated post views increment safely; report target eligibility and surrounding report RLS remain correct; legal-consent `403`/`503` behavior remains unchanged.
6. Check residue: no unintended notification rows, partial safety/report action, duplicate events, unexpected RPC grants, or denied-operation residue.

Stop immediately for a migration error, unexpected ACL, successful authenticated direct notification RPC, broken public view counting, changed report RLS behavior, consent-denial residue, or any target/ref ambiguity. Use the named rollback/forward-fix owner; do not improvise production changes.

## Current Readiness

- Runtime architecture review: complete offline.
- Migration 12 ACL review: complete offline.
- Migration inventory: 12/12, all UNEXECUTED.
- Static ACL blockers: 0.
- Non-production execution and live ACL verification: NOT STARTED.
- Runtime configuration verification: incomplete.
- Operator/contact values: unresolved.
- Qualified legal review: incomplete.
- Production approval: absent.

No live ACL validation, SQL/migration execution, real authentication, data operation, storage operation, deployment, or production action occurred during this review.

Overall classification: `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PREDEPLOYMENT_NO_GO`.
