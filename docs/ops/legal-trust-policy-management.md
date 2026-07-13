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
