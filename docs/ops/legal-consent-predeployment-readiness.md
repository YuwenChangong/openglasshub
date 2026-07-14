# Legal Consent Pre-deployment Readiness Gate

Status: `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PREDEPLOYMENT_NO_GO`.

Baseline: `feature/legal-trust-consent-foundation-v1` at `e7572fe1d6696d7d5f212a5f9b9d131a7056ab26`. This is an offline source gate only. It did not authorize or perform a main merge, a migration, a configuration change, preview, staging, or production operation.

## Source completion

| Gate | Result |
| --- | --- |
| Phase 4A1 API trace inventory | `66/66` complete |
| Phase 4A2 representatives | `5/5` complete |
| Phase 4B consent-required mutations | `37/37` integrated; zero remaining |
| Profile/service-role audit | `49/49` passing |
| Authored forward migrations | `0/12` executed |

`npm run test:legal-consent-predeployment-readiness` is deterministic and offline. It asserts the exact migration list, dependency order, expected object fragments, no destructive DDL or broad grants in the scoped files, source guard totals, active policy bundle declaration, public-contact symbols, and the SQL blocker set. It never reads a secret value or calls a service.

## Exact forward migration inventory

Every item is `UNEXECUTED`. Apply only in this order, after the blockers and Stage 0 below are satisfied.

| # | Filename | Purpose / affected objects | Earlier dependency | Change class / rollback |
| --- | --- | --- | --- | --- |
| 1 | `20260703_moderation_action_notifications.sql` | `forum_notifications` type constraint; `insert_forum_notification` | Existing notification schema and triggers | Constraint/function; forward fix required |
| 2 | `20260712_legal_policy_acceptances.sql` | `legal_policy_acceptances`; user/bundle uniqueness; bundle-time index; update trigger; own-row RLS; `record_current_legal_policy_acceptance` RPC | Existing `set_updated_at` and `auth.users` | Schema/history/function; data rollback unsafe |
| 3 | `20260713_comment_creation_circle_authorization.sql` | `can_create_comment_target`; `comments_insert_self` | Existing comment/post/circle schema | RLS/function; forward fix preferred |
| 4 | `20260713_comment_reaction_visibility_authorization.sql` | `can_access_comment_reaction_target`; reaction SELECT/INSERT/UPDATE/DELETE policies | Existing comment/post/circle/reaction schema | RLS/function; forward fix preferred |
| 5 | `20260713_comment_read_circle_visibility_authorization.sql` | Public-circle/comment-read predicates; posts/comments/reactions read policies | Existing visibility schema | RLS/function; forward fix preferred |
| 6 | `20260713_forum_posts_circle_authorization.sql` | Posts INSERT/UPDATE/DELETE policies; `increment_post_view_count` | #5 public-circle predicate | RLS/function; forward fix required |
| 7 | `20260713_forum_report_target_authorization.sql` | `can_create_user_report_target`; `reports_insert_self` | #5 public-circle predicate | RLS/function; forward fix required |
| 8 | `20260713_post_bound_media_provenance.sql` | Canonical post-media key/provenance predicates; post-media INSERT/UPDATE policies | Existing post-media schema | RLS/function; forward fix preferred |
| 9 | `20260714_circle_cover_public_visibility_authorization.sql` | Circle-cover predicate; circles and storage object read policies | #5 public-circle predicate | RLS/storage policy; forward fix preferred |
| 10 | `20260715_post_media_delivery_visibility_authorization.sql` | Post-media delivery predicate; post-media and storage object read policies | #5 and #8 predicates | RLS/storage policy; forward fix preferred |
| 11 | `20260716_profile_media_delivery_authorization.sql` | Profile-media delivery predicate; avatar/banner storage read policies | Existing profile-media storage schema | RLS/storage policy; forward fix preferred |
| 12 | `20260717_security_definer_execute_hardening.sql` | Exact EXECUTE ACLs for three existing privileged functions; no body, schema, data, or policy change | #11 and reviewed runtime writer | ACL only; forward fix if live verification disagrees |

The chain carries RLS policy replacement, `SECURITY DEFINER` functions, storage policy changes, constraints, an index, a trigger, and consent history. A migration runner may execute a file transactionally, but policy/function replacement can change runtime availability during the operation. No direct rollback SQL is approved for access control, media provenance, or acceptance history. Revert the application only where safe, then use a reviewed forward-fix migration.

## Static SQL result: resolved in source

Three `SECURITY DEFINER` functions in `public` have no explicit revocation of PostgreSQL's default `PUBLIC EXECUTE` grant in their authored migration:

1. `insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)` in migration 1.
2. `increment_post_view_count(uuid)` in migration 6.
3. `can_create_user_report_target(text, uuid)` in migration 7.

The source architecture blocker is resolved by `20260717_security_definer_execute_hardening.sql`, still `UNEXECUTED`. It revokes `PUBLIC` from all three exact signatures before applying these source-proven grants:

| Function | Final direct grantee(s) | Reason |
| --- | --- | --- |
| `public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)` | `service_role` only | The authenticated moderator RPC path was removed. The server-only writer captures the verified moderator actor after `requireModerator` and current-consent success, accepts only four typed commands, lazily invokes this one fixed RPC after the authorized primary action, and never exposes generic RPC/table access. Existing notification triggers are `SECURITY DEFINER` database callers, not client-facing RPC callers. |
| `public.increment_post_view_count(uuid)` | `anon`, `authenticated` | Public post pages invoke the fixed view-count RPC. Its SQL only increments a published, moderation-published post in an accessible public circle; `PUBLIC` is not used as a substitute for `anon`. |
| `public.can_create_user_report_target(text, uuid)` | `authenticated` only | It is a boolean predicate inside `reports_insert_self`, which is itself `TO authenticated` and also requires `reporter_id = auth.uid()` plus neutral report state. It cannot independently create a report. |

All three retain explicit trusted source search paths: notification uses `public, pg_temp`; post-view and report-target helpers use `public`. Their bodies use fixed SQL/function references and no request-controlled dynamic SQL, schema, table, function, or actor selection. Live verification must still inspect function ACLs and the target schema's CREATE privileges before a non-production run; this document does not claim live database validation.

## Offline Review Packet

The source-level moderation notification and migration 12 review, exact changed-file list, negative security review, migration checksums, and isolated non-production procedure are recorded in `docs/ops/legal-consent-notification-rpc-offline-review.md`. It is documentation only: explicit human approval, target identity verification, and live non-production validation remain required before any execution.

## Local Replay Blocker

The first LOCAL_DOCKER_ONLY clean replay at commit `5082063d64ce0705ee0bc609c374cac163f48536` stopped before migration 12 because multiple historical files share the same CLI migration version. The first collision is the three `20260525_*` files, which produce `SQLSTATE 23505` on `supabase_migrations.schema_migrations.version`. The complete failure record is in `docs/ops/legal-consent-local-supabase-verification.md`.

The forensic audit found 43 well-formed migration filenames and ten duplicate-version groups (`20260525`, `20260603`, `20260604`, `20260605`, `20260606`, `20260607`, `20260611`, `20260612`, `20260620`, and `20260713`). Git provenance cannot prove which duplicate file names were ever recorded remotely, so the result is `REMOTE_HISTORY_CONFIRMATION_REQUIRED`, not a safe repository correction. The exact duplicate checksums, provenance, dependency analysis, and an operator-only read-only `supabase_migrations.schema_migrations` query are in `docs/ops/legal-consent-local-supabase-verification.md`.

Do not rename or reorder historical migration files as an ad hoc local fix. A separately reviewed, upgrade-safe migration-history remediation plan is required after the read-only history confirmation and before any fresh local replay, non-production migration, or production migration operation.

## Future execution sequence

### Stage 0: operator readiness

1. Verify Supabase project reference, organization, region, and environment name through an operator-controlled interface; stop on any mismatch.
2. Verify a tested backup and restore runbook, recovery point, and incident owner; stop if restoration has not been rehearsed.
3. Verify the privileged migration identity exists only in the approved operator path and is never in browser configuration or logs; stop if identity/scope is uncertain.
4. Make an explicit maintenance and availability decision for RLS/storage-policy replacement; stop if untrusted traffic cannot be prevented between migration steps.
5. Review the exact three signatures and least-privilege matrix in migration 12; stop until explicit human approval is recorded.

### Stage 1: non-production schema/policy verification

Apply migrations 1 through 12 in the inventory order to an isolated non-production target. After migration 12, inspect each function ACL to verify `PUBLIC` has no EXECUTE and only the matrix roles above have direct EXECUTE; then run notification creation, post-view count, user-report target, RLS, and consent-guard smoke checks. Stop on runner failure, unexpected function signature, missing expected policy/index/constraint/trigger, unexpected grant, RLS disabled state, policy-count mismatch, or route behavior that differs from source expectations. Production migration is prohibited until this stage and every later stage pass.

### Stage 2: runtime configuration and smoke

Configure approved non-production runtime values, deploy only to an isolated preview/equivalent environment, then run read-only smoke checks. Stop on a missing server-only value, binding failure, failed Turnstile/R2 path, wrong Supabase target, or policy/RPC mismatch.

### Stage 3: authenticated consent matrix

Use disposable non-production accounts and run IDs. Stop on a response other than the specified `401`, exact `403 LEGAL_CONSENT_REQUIRED`, or sanitized `503 LEGAL_CONSENT_UNAVAILABLE`; stop if a denial causes a downstream effect or current consent bypasses authorization.

### Stage 4: production decision

Production needs every checklist item below, explicit human approval for a main merge, and a separate explicit approval for production migration/deployment. Auto-deploy from main is not approval.

## Environment and configuration readiness

Values are not read or printed by this gate. “Static” means the source declares the name, not that an operator has set a value.

| Name / binding | Scope | Required environment | Static state | Missing behavior / owner |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Server | Any server API environment | Names found | Supabase client unavailable; platform operator |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | Public browser | Browser auth/storage environments | Names found | Browser auth/storage unavailable; platform operator |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Consent persistence | Name found | Consent repository must return sanitized `503`; security owner |
| `SESSION` | Cloudflare KV binding | Session paths | Binding declared | Session-dependent path unavailable; Cloudflare operator |
| `MODERATION_ASSETS` | Cloudflare R2 binding | Moderation asset paths | Binding declared | Related media path fails closed; Cloudflare operator |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`, `PUBLIC_R2_PUBLIC_BASE_URL` | Server except public base URL | Media upload/delivery | Names found | Storage/signing unavailable; storage owner |
| `TURNSTILE_SECRET_KEY`, `PUBLIC_TURNSTILE_SITE_KEY` or `ASTRO_PUBLIC_TURNSTILE_SITE_KEY`, `UPLOAD_TURNSTILE_MODE` | Server plus public site key | Challenge-enabled upload paths | Names found | Upload guard fails closed; security owner |
| `RATE_LIMIT_SALT` | Server only | Rate-limited writes | Name found | Write path fails closed; security owner |
| `OPENAI_API_KEY` and moderation feature configuration | Server only | Only when provider/features enabled | Names found | Configured provider fail mode applies; moderation owner |
| `PUBLIC_LEGAL_OPERATOR_NAME`, `PUBLIC_SUPPORT_EMAIL`, `PUBLIC_ABUSE_EMAIL`, `PUBLIC_PRIVACY_EMAIL`, `PUBLIC_IP_EMAIL` | Public | Public launch | Names found, values unresolved | Contact page renders pending state; legal/operations owner |
| `LEGAL_POLICY` bundle/version | Server-owned source | All environments | `2026-07` asserted | Guard uses server bundle; legal owner manages reviewed revision |

No direct runtime mail-provider secret is evidenced in the repository. Verification-email delivery is a Supabase operator configuration concern and needs dashboard-side verification, not an invented repository value.

## Legal and operator blockers

All five public contact symbols remain unresolved until real launch values are supplied. `src/pages/contact/index.astro` is the route that reads and renders them as `待配置` / `pending configuration`, not as a hidden or fabricated address. The Terms, Privacy, Guidelines, and shared footer expose legal navigation to that contact route but do not read the values directly. They cover operator identity, support, abuse/safety, privacy, account-deletion routing, and intellectual-property complaints.

Qualified review of the actual bilingual Terms, Privacy, Guidelines, safety, deletion, and contact content is also required before publication. Source tests cannot replace this human decision.

## Non-production matrix and residue contract

| Scenario | Required verification | Zero-residue targets |
| --- | --- | --- |
| Anonymous | Public/legal pages and auth entry points; guarded writes unavailable | No rate attempt, report/event, notification, media record/object, post/comment/circle mutation, safety/audit row, RPC/count, or external request |
| Authenticated without current consent | Consent page and consent POST work; all guarded mutations return exact `403` | Same zero-residue set, including no upload token/signature |
| Authenticated with stale consent | Renewal available; guarded writes denied until current acceptance | Inspect only exact test actor/bundle in `legal_policy_acceptances`; no other denied-operation residue |
| Authenticated with current consent | Forum, admin/moderation, profile, media, notification, and report representatives continue through ordinary authorization | Exact test records and R2 object keys must be removed and verified absent |
| Consent repository unavailable | Sanitized exact `503`; no later effect | Same zero-residue set and no provider/R2 request |
| Authorization regression | Consent never bypasses ownership, staff, safety, circle, report, provenance, or recipient isolation | No table/storage/audit/event/count/outbound effect for denied target |

Use unique run IDs and exact record/object cleanup, never broad prefixes. Evidence-backed resources include `legal_policy_acceptances`, `forum_upload_attempts`, `forum_notifications`, reports and report events, posts, comments, circles, post-media records, profile media objects, reaction/count RPC effects, safety state/events, audit rows, and R2 media objects. Confirm the deployed schema before writing any cleanup command.

## Single GO / NO-GO checklist

All items are currently false or unverified; one missing item keeps this release NO_GO.

- [ ] Migration 12 ACL changes verified in non-production; source evidence is complete but execution is prohibited pending approval.
- [ ] Exact Supabase target identity verified.
- [ ] Backup and restore process verified.
- [ ] Required server secrets and Cloudflare bindings verified without logging values.
- [ ] Five public legal/operator values supplied and rendered.
- [ ] Qualified legal review complete.
- [ ] Non-production migrations and schema/policy verification pass.
- [ ] Non-production consent/authorization smoke matrix passes.
- [ ] Denied/failed operations leave zero residue.
- [ ] Production values verified by authorized operator.
- [ ] Explicit human approval for main merge.
- [ ] Separate human approval for production migration/deployment.

Exact next approved action: perform an offline review of the server-only moderation writer and migration 12 diff, then obtain explicit approval for a later isolated non-production migration run. No migration execution or deployment is approved by this document.

No migration, database query, authentication, storage, email, preview, staging, production, merge, or deployment operation occurred while creating this package.
