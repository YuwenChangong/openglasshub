# OpenGlass Hub Legal & Trust Policy Management

## Phase 1 scope

Phase 1 adds public legal and trust content only. It covers centralized policy configuration, bilingual public policy pages, restrained public legal links, the `/register/` redirect into the combined login/register page, and offline validation for this surface.

Phase 1 does not authorize production deployment by itself. It also does not add a consent checkbox, consent persistence, database migration, RLS, authenticated gating, or mutation-route enforcement.

## Central configuration

The single source of truth is [src/lib/legal-policy.ts](/D:/OpenGlass%20Hub%20interaction-release-fresh/src/lib/legal-policy.ts).

Current platform policy values:

- Platform name: `OpenGlass Hub`
- Minimum age: `16`
- Bundle version: `2026-07`
- Terms version: `2026-07`
- Privacy version: `2026-07`
- Guidelines version: `2026-07`
- Effective date: `2026-07-12`
- Supported languages: `zh-CN`, `en`

Update these values intentionally. Versions are explicit release constants and must not be derived automatically from build time.

## Updating policy content

When updating the legal bundle:

1. Update the relevant version constant in [src/lib/legal-policy.ts](/D:/OpenGlass%20Hub%20interaction-release-fresh/src/lib/legal-policy.ts).
2. Update the effective date intentionally.
3. Revise both Chinese and English content together.
4. Keep Chinese and English meaning aligned even if wording is not literal.
5. Re-run `npm run test:legal-content` and the full regression suite.

Chinese and English parity is required for every public legal page in this phase.

## Public contact configuration

Public operator and contact configuration is read from public environment variables, not secrets:

- `PUBLIC_LEGAL_OPERATOR_NAME`
- `PUBLIC_SUPPORT_EMAIL`
- `PUBLIC_ABUSE_EMAIL`
- `PUBLIC_PRIVACY_EMAIL`
- `PUBLIC_IP_EMAIL`

These values must be genuine public launch values before launch. Do not add fake placeholders, private developer email addresses, or non-working forms.

Missing public operator/contact configuration blocks a fully ready legal launch classification. Phase 1 may be classified as configuration-required until those public values exist.

## Review requirements

Every policy revision should go through:

- product/ops review for feature accuracy
- bilingual content review for parity
- visual review on desktop and mobile
- qualified lawyer review before public launch

The `16+` rule is a platform policy, not a universal legal-compliance guarantee. Users remain subject to mandatory applicable local laws.

## Deferred follow-up phases

Phase 2:
- one combined, unchecked-by-default `16+` acknowledgement checkbox on every password login and registration attempt
- agreement to the Terms of Service and Community Guidelines, plus acknowledgement of the Privacy Policy
- separate, keyboard-accessible policy links within that one checkbox label
- frontend/auth-entry enforcement only, with no server acceptance record, localStorage proof, or cookie proof
- password recovery and resend confirmation remain recovery/verification actions, not acceptance
- policy links open without submitting or changing the current auth mode

Phase 3:
- Phase 3A now defines a versioned `legal_policy_acceptances` history table. It keeps one row per user and policy bundle, preserves old bundle rows, and reconfirms the active bundle by updating confirmation metadata only.
- Supported acceptance sources are `registration`, `login`, `policy_update`, `legacy_account_gate`, and `authenticated_callback`. Versions, minimum age, timestamps, counters, and the authenticated user identity are server-controlled.
- RLS permits an authenticated user to read only their own rows. Direct browser insert, update, and delete privileges are revoked. The authenticated API verifies the bearer identity before creating its narrowly scoped service-role repository and calling the server-only upsert RPC.
- `GET /api/legal/consent` returns only current-bundle status. `POST /api/legal/consent` accepts only `{ "accepted": true, "source": "..." }`, enforces JSON and a 1 KiB body limit, rejects client IDs/versions/timestamps, and limits current-bundle reconfirmations to one per authenticated user per minute.
- Future deployment of the write endpoint requires the existing Supabase service-role secret to be configured as the server-only `SUPABASE_SERVICE_ROLE_KEY` runtime binding. Never expose it to browser code, public configuration, logs, or documentation examples.
- The migration is committed for future release order only. It has not been run against production, staging, preview, or local Supabase. Rollback requires a reviewed database migration and must account for retained legal-history records rather than deleting them casually.
- Phase 3A intentionally does not wire the API into login/signup or the public `/legal-consent/` page. It also does not globally gate authenticated pages.

Phase 3B:
- login/signup persistence integration
- authenticated consent page and current-consent gate

Phase 3B1:
- password login records the current bundle only after Supabase returns an in-memory authenticated session; normal navigation waits for the authenticated API result.
- signup with an immediate session records source `registration`. Signup pending email confirmation records nothing and lets the first authenticated callback route to `/legal-consent/`.
- the callback checks current status, never records acknowledgement automatically, and routes missing, outdated, or unavailable status to the consent page with a sanitized internal destination.
- `/legal-consent/` supports signed-out guidance, current-status display, one combined acknowledgement, retry, and logout. It does not expose history, row IDs, tokens, or client-controlled versions.
- Phase 3B1 requires the server-only service-role runtime binding and the unapplied migration before any production write can work. Phase 3B2 remains responsible for broader session/page gating.

Phase 4:
- mutation-route enforcement
- release gate for versioned consent requirements

Do not treat Phase 1 alone as permission to deploy a full legal-compliance system.
# Phase 3B1 offline visual harness

The Phase 3B1 login, callback, and consent components accept optional typed auth, consent, and navigation adapters. Production pages do not supply them and retain the existing Supabase browser client, consent API helper, and browser navigation behavior. The adapters are not selectable through URL parameters, cookies, local storage, headers, or public environment variables.

The test-only harness is located at `tests/visual/legal-consent-harness/`. It is served by `npm run test:legal-consent-visual` with a temporary local Vite server and uses only in-memory fake sessions and consent responses. It is outside `src/pages`, is not linked from the application, and the visual test rejects non-local network requests. The command captures the desktop and mobile state matrix, interaction/accessibility checks, overflow results, redacted call records, and screenshots in an OS temp evidence directory.

The canonical 30-state manifest is `tests/visual/legal-consent-state-matrix.mjs`. States 1 through 25 require screenshots at 1440x900, 430x932, and 390x844, for a minimum of 75 screenshots. Callback outcomes 26 through 30 require structured redirect results instead. The generated `matrix.json` must show 30 expected, executed, and passed states, no missing or duplicate IDs, five passing redirect assertions, 75 or more screenshots, and zero unexpected external requests. Evidence is saved under `openglass-legal-consent-phase3b1-matrix-*` in the OS temp directory. Phase 3B1 cannot be marked ready from partial coverage.

## Phase 3B2A page gate

`src/lib/legal-consent-route-policy.ts` is the single page-route policy: exempt routes remain available, community reading routes remain public only while signed out, and notifications, account, create/edit/manage, and admin routes require both a session and current consent. `CommunityLayout.astro` mounts the reusable gate and hides gated page content until the client session and consent status resolve. Missing, outdated, or failed authenticated consent status does not reveal protected content. It redirects only to sanitized internal login or legal-consent destinations and uses replace navigation to limit loops. Admin consent is additional to, never a replacement for, existing role checks.

This is page/session enforcement only. Mutation APIs remain intentionally unchanged until Phase 4, so direct API bypass is not prevented by Phase 3B2A. Production migration/runtime configuration, public legal contact values, and qualified legal review remain pending.

## Phase 4A1 redirect-sanitization blocker

Phase 4A1 is blocked on redirect sanitization. `src/pages/api/auth/resend-confirmation.ts#POST` remains incomplete after source evidence showed that `getSafeNext` accepts `/\\evil.example` through its leading-slash branch, and the value can reach `window.location.replace` after the auth callback as an external origin. Production remains NO_GO.

Remediation must be a separate centralized runtime-security task for `src/lib/auth-redirect.ts`, not a legal-consent guard change. Every `getSafeNext` caller requires review, including login, signup, callback, consent, header, and CTA flows; password recovery uses a separate redirect helper and must also be checked as part of the same remediation review. After a reviewed runtime fix, the resend-confirmation endpoint requires a separate source re-audit before Batch 3 can resume.

The centralized runtime remediation now parses destinations against the trusted application origin and returns only canonical internal path/query/hash output. It rejects raw and encoded authority/backslash/control forms, malformed encodings, absolute destinations, and cross-origin resolution; callback and recovery origin builders share the trusted-origin validation, and browser navigation applies the sanitizer again at its final sink. Login, signup, resend, callback, consent, header/menu, CTA, and password-recovery callers were reviewed. The resend-confirmation source-to-sink re-audit at `eb92faf98dd0dd60c10fb6d770781b3a99c1e604` cleared the active external-redirect finding and retained its blocker record as resolved history. Phase 4A1 and production remain NO_GO because the broader trace and subsequent implementation phases remain incomplete.

## Phase 4A1 comment reaction visibility remediation

`src/pages/api/forum/comments.ts#PUT` had an active release-blocking authorization mismatch: the verified bearer actor was correct, but PUT authorized a reaction from the comment's publication fields alone and did not prove that the parent post remained visible. `GET` in the same route enforced that parent-post visibility contract, while a hidden or soft-deleted post could retain published comments.

The re-audit confirms the runtime and forward-RLS rules align. `resolveAccessibleCommentReactionTarget` resolves a published comment, published parent post, and active canonical-visible circle before any reaction query; the route then deletes only an existing verified actor reaction or inserts only `authData.user.id`. `supabase/migrations/20260713_comment_reaction_visibility_authorization.sql` installs matching SELECT, INSERT, UPDATE, and DELETE policies, with UPDATE applying ownership and the full predicate in both `USING` and `WITH CHECK`. The current schema has no private-circle membership relation, so no private membership behavior is implied. The source blocker is resolved by `d57aae680fb81ed4133af73aae955473218d9c09`; the migration is authored but unexecuted and remains a deployment prerequisite. Legal consent is not a substitute for resource authorization. This completes PUT only: 43/66 traced, 23 pending, and Batch 4 remains pending.

## Phase 4A1 comment-creation ancestor authorization re-audit

`src/pages/api/forum/comments.ts#POST` is complete after re-audit. It derives the actor only from verified bearer authentication; safety, payload, profile, and server-derived post-circle-parent checks all complete before moderation, the rate-attempt write, and `comments.insert`. The resolver denies missing, mismatched, deleted, hidden, unpublished, inactive, or canonical-hidden ancestors, and an optional parent must be published and tied to the same post. The insert uses only verified `author_id` plus resolver-returned target ids. `20260713_comment_creation_circle_authorization.sql` provides matching INSERT RLS for authenticated actor ownership, valid comment state, published post, active canonical-visible circle, and same-post published reply parent. The schema has no private-circle membership relation. The migration is authored but unexecuted; applying it remains a deployment prerequisite, not an active source blocker. GET is now complete, Batch 4 is complete, progress is 45/66 traced and 21 pending, and production remains NO_GO.

## Phase 4A1 public comment-read ancestor visibility re-audit

`src/pages/api/forum/comments.ts#GET` is complete after re-audit. Runtime validates `post_id`, creates an anon RLS client, optionally derives a verified viewer from a bearer, then first reads the server-derived post and exact circle before comments, profiles, reactions, or `liked_by_me`. It requires published/moderation-visible post state and an active canonical-visible circle. The authored forward migration `20260713_comment_read_circle_visibility_authorization.sql` mirrors that public invariant in post, comment, and reaction SELECT policies while preserving authenticated-own and staff branches. Historical migrations remain unchanged and no migration execution is authorized in this re-audit task.

The GET re-audit clears the active source blocker under remediation commit `aa2cf01be3a21eed9d3a0de111bc249c0ead046a`; legal consent remains unrelated to public resource authorization. All three forward comment migrations remain authored, committed, and unexecuted: `20260713_comment_creation_circle_authorization.sql` protects POST creation, `20260713_comment_reaction_visibility_authorization.sql` protects PUT reaction access, and `20260713_comment_read_circle_visibility_authorization.sql` protects GET public read ancestry. They remain production deployment prerequisites. Batches 1-4 and the Batch 5 `comments.ts`, external-video, media-upload-guard, and post-media sources are complete at 49/66 traced and 17 pending. The next pending Batch 5 source is `src/pages/api/forum/posts.ts#GET`; Batch 5 remains pending, Batch 6 remains pending, and production remains NO_GO.

## Phase 4A1 forum comment soft-delete trace

`src/pages/api/forum/comments.ts#DELETE` is complete. It verifies the bearer, derives the actor exclusively from `auth.getUser(token)`, reads the verified profile role, and allows only the server-read comment author or a server-derived moderator/admin before the single status update. URL `id` or optional JSON `comment_id` identifies the comment; no client field can set an actor, author, role, post, circle, status, or reaction identity. Final `comments_update_self_or_staff` RLS independently restricts the update to the author or moderator/admin.

The route is soft-delete only: after an already-deleted no-op check, `comments.update({ status: 'deleted', updated_at })` is the first and only persistent effect. Reactions, replies, counts, notifications, audit records, RPC, email, cache, R2/storage, and external services are untouched. It does not read post/circle ancestry or call `assertUserCanWrite`, so an RLS-visible author/staff actor can delete a comment after its ancestors become inaccessible. This is a documented lifecycle/safety hardening concern, not a client-controlled actor, staff, or cross-resource bypass. The future consent hook belongs after verified authentication and before the profile-role read. Missing content-type/body-size/rate/idempotency controls and raw errors remain Phase 4B work.

## Phase 4A1 external video authorization re-audit

`src/pages/api/forum/external-video-upload.ts#POST` is complete after re-audit. It verifies the bearer, derives the actor only from `authData.user.id`, checks global write safety, validates the request payload, reads only `id, author_id` for the selected UUID-shaped `post_id`, and requires server-read `post.author_id === authData.user.id` before conditional `validateTurnstileToken`. Request fields cannot set actor, author, owner, role, staff status, storage key, target relationship, or an external URL. Missing and wrong-owner targets stop before all later effects.

The fully offline ordering regression test proves missing, non-owner, malformed, unauthenticated, and safety-denied requests perform zero later Turnstile, Cloudflare-fetch, daily-rate, R2-signing, rate-attempt, or direct mutation calls. A valid owner reaches Turnstile only after lookup and ownership proof; invalid Turnstile stops before the rate-attempt insert; and a Turnstile-disabled path still authorizes the target before later processing. `validateTurnstileToken` is the first external effect and uses only its fixed Cloudflare siteverify URL, so no SSRF path exists. The rate-attempt insert is the first persistent operational effect; R2 signing does not upload an object, and the endpoint does not insert `post_media` or another domain record. No migration change is required for this route-local blocker, which is resolved by re-audit under commit `30ece7ec89e7de477b3b74d94e36ee51709419d5`.

The bearer-bound client is constrained by the deployed-source `posts_select_published_public` policy to published, own, or server-derived staff rows; the route's server-read author equality comparison independently prevents cross-user signed-upload authorization. The authored but unexecuted comment-read policy migration further narrows public-circle visibility and remains a deployment prerequisite for comments, not this route. There is no request idempotency key or transaction, so retries can duplicate operational rate-attempt rows and one can remain on a later response failure. Missing Content-Type/transport body-size validation and formatted database/caught error details remain Phase 4B hardening. The future consent guard belongs after verified bearer authentication and before safety, target, Turnstile, rate, signing, or persistence stages. Phase 4A1 is 49/66 traced with 17 pending; Batch 5 remains pending, next source `src/pages/api/forum/posts.ts#GET`, and production remains NO_GO.

## Phase 4A1 media-upload guard trace

`src/pages/api/forum/media-upload-guard.ts#POST` is complete as a verified-user upload-purpose guard. It derives the actor exclusively from verified bearer authentication, accepts only upload kind, declared byte count, and optional Turnstile token, and has no target-resource, actor, owner, or storage-credential input. It returns `{ ok: true }` without signing or issuing an upload URL, object key, token, or other credential; it does not call R2/storage or mutate media records. The route-level absence of a resource target means later target authorization is the responsibility of the target-specific media route and its RLS policies, not a missing authorization step in this guard.

After verified actor derivation and payload validation, `assertUserCanWrite` denies unavailable, banned, and suspended accounts before conditional Turnstile and rate persistence. Turnstile uses only the fixed Cloudflare siteverify destination, so no SSRF-capable client-selected destination exists. The first persistent effect is the verified-actor `forum_upload_attempts` insert within `enforceUploadRateLimit`; it is operational and can duplicate on retries because no idempotency key exists. No domain, notification, audit, cache, email, RPC, or telemetry mutation occurs. The consent insertion point is immediately after `auth.getUser(token)` and before payload parsing, safety, Turnstile, or rate work. Missing size/content-type/MIME/idempotency constraints and rate-helper fail-open behavior remain Phase 4B hardening. Phase 4A1 is 49/66 traced with 17 pending; Batch 5 remains pending, next source `src/pages/api/forum/posts.ts#GET`, and production remains NO_GO.

## Phase 4A1 post-media cross-post provenance re-audit

The historical blocker checkpoint `7fae49fc9e0d13928bbd9ab196051fbbdacc4c0a` is resolved in source. The external-video issuer now proves the verified actor owns the server-read target post and generates only `tmp/<actor-id>/<post-id>/<random-object-name>` before Turnstile, rate processing, and R2 signing. `post-media.ts#POST` separately proves the verified actor owns its selected post and accepts only direct `<actor>/<post>/...` or temporary `tmp/<actor>/<post>/...` paths. Cross-post and cross-user replay, legacy actor-only paths, missing segments, ambiguous separators, traversal, queries, fragments, and foreign video URLs are rejected before `resetCover` or insertion.

Forward migration `20260713_post_bound_media_provenance.sql` replaces `post_media` INSERT and ordinary-user UPDATE RLS with matching authenticated actor, target-post ownership, and fully anchored object-provenance checks. The migration is authored but unexecuted: it remains a production deployment prerequisite, while the source re-audit is complete. The offline regression test covers the allowed post-A path, denied post-A-to-post-B and cross-user paths, malformed provenance, unchanged historical migrations, and zero real service operations. Consent cannot establish object provenance; its future insertion remains immediately after verified authentication. Phase 4A1 is 49/66 traced with 17 pending; Batch 5 remains pending, the next source is `src/pages/api/forum/posts.ts#GET`, and the three earlier comment migrations remain unexecuted deployment prerequisites. Production remains NO_GO.

## Phase 4A1 forum posts authorization re-audit

All pending `src/pages/api/forum/posts.ts` methods are complete. GET is read-only: its public feed filters every published, moderation-visible post through active canonical circle visibility before enrichment, while the former `increment_view` trigger returns 400 and cannot call the view RPC. POST derives the author only from verified bearer auth, applies safety checks, validates payload/profile, authorizes the circle before operational rate persistence or conditional moderation, then inserts. PATCH and DELETE both require verified actor/safety, UUID validation, a published moderation-visible post under an active canonical circle, and server-derived role or ownership authorization before updates; DELETE soft-deletes before non-transactional media cleanup and has no hard-delete fallback.

Forward migration `20260713_forum_posts_circle_authorization.sql` is authored but not executed. It adds matching public-circle access checks to post INSERT, UPDATE, and DELETE RLS and to the security-definer `increment_post_view_count` RPC; it depends on the earlier authored `can_access_public_circle` helper. This is a deployment prerequisite alongside `20260713_comment_creation_circle_authorization.sql`, `20260713_comment_reaction_visibility_authorization.sql`, `20260713_comment_read_circle_visibility_authorization.sql`, and `20260713_post_bound_media_provenance.sql`. The fully offline posts authorization test pins runtime and migration ordering without a real database, storage, auth, or network operation.

The consent insertion point for POST/PATCH/DELETE is immediately after verified `auth.getUser(token)` and before safety, target lookup, rate/moderation, mutation, or cleanup. Content-Type/body-size checks, retry/idempotency controls, raw dependency-error sanitization, rate-attempt duplication, and cleanup partial failures remain Phase 4B hardening. Phase 4A1 is 53/66 traced with 13 pending; Batch 5 remains pending, next source `src/pages/api/forum/reports.ts#POST`, and production remains NO_GO.

## Phase 4A1 forum report authorization re-audit

`src/pages/api/forum/reports.ts#POST` is complete after remediation. It derives reporter identity only from verified bearer auth, applies `assertUserCanWrite(report_create)`, validates target type/id and reason input, and resolves public target accessibility before rate or duplicate checks. Post/comment reports require published moderation-visible rows beneath an active canonical-visible circle; circle reports require that same lifecycle state; user reports require an existing profile. Hidden, deleted, rejected, inaccessible, missing, and relationship-mismatched targets create neither reports nor events; existing own-content reporting remains supported.

The new forward migration `20260713_forum_report_target_authorization.sql` is authored but unexecuted. It replaces ordinary report INSERT RLS with verified `auth.uid()` reporter ownership, neutral open/normal/no-assignment/no-resolution initial fields, and a type-bound post/comment/circle/user target predicate. Existing `report_events_insert_reporter_created` already binds created events to `auth.uid()` and a reporter-owned report. The route inserts report then event without a transaction, so event-loss repair and concurrent duplicate races remain Phase 4B hardening. The migration joins the other authored but unexecuted authorization prerequisites and depends on `can_access_public_circle`.

Consent belongs immediately after `auth.getUser(token)` and before safety, payload, target, rate, duplicate, report, or event work. The offline report matrix covers every target type, identity/status override exclusion, inaccessible ancestry, historical migration integrity, forward RLS coverage, and effect ordering without real services. Phase 4A1 is 54/66 traced with 12 pending; Batch 5 remains pending, next source `src/pages/api/forum/search.ts#GET`, and production remains NO_GO.

Redirect caller review: login query `next` and register query `next` pass through `getSafeNext` before AuthPanel or the server redirect; resend confirmation body `next` passes through it before callback URL construction; callback query metadata is sanitized again by AuthCallback before replace navigation; legal-consent query/props and the consent gate route/query value use it before returning to the browser adapter; header-menu and CTA `next` props use it before constructing login links; and AuthPanel uses it for login/signup callback and consent-return paths. The browser adapter sanitizes both `navigate` and `replace`, and returns a relative current path/query/hash so its logout refresh path remains within the contract. Password recovery accepts no client `next`; its origin comes from `window.location.origin` and `buildResetPasswordRedirect` now uses the same trusted-origin validator.

Other dynamic navigation sinks were reviewed. Notification destinations are generated server-side by `buildNotificationHref` from notification type and resource ids, global search and news pagination build internal routes with encoded query components, and the remaining auth/profile/admin/form redirects use fixed internal destinations or `buildLoginHref`. None bypasses a client-controlled auth `next` value. The resend endpoint is now fully traced as an auth/recovery exemption; the historical redirect blocker is resolved rather than active.

## Phase 3B2B route coverage

`tests/fixtures/legal-consent-page-routes.mjs` is the authoritative page-route inventory. `npm run test:legal-consent-route-coverage` compares discovered Astro page files to that inventory, verifies a single central classification for each pattern, and confirms the shared CommunityLayout hosts the gate. New production pages must be added to this inventory and classified before release. API and test-only routes are deliberately excluded. Page-level coverage does not protect direct mutation APIs; that remains Phase 4.

The current audit covers 44 production Astro routes: 23 exempt, 7 public-conditional, and 14 authenticated-and-consented, with zero coverage gaps. No Phase 3B2B page types required additional visual evidence because the audit introduced no new layout integration; the Phase 3B1 and 3B2A offline matrices remain the canonical UI evidence. The mobile-header regression is an external-server consumer: start `node node_modules/astro/astro.js dev --host 127.0.0.1 --port 4323`, wait for an HTTP 200 from `http://127.0.0.1:4323/`, run the test, then stop only that spawned process. It passed twice consecutively with the known local feed/circles binding warnings.

## Phase 4A1 checkpoint

The policy-level mutation inventory is checkpointed before deep execution tracing. All 66 methods are deterministically assigned to six pending batches. Evidence-backed tracing must reach 66/66 before Phase 4A1 can be ready; no mutation endpoint is protected at this checkpoint, and Phase 4A2 remains the first representative route integration phase.

## Phase 4A1 release blocker checkpoint

The `src/pages/api/admin/users/[id]/ban.ts#POST` privilege blocker was cleared by re-audit after remediation commit `56af1cf6b7c4e0aa5df8f35539d5e4cceea80217`. `applyUserSafetyAction` re-reads server-side actor and target roles and fails closed before safety-state access: moderators may target only users; administrators may target users or moderators but never administrators; self, missing, and unknown roles deny. The historical blocker evidence and regression checks remain in the ordering audit. Batch 3 is still pending and Phase 4A1 remains `NO_GO` until every trace is complete.

Run the normal production build after changes and inspect its output for harness names and fake fixture values. The harness is not a production route and does not introduce global page gating or mutation enforcement. Database migration/runtime configuration, public operator contact configuration, and qualified legal review remain separate prerequisites for release.

## Forum Search Visibility Re-audit

The completed public `GET /api/forum/search` trace records one resolved historical source finding: `FORUM_SEARCH_PUBLIC_VISIBILITY_AND_QUERY_FILTER_SAFETY`. The route is anon-only, read-only, and has no consent boundary. Query input is reduced to bounded plain Unicode text before fixed PostgREST filters; type and limits are allowlisted/clamped, while offset, cursor, arbitrary table/column/sort, RPC, actor, and staff inputs are absent.

Runtime filtering now proves every post and derived profile count belongs to an active canonical-visible circle before it can affect a row, excerpt, author value, media proxy, count, or rank. Circle search applies the same active/canonical rule. Profile search exposes only intentional public display fields and only for profiles with visible public activity. Public proxy media avoids storage signing. The route makes no write, view, rate, audit, analytics, cache, notification, email, R2, RPC, or external-provider call.

The forward public post SELECT RLS in `20260713_comment_read_circle_visibility_authorization.sql` remains authored but unexecuted; it is the database-layer deployment prerequisite matching the now fail-closed runtime predicate. No migration was executed during this work. Phase 4A1 is 55/66 traced with 11 pending; Batch 5 is complete, Batch 6 is pending, and the next deterministic method is `src/pages/api/legal/consent.ts#GET`. Overall release status remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## Legal Consent Status Read Trace

`GET /api/legal/consent` is an authenticated, read-only status function. A bearer token is parsed and verified through `auth.getUser(token)` before the route returns an actor-bound read repository. Its only database read is the verified actor's row for the server-selected active legal bundle; `legal_policy_acceptances_select_own` independently constrains that read to `auth.uid()`. The response intentionally does not expose user ids, accepted timestamps, sources, individual accepted versions, or another user's record.

The combined required consent comes solely from `LEGAL_POLICY`: Terms, Privacy, Community Guidelines, bundle version, and minimum age must all match. Missing and stale required consent both safely return `current: false`; optional analytics and marketing are not part of this combined consent endpoint, and cannot become required or satisfy the required acceptance. The route constructs no service-role writer, performs no mutation or external effect, and returns only fixed sanitized errors on failure.

Consent recording remains a narrow bootstrap exemption. The route-policy classifier exempts the legal-consent page and `AUTH_RECOVERY_EXEMPT` explicitly exempts only the consent POST and resend confirmation mutation. Requiring already-current consent before recording or renewing it would deadlock the intended recovery flow; this exemption does not confer authority over any unrelated mutation. The fully offline regression matrix covers current/missing/outdated status, optional-choice separation, invalid/anonymous requests, cross-user override exclusion, lazy writer behavior, and zero writes. Phase 4A1 is 56/66 traced with 10 pending, Batch 6 remains pending, and the next source is `src/pages/api/media/circle/[circleId].ts#GET`. No migration was executed and all existing authored-but-unexecuted authorization migrations remain deployment prerequisites.

## Circle Cover Public Visibility Trace

`GET /api/media/circle/[circleId]` now uses only a route UUID and an anon-key client to resolve an exact circle row before cover signing. It requires active status, `isPublicVisibleCircle`, and an exact canonical database-owned `circle-covers/<uuid>/<timestamp>-<normalized-file-name>` object path. It has no bearer, actor, staff, query, pagination, raw object-key, foreign URL, post/media/profile, count, or metadata branch; ordinary authenticated callers do not gain additional access. Rejected ids, rows, circles, and paths return `MEDIA_NOT_FOUND` before storage signing or fetch.

`20260714_circle_cover_public_visibility_authorization.sql` is authored but not executed. It replaces the public circle SELECT policy and the prefix-only cover storage SELECT policy with active canonical-public circle and exact `circles.image_path` checks, retaining owner and database-role-derived staff management reads. The route remains read-only and does not add a consent boundary. Phase 4A1 is 57/66 traced with 9 pending; Batch 6 remains pending; the next source is `src/pages/api/media/post/[mediaId].ts#GET`. All forward migrations, including this one, are deployment prerequisites; none was executed in this work and overall status remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## Post Media Delivery Authorization

`GET /api/media/post/[mediaId]` now verifies the exact server-derived media, post, and circle chain before any storage signing or object fetch. It is anon-only and bearer-agnostic; public callers receive the same decision regardless of a bearer. The target must be a published moderation-visible post in an active canonical-public circle, with a canonical owner/post-bound finalized object or a video-only `tmp/<owner>/<post>/<random>` key. Stored external URLs, mismatched ancestry, legacy temporary keys, encoded/traversal forms, and hidden/deleted/inactive/QA-hidden ancestors deny before every external effect.

The shared proxy fetches only a Supabase-generated signed URL or a server-configured HTTPS R2 delivery URL after authorization. It does not redirect, expose signed credentials, forward sensitive upstream headers, or accept client-selected Range, host, bucket, object key, or headers. Fetches have a fifteen-second timeout and 150 MiB content-length limit. `20260715_post_media_delivery_visibility_authorization.sql` is authored but unexecuted; it aligns public `post_media` and storage-object SELECT with the same post-circle visibility and exact canonical object binding. It is a production deployment prerequisite, as are the prior authored migrations. Phase 4A1 is 58/66 traced with 8 pending; Batch 6 remains pending; next source is `src/pages/api/media/profile/[userId]/[kind].ts#GET`; overall status remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## Profile Media Delivery Authorization

The public profile-media GET route accepts only a UUID user id and exact `avatar` or `banner` kind. It uses an anon-only client, server-selects one profile row, maps each kind to only its matching `avatar_url` or `banner_url`, and permits only a canonical lower-case, user-bound profile storage key. This retains the established public-profile lifecycle: profile rows are public while present, safety state is not anonymous visibility input, suspended and banned profiles remain public, and missing/deleted profiles or missing media deny. There is no default asset, staff, bearer, query override, external URL fetch, or user-controlled storage destination branch.

The proxy signs only the fixed `post-media` bucket after exact profile/kind/object authorization and fetches only the storage-issued URL. It has a fifteen-second timeout, 150 MiB content-length ceiling, profile-image JPEG/PNG/WebP/GIF allowlist, and safe response-header allowlist. It performs no persistent writes. `20260716_profile_media_delivery_authorization.sql` is authored but unexecuted; it replaces prefix-only avatar/banner object SELECT with an exact current-profile-field binding predicate. It must be applied with the earlier authored authorization migrations before production release. Phase 4A1 is 59/66 traced with 7 pending, Batch 6 remains pending, and the next source is `src/pages/api/news.ts#GET`; overall release classification remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## Public News API Safety

`GET /api/news` is an anon-RLS public database feed, not an external-provider/RSS proxy. It accepts only an exact category, page `1-1000`, and limit `1-12`, then reads published featured/latest/hot rows followed by one bounded page. There is no bearer branch, service role, provider URL, outbound fetch, redirect, cache, KV, filesystem, storage, user state, or persistent effect. RLS requires published rows and runtime output normalization independently removes nonpublished/invalid-category records.

The public response removes author ids, bounds text, strips literal HTML/control characters, and retains only safe HTTP(S) or supported storage references. Credentialed, javascript, data, localhost, loopback, private, link-local, and IPv6-loopback URLs are rejected; image values are never server-fetched by this API. Fixed `NEWS_UNAVAILABLE` and `NEWS_FETCH_FAILED` responses prevent environment, database, provider, or token detail disclosure. No migration was created or executed. Phase 4A1 is 60/66 traced with 6 pending, Batch 6 remains pending, and the next source is `src/pages/api/news/[slug].ts#GET`; the existing profile-audit service-role observation remains unchanged. Overall release classification remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## Public News Detail API Safety

`GET /api/news/[slug]` now single-decodes and canonical-validates its path slug before constructing the anon-only client or reading data. It performs an exact published-row lookup and, only after that succeeds, a server-derived category related-row lookup capped at four. Invalid, missing, and inaccessible targets all produce `NEWS_NOT_FOUND`; missing bindings and helper errors produce generic fixed errors. Bearer input is ignored, so normal callers cannot enter the database-role-derived authenticated staff branch.

Database and fixed fallback rows use the same public normalizer: published rows only, valid slug/category, bounded text, literal HTML/control removal, no author id, and safe canonical-storage or HTTP(S) URLs only. There is no provider/image fetch, redirect, cache, storage signing, counter, database write, analytics, audit, notification, email, RPC, or other persistent effect, so there is no SSRF or consent boundary. No migration was authored or executed. Phase 4A1 is 61/66 traced with 5 pending; Batch 6 remains pending and the next source is `src/pages/api/users/me/notifications.ts#GET`. The existing profile-audit service-role observation remains unchanged; overall status remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## User Notifications Authorization and Privacy

`/api/users/me/notifications` has completed its source trace for GET and PATCH. The only recipient identity is the UUID returned by bearer `auth.getUser`; neither endpoint accepts recipient, actor, profile, role, staff, metadata, target, or ownership substitutions. The bearer-bound anon-key client and active `forum_notifications_select_own`/`forum_notifications_update_own` policies both require the same recipient relationship. GET query input is limited to one canonical `limit` (default 20, maximum 50) and one exact unread boolean; all pagination, sort, date, type, filter, and recipient override grammar is rejected before reads.

Notification response privacy is allowlisted. Actor ids, recipient ids, post/comment ids, raw avatars, metadata blobs, roles, safety state, moderation and report data are absent. Public actor display fields and a same-origin avatar proxy are returned only when available. Post/comment text and a `/posts/<uuid>/` link require server-read published/moderation-visible post, exact published comment where applicable, and active canonical-visible circle ancestry. Inaccessible lifecycle states redact target content and fall back to `/notifications/`. GET has no persistent effect. PATCH permits only strict read-marker actions and applies `read_at` only to currently unread rows with the verified recipient predicate; retries are intentionally idempotent.

No forward migration is required or was executed for this route because the active RLS policies already mirror recipient ownership. A future legal-consent guard for PATCH belongs directly after verified authentication and before body parsing or the first update; GET has no consent boundary. The offline notification API matrix covers denied credentials/query/payloads, cross-recipient scoping, RLS source predicates, safe links, lifecycle redaction, and zero real operations. Trace progress is 63/66 complete with Batch 6 still pending; the next source is `src/pages/api/users/me/profile.ts#POST`. The unrelated profile-audit 48/1 observation is preserved. Release classification remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## User Profile Update Authorization and Privacy

`POST /api/users/me/profile` now derives the profile authority solely from a strict Bearer token verified by `auth.getUser` on an anon-key bearer-bound RLS client. Safety authorization follows immediately, before JSON, profile reads, moderation, storage cleanup, or update. Only `display_name`, `username`, `bio`, `avatar_url`, and `banner_url` are accepted; all identity, privilege, moderation, safety, trust, consent, timestamp, report, and unknown fields are rejected. User-supplied website, location, social-link, preference, and onboarding fields are not part of this route contract.

## User Summary Privacy and Aggregation

`GET /api/users/me/summary` uses only a strict bearer-derived actor and a bearer-bound anon/RLS client. Its minimal profile lookup repeats that actor id; post/vote and comment/reaction aggregates are each constrained through the same actor's published, moderation-published content. It does not query notifications, circles, reports, moderation, safety, or legal consent, and does not construct a service-role client. The response allows only self display identity, an internal profile href, canonical same-user avatar proxy, and two self-scoped aggregate counts. Raw avatar storage paths, role, email, tokens, auth metadata, safety/moderation/report/consent fields, timestamps, and raw rows are excluded. GET has no persistent or external effect. No migration was authored or executed; trace progress is 65/66 with Batch 6 pending and `src/pages/api/legal/consent.ts#POST` final pending. The profile-audit 48/1 repository observation is unchanged. Release classification remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

Username is NFC-trimmed/lower-cased under the existing grammar and backed by `profiles_username_unique_ci` on `lower(username)`; conflict output is fixed. Display and bio reject controls and literal markup. Avatar/banner references must be exact canonical keys that bind the verified UUID and matching media kind before any signing/provider work. Existing profile RLS, column-scoped grant, and role-change trigger remain the database boundary; the route additionally repeats `id = auth.userId` for reads and the sole update. No migration was authored or executed. The route does not reach the existing `legal-consent-repository.server.ts` service-role audit observation, which remains 48/1 rather than being suppressed. Trace progress is 64/66 complete with Batch 6 pending; the next source is `src/pages/api/users/me/summary.ts#GET`. Release classification remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## Phase 4A1 Final Consent POST Closure

`POST /api/legal/consent` is complete and remains intentionally exempt from the ordinary current-consent mutation guard. It authenticates first using a strict Bearer token and `auth.getUser`, derives the actor only from that verified result, validates the two-field consent payload, selects the required policy bundle only from `LEGAL_POLICY`, performs the actor-scoped current-consent/rate read, and only then constructs a service-role writer bound to that verified actor. The writer exposes one fixed consent RPC and no caller-controlled user id, table, action, policy version, or timestamp. The RPC upsert is the first and only persistent effect; direct browser writes remain revoked by the legal-consent migration.

This narrow bootstrap/renewal exemption is necessary because a missing or stale consent record must be allowed to record the current required bundle. It cannot select unrelated repository behavior, and analytics or marketing values are neither required nor accepted as substitutes. Same-bundle retries use the migration's unique user/bundle key and conflict update; server/database time supplies the confirmation timestamp. Fixed unavailable/rate/auth errors and the minimal response keep rows, accepted history, SQL, service credentials, and configuration private.

The profile system audit now has an exact safe service-role classifier rather than a broad exception. It passes only this post-authentication, actor-bound, fixed-RPC legal-consent writer and the offline negative matrix rejects pre-auth writer construction, request-selected actor scope, arbitrary table/RPC access, secret exposure, and unrelated service-role code. The audit is now 49/49 passing.

Phase 4A1 is source-inventory complete: 66/66 methods traced, zero pending, and Batches 1-6 complete. This does not indicate production readiness. No SQL, migration, auth, data, email, storage, preview, staging, or production operation occurred in this closure run; Phase 4A2 and general consent-guard integration have not begun.

The authored forward migration inventory remains a deployment prerequisite and was not executed in this audit: `20260703_moderation_action_notifications.sql`, `20260712_legal_policy_acceptances.sql`, `20260713_comment_creation_circle_authorization.sql`, `20260713_comment_reaction_visibility_authorization.sql`, `20260713_comment_read_circle_visibility_authorization.sql`, `20260713_forum_posts_circle_authorization.sql`, `20260713_forum_report_target_authorization.sql`, `20260713_post_bound_media_provenance.sql`, `20260714_circle_cover_public_visibility_authorization.sql`, `20260715_post_media_delivery_visibility_authorization.sql`, and `20260716_profile_media_delivery_authorization.sql`. Production deployment must confirm and apply the applicable migrations before claiming database-layer readiness. Overall release classification remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A1_NO_GO`.

## Phase 4A2 Representative Legal Consent Guards

Phase 4A1 remains closed at 66/66 source traces, with all six batches complete. Phase 4A2 applies the centralized required-consent gate to precisely five representative mutations: forum comment creation, forum post creation, self profile update, moderator hide, and forum report creation. The fixture IDs are `src/pages/api/forum/comments.ts#POST`, `src/pages/api/forum/posts.ts#POST`, `src/pages/api/users/me/profile.ts#POST`, `src/pages/api/admin/moderation/hide.ts#POST`, and `src/pages/api/forum/reports.ts#POST`; it records 5/5 integrated, zero representative methods pending, and no active representative source blocker. The other 32 required-consent mutations remain deferred to Phase 4B.

The common guard evaluates only the verified authenticated actor against the server-owned active required bundle. It makes no endpoint business decision and has no service-role writer path. Existing bearer authentication happens first, then the route's bearer-bound RLS client creates the consent read repository, then the guard runs before all target/safety/rate/provider/storage/mutation work. Missing or out-of-date required acceptance returns only `LEGAL_CONSENT_REQUIRED` plus `/legal-consent/` with status 403. Repository failure returns only `LEGAL_CONSENT_UNAVAILABLE` with status 503. Existing missing/invalid bearer handling remains the authoritative 401 path before any consent lookup. The direct guard test covers stale Terms, Guidelines, and Privacy separately, wrong bundles, malformed results, exceptions, optional analytics/marketing false or absent, and verified-actor query scoping.

`POST /api/legal/consent` remains a narrow, authenticated bootstrap and renewal exemption so actors with no prior or outdated consent can record the current server bundle. Auth callbacks, recovery/resend routes, and read-only methods remain exempt. The Phase 4A2 offline call-log matrix proves that missing, outdated, and unavailable consent checks make zero downstream calls for each representative; current consent continues into the established route behavior, which remains covered by the endpoint authorization, safety, visibility, report, provenance, and profile audits. The profile service-role audit remains passing and the representative routes do not construct a service-role client.

No real auth, database, R2, Cloudflare, email, preview, staging, or production operation occurred. No migration was added or executed; the full authored migration prerequisite inventory, including the legal-policy acceptance schema migration, remains a deployment requirement. This does not complete a full mutation rollout or make production ready. Phase 4B is deferred and the release classification remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4A2_NO_GO`.

## Phase 4B Wave 1 Rollout

The Phase 4B pre-wave manifest held 32 non-exempt, non-read-only required-consent mutations after the five Phase 4A2 representatives. Wave 1 deterministically integrates ten methods in six source files because the eighth manifest entry is the first `admin/news.ts` mutation and its adjacent PATCH and DELETE methods belong to the same source file. The complete Wave 1 set is the two admin circle mutations, admin media delete, admin post patch/delete, moderator approve/reject, and all three admin news mutations. The Phase 4B fixture records their exact IDs, source files, integration symbols, verified-auth predecessor, first following processing stage, later effect boundary, 401/403/503 contract, call-log zero-effect proof, and focused test reference.

All ten use the existing centralized guard after `requireModerator` and before parsing a request body or DELETE query. The consent reader is built only from the verified moderator's bearer-bound RLS client. Missing/stale current legal consent fails closed with the central 403 `LEGAL_CONSENT_REQUIRED` response and consent-reader infrastructure failure returns its sanitized 503 response. Existing missing/invalid credentials continue to fail at `requireModerator` before repository construction. A current bundle proceeds to the pre-existing role, validation, target, duplicate, moderation, storage, update/delete, and audit behavior; it does not bypass any authorization or RLS boundary.

The shared offline Phase 4A2/4B harness covers every Wave 1 method for no-auth 401, current continuation, missing/stale 403, unavailable 503, request actor/bundle override resistance, and explicit zero downstream call logs. The Phase 4A1 inventory remains 66/66, Phase 4A2 remains 5/5, Wave 1 is 10/10, cumulative integration is 15/37, and 22 mutations remain. Exempt bootstrap/auth/recovery operations and GET routes are asserted unchanged. No migration has been added or executed; the earlier authored migrations remain deployment prerequisites. The next deterministic manifest method is `src/pages/api/admin/reports/[id]/action.ts#POST`, Phase 4B is still incomplete, and production remains `LEGAL_TRUST_CONSENT_FOUNDATION_V1_PHASE4B_NO_GO`.
