# OpenGlass Hub Verified Session v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a session-bound email challenge after every fresh password login while preserving public reads, owner/role checks, and versioned policy consent.

**Architecture:** A password-issued Supabase session is pending until a private verified-session row is committed for its signed `session_id`. Worker authentication uses Class A: `SupabaseClient.auth.getClaims(token)` from locked `@supabase/supabase-js`/`@supabase/auth-js` 2.112.4, followed by the no-argument user-token `public.ogh_is_verified_session()` RPC. Direct PostgREST, Storage, and Realtime paths use the same live-session predicate in restrictive RLS. The provider-native signup code is a separate server-hardcoded `verifyOtp({type:"signup"})` boundary; fresh-login codes use an atomic private challenge and Brevo HTTPS.

**Tech Stack:** Astro 7, React 19, Cloudflare Workers, Supabase JS/Auth 2.112.4, Supabase CLI 2.115.0/Auth 2.195.0 for disposable local tests, PostgreSQL, Node 24, Brevo Free transactional HTTPS.

**Spec:** `docs/superpowers/specs/2026-09-23-auth-verified-session-v1-design.md`

## Global Constraints

- This plan is not implementation or Production authorization. No task executes Production SQL, deployment, canary, `qa:prod`, paid branch, SMS, plan upgrade, or live email. Future Production mutations need separate approval.
- Do not alter historical migrations or add a fifth signup table, hook, client-selected signup type, raw JWT decoder, or single-factor fallback. Keep the four private tables below and the existing Supabase Auth -> Brevo SMTP signup/reset path.
- Pending means no privileged downstream operation, even when a valid password JWT exists. Keep existing ownership, moderation, catalog-admin, legal consent, and public-read restrictions. A missing DB, Auth, claim, session, secret, or email-provider result fails closed.
- Before release, prove hosted signing/`getClaims`, `session_id`/`amr`, `auth.sessions` access, signup template and provider-native `type:"signup"`, effective ACL/RLS, and Brevo Free API-key/sender compatibility. Local proof does not establish hosted configuration.
- Run only focused local/disposable tests and existing safe `npm test`, `npm run build`, and `git diff --check`. Never run `npm run qa:prod` or Production canary.

## Prerequisite Evidence

On a disposable Supabase CLI 2.115.0/Auth 2.195.0 instance, with locked JS/Auth 2.112.4 and Node 24.14.1, `auth.getClaims(token)` accepted a genuine password JWT and rejected signature tampering, forged `session_id`, forged `amr`, and an expired signed token. Authorization used `sub`, `session_id`, `amr`, `exp`, `is_anonymous`, not editable `user_metadata`. The local symmetric signing path has `getClaims` verify through Auth; a future asymmetric hosted key uses the official JWKS path. Neither a raw decode nor `getUser` plus separately decoded payload is authorized. Select **Class A only**.

The same disposable instance showed password `amr=password`, an owned `auth.sessions` row, stable `session_id` through refresh, a distinct second-login ID and row, session-A proof not authorizing B, removal of A's row after `signOut({scope:"local"})`, continued B row, and a still-cryptographically-valid old A JWT denied by the live-row predicate. The owned local instance and temp files were removed. Signup provenance remains resolved by the prior exact-stack proof, not re-investigated here.

## Review Focus

1. Check every authenticated policy, mutating RPC, and service-role call site against the surface ledger below. A Worker guard alone is insufficient.
2. Review `SECURITY DEFINER` owner/search-path/ACL and row-lock order; challenge-code comparison and verified insertion must be one transaction.
3. Review fail-closed behavior under Auth/DB/Brevo uncertainty, logout races, and quota exhaustion.
4. Keep public product/feed/news/media reads anonymous. Policy-version consent is independent of verified session; no age attestation in auth.
5. Review the phased release as preparation only; no step in this plan changes Production.

---

## File Map

**CREATE**

- `src/lib/server/verified-session.server.ts`: Class A claims and live predicate helper.
- `src/lib/server/login-challenge.server.ts`: challenge orchestration, code/HMAC, quota, response mapping.
- `src/lib/server/brevo-challenge.server.ts`: narrow HTTPS transport.
- `src/lib/verified-session-state.ts`: shared public state and safe error codes.
- `src/components/auth/LoginVerification.tsx`: fresh-login code/resend/recovery.
- `src/components/auth/SignupConfirmation.tsx`: provider-native signup code UI.
- `src/pages/api/auth/session-state.ts`, `login-challenge/start.ts`, `login-challenge/resend.ts`, `login-challenge/verify.ts`, `signup-confirm.ts`, `logout.ts`: new routes.
- `scripts/test-verified-session-claims.mjs`, `test-verified-session-sql.mjs`, `test-verified-session-routes.mjs`, `test-verified-session-brevo.mjs`, `test-verified-session-ui.mjs`, `test-verified-session-bypass.mjs`, `test-verified-session-signup.mjs`, `test-verified-session-release.mjs`: focused tests. Add fixture helpers under `tests/fixtures/verified-session/` only when needed by those suites.
- `docs/ops/verified-session-v1-release-gates.md`: separately authorized cutover/rollback packet, without execution.

**MODIFY**

- Auth: `src/components/forum/AuthPanel.tsx`, `src/components/auth/AuthCallback.tsx`, `ResetPasswordForm.tsx`, `useBrowserAuthState.ts`, `src/pages/login/index.astro`, `src/pages/auth/callback.astro`, `src/pages/api/auth/resend-confirmation.ts`, `src/lib/supabase-browser.ts`, `src/lib/auth-redirect.ts` (tests only if sanitizer remains unchanged).
- Header/private UI: `src/components/site/HeaderUserMenu.tsx`, `HeaderNotifications.tsx`, `SiteHeader.astro`, `src/components/notifications/NotificationsPage.tsx`, `src/components/profile/MyProfilePage.tsx`, `EditProfileForm.tsx`, `src/layouts/CommunityLayout.astro`, `src/components/legal/LegalConsentGate.tsx`, `LegalConsentPage.tsx`.
- Policy: `src/lib/legal-policy.ts`, `legal-consent-client.ts`, `src/lib/server/legal-consent.server.ts`, `legal-consent-repository.server.ts`, `legal-consent-mutation.server.ts`, `legal-consent-api.server.ts`, `src/pages/api/legal/consent.ts`; keep `src/pages/terms/index.astro` and `privacy/index.astro` legal text unchanged pending policy-owner review.
- User/community routes: `src/pages/api/users/me/{summary,profile,notifications}.ts`; `src/pages/api/forum/{posts,comments,circles,reports,post-media,media-upload-guard,external-video-upload}.ts`; `src/pages/api/forum/circles/[slug]/{posts,comments,manage}.ts`.
- Admin routes: `src/pages/api/admin/{devices,news,reports,users}.ts`, `src/pages/api/admin/reports/[id].ts`, `src/pages/api/admin/reports/[id]/action.ts`, `src/pages/api/admin/forum/{me,media,posts,reports,circles}.ts`, `src/pages/api/admin/forum/circles/purge.ts`, `src/pages/api/admin/moderation/{approve,hide,reject,queue,lexicon-health}.ts`, `src/pages/api/admin/users/[id]/{ban,unban,suspend,warn,clear-warning,safety}.ts`, `src/pages/api/admin/trusted-runtime/capability.ts`.
- Shared route helpers: `src/lib/server/{admin-auth,circle-management,device-admin,moderation-admin,reports.server,user-safety.server,rate-limit,consume-forum-rate-limit.server,moderation-notifications.server,media-cleanup,admin-circle-purge.server,supabase-admin.server,supabase-admin-client.server}.ts` as appropriate; existing trusted admin client project assertion is unchanged.
- Public/private media routes: `src/pages/api/media/{post/[mediaId],circle/[circleId],profile/[userId]/[kind]}.ts` only where caller-specific private access is detected; public delivery must stay public.
- Existing auth/legal/header/permission tests in `scripts/test-auth-legal-acknowledgement.mjs`, `test-legal-consent-auth-flow.mjs`, `test-legal-consent-persistence.mjs`, `test-legal-consent-mutation-guard.mjs`, `test-mobile-header-auth.mjs`, `test-auth-redirect-safety.mjs`, `test-legal-consent-service-role-audit.cjs`, and focused API tests to match the new contract.

**TEST**

- The eight new `scripts/test-verified-session-*.mjs` suites above, plus existing `scripts/test-user-{summary,profile,notifications}-api-safety.mjs`, `test-media-upload-guard-authorization.mjs`, `test-device-admin-api-matrix.mjs`, `test-forum-*-authorization.mjs`, `test-profile-media-delivery-authorization.mjs`, `test-post-media-delivery-authorization.mjs`, `test-circle-cover-media-visibility.mjs`, and existing legal/header suites. SQL tests run only against disposable local Supabase.

**MIGRATION**

- `supabase/migrations/20260923000000_ogh_verified_session_v1.sql`: one forward-only migration for four tables, narrow functions, grants, RLS, Storage policies, and RPC hardening. Do not edit historical migrations.

## Authorization Surface Ledger

| Owner task | Current entry points | Required position |
| --- | --- | --- |
| 5 | `admin-auth.ts` (`requireModerator`, `requireAdmin`), `circle-management.ts`, route-local `getUser` in forum/user routes | Signed claims and live predicate before profile role, actor, ownership, consent, rate limit, upload, or mutation. |
| 6 | `profiles`, `circles`, `posts`, `comments`, `reports`, `report_events`, `moderation_actions`, `post_votes`, `bookmarks`, `comment_reactions`, `post_media`, `forum_upload_attempts`, `forum_notifications`, `user_safety_states`, `user_safety_events`, `legal_policy_acceptances`, `news_articles`, `devices`, `device_spec_definitions`, `device_specs`, `device_sources`, `device_source_links`, `device_spec_evidence`, `catalog_audit_events` | Restrictive verified gate on authenticated writes and private reads. Keep public published/select policies, staff/owner checks, and auth bootstrap independent. |
| 6 | Mutating callable `record_current_legal_policy_acceptance`, `consume_verification_email_resend_limit`, `increment_post_view_count`, `increment_news_article_view`, notification/rate-limit/admin purge/QA role RPCs; all other `EXECUTE` grants from migrations | Classify: consent/signup bootstrap exempt, public view counters preserve public semantics, ordinary mutators require verified, service-only/admin RPCs retain stricter existing grant and require verified actor before invocation. Test direct RPC. |
| 6 | `storage.objects`: `post-media` post/cover paths, `profile-media` avatar/banner, `news-media` cover/content | Gate authenticated INSERT/UPDATE/DELETE and private SELECT; leave public media selects. R2 presigned upload is separately gated at Worker route. |
| 6, 15 | `HeaderNotifications.tsx`, `NotificationsPage.tsx`, `PostSocialActions.tsx`, `CommentsSection.tsx`; publication on `forum_notifications`, `comments`, `post_votes`, `comment_reactions` | RLS-gated private notification subscription; public interaction broadcasts remain readable only at existing visibility. Pending subscriber gets no private rows. |
| 7 | `src/pages/api/admin/**` and `src/pages/api/forum/**`, `/users/me/**` | Require verified before existing permission checks and every privileged service operation; public GETs stay available. |
| 7 | Service-role `legal-consent-repository.server.ts` | Only narrow pending consent bootstrap may write before verified, after `getClaims`/user identity and explicit acceptance; never generic service access. |
| 7 | Service-role `consume-forum-rate-limit.server.ts` via `rate-limit.ts`; `moderation-notifications.server.ts` via reports/user-safety; `admin-circle-purge.server.ts`, `supabase-admin.server.ts` via trusted-runtime/admin routes | Verified + role/owner/consent before client construction, RPC, notification, storage purge, or privileged admin lookup. Call-log tests assert zero privileged calls for pending. |

`src/lib/supabase-server.ts` is anon-only public SSR and must stay public. `src/lib/supabase-browser.ts` owns browser session and Realtime auth, not authorization. Public GET `/api/news`, `/api/news/[slug]`, `/api/forum/search`, published feed/products and media proxy paths remain anonymous. No private Realtime channel authorization was found beyond database-change subscriptions; do not add a new channel subsystem.

### Service-Role Path Audit

| Path / operation | Current guard | Required verified guard position |
| --- | --- | --- |
| `src/lib/server/legal-consent-repository.server.ts` / `createLegalConsentWriteClient`, `record_current_legal_policy_acceptance` | `src/pages/api/legal/consent.ts` checks bearer with `auth.getUser` and current consent payload | Explicit **bootstrap exception**: signed user claims, exact user-bound request, explicit policy acceptance, narrow new writer RPC before service-client creation; no generic privileged action. |
| `src/lib/server/consume-forum-rate-limit.server.ts` / `createRateLimitRpcClient`, `consume_forum_rate_limit` | Callers authenticate actor/consent but no verified-session check | In every forum create/upload caller, before `rate-limit.ts` or `consumeForumRateLimit`, and again via direct RLS/EXECUTE audit. |
| `src/lib/server/moderation-notifications.server.ts` / `createModerationNotificationServiceClient`, notification RPC | Lazy client after moderation action; admin/role checked upstream | In each admin reports/user-safety action before notification writer is constructed and before the underlying moderation write. |
| `src/lib/server/supabase-admin-client.server.ts` / `createServerAdminSupabaseClient`, trusted secret/admin API | Canonical project URL and secret; callers have admin guard | In caller's `requireAdmin` before client construction. Keep canonical-project assertion; the secret alone must not authorize a user. |
| `src/lib/server/admin-circle-purge.server.ts` / `handleAdminCirclePurge`, admin client/RPC/storage delete | `requireAdmin` before client construction | Make `requireAdmin` enforce verified session before preview RPC, Storage deletion, or purge RPC. |
| `src/lib/server/supabase-admin.server.ts` / `handleTrustedAdminRuntimeCapability`, `auth.admin.listUsers` | `requireAdmin` before client construction | Make `requireAdmin` enforce verified session before read-only capability probe or admin-client construction. |

All other admin routes use user-token clients through `requireAdmin`/`requireModerator` or route-local auth; Task 7 must still assert zero privileged calls for pending on each mapped route. `media-cleanup.ts`, `reports.server.ts`, and `user-safety.server.ts` receive clients or writers from callers and inherit the same upstream requirement; tests must reject a pending actor before entering them. This is six direct service-role constructor/consumer paths, not six separate credentials.

## Four-Table Forward Schema

The migration owns all four `private` tables as `postgres`; `REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated`, and no direct table grants to browser roles. Server RPC entrypoints are in the existing exposed `public` schema, with `EXECUTE` only for `service_role`; do not expose `private` through PostgREST. `service_role` receives only the minimum table/function privileges needed for server operations. `auth.sessions` FK is deliberately not cascaded: live-row lookup, not stale private-row cleanup, decides access. Indexes are specified below; `pgcrypto` use must be schema-qualified.

| Table | Columns and constraints | Indexes/ACL |
| --- | --- | --- |
| `private.ogh_verified_sessions` | `session_id uuid PRIMARY KEY NOT NULL`; `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`; `verified_at timestamptz NOT NULL DEFAULT now()`; `verification_kind text NOT NULL CHECK (verification_kind IN ('signup','login_challenge'))`; `revoked_at timestamptz NULL`; `CHECK (revoked_at IS NULL OR revoked_at >= verified_at)` | `(user_id, verified_at DESC)`; no direct anon/authenticated grants; service-role maintenance only. Predicate also joins `auth.sessions(id,user_id)` and requires `revoked_at IS NULL`. |
| `private.ogh_login_challenges` | `id uuid PRIMARY KEY NOT NULL` (Worker-generated); `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`; `session_id uuid NOT NULL`; `code_digest bytea NOT NULL CHECK(octet_length(code_digest)=32)`; `created_at timestamptz NOT NULL DEFAULT now()`; `expires_at timestamptz NOT NULL CHECK(expires_at>created_at)`; `attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)`; `send_count smallint NOT NULL DEFAULT 0 CHECK(send_count BETWEEN 0 AND 3)`; `next_send_at timestamptz NOT NULL`; `delivery_state text NOT NULL CHECK(delivery_state IN ('reserved','accepted','unusable'))`; `consumed_at timestamptz NULL`; `superseded_at timestamptz NULL` | Unique partial index on `(session_id) WHERE consumed_at IS NULL AND superseded_at IS NULL`; `(user_id, created_at DESC)`; `(expires_at)` for later separately reviewed cleanup. Resend copies attempt/send counters into a new row and supersedes the old row, retaining old ID for explicit superseded rejection. Never expose digest or challenge row to browser. |
| `private.ogh_email_send_budget` | `utc_day date NOT NULL`; `scope text NOT NULL CHECK(scope IN ('global','user','session','ip_hash'))`; `scope_key text NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 128)`; `send_count integer NOT NULL DEFAULT 0 CHECK(send_count>=0)`; `updated_at timestamptz NOT NULL DEFAULT now()`; `PRIMARY KEY (utc_day,scope,scope_key)` | Composite PK supports atomic `INSERT ... ON CONFLICT DO UPDATE` under row lock; keyed HMAC IP digest only, no raw IP/email. No browser grants. |
| `private.ogh_policy_acceptances` | `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`; `bundle_version text NOT NULL`; `terms_version text NOT NULL`; `privacy_version text NOT NULL`; `guidelines_version text NOT NULL`; `acceptance_source text NOT NULL CHECK(acceptance_source IN ('registration','login','policy_update','legacy_account_gate','authenticated_callback'))`; `accepted_at timestamptz NOT NULL DEFAULT now()`; `PRIMARY KEY(user_id,bundle_version)`; nonempty version CHECKs | `(user_id,accepted_at DESC)`; no age column, no browser grant. Historical `public.legal_policy_acceptances` stays intact and readable by the existing owner policy. |

The policy-owner must decide wording in Terms/Privacy before release; code must stop treating `minimumAge`/`minimum_age` as an auth gate. Historical `minimum_age` remains archival only.

## SQL Function Contract

All `SECURITY DEFINER` functions are owned by `postgres`, `SET search_path = ''`, schema-qualify every object, and start with `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. Grant only the listed role. Service-role functions accept `p_user_id/p_session_id` only after Worker Class A verification, and re-check `auth.sessions`; user-token predicate accepts no identity parameters. SQL errors map to stable non-enumerating API codes.

| Name / signature -> return | Security, grant, caller | Authority and concurrency |
| --- | --- | --- |
| `public.ogh_is_verified_session() RETURNS boolean` | DEFINER, `GRANT EXECUTE TO authenticated`; RLS and Worker user-token RPC | `auth.uid()` and `auth.jwt()->>'session_id'` only; safely parse UUID; require non-anonymous JWT, same user/live `auth.sessions` row and non-revoked verified row. Missing/malformed/DB error false, not an exception-based allow. |
| `public.ogh_reserve_login_challenge(p_user_id uuid,p_session_id uuid,p_challenge_id uuid,p_digest bytea,p_ip_hash text,p_now timestamptz,p_resend boolean) RETURNS text` | DEFINER, service_role only; Worker challenge service | Worker generates a random challenge UUID before computing HMAC over that ID, user, session, and code; verify live owned `auth.sessions`; serialize on session advisory transaction lock then challenge row; enforce password precondition at Worker; start idempotent, resend >=60s, <=3 sends/session, <=5/user/day, <=10/IP-hash/day, <=100/global/day; reserve all budget counters and a new unusable-until-accepted digest in one transaction. Deterministic `RESERVED|PENDING|RESEND_COOLDOWN|EMAIL_BUDGET_EXHAUSTED|SESSION_GONE`. No send on non-RESERVED. |
| `public.ogh_finalize_login_delivery(p_user_id uuid,p_session_id uuid,p_challenge_id uuid,p_accepted boolean,p_now timestamptz) RETURNS boolean` | DEFINER, service_role only; Worker after one provider attempt | Match same challenge under lock; accepted marks usable, rejected/ambiguous marks unusable; never credit back uncertain quota or auto resend. Old challenge superseded atomically on successful reservation. |
| `public.ogh_consume_login_challenge(p_user_id uuid,p_session_id uuid,p_challenge_id uuid,p_digest bytea,p_now timestamptz) RETURNS text` | DEFINER, service_role only; Worker verification route | Lock session then challenge; verify live ownership, accepted delivery, not superseded/consumed, `now<expires_at`, digest equality via server-computed HMAC, and attempt count; wrong attempt increments exactly once, final attempt exhausts; correct code consumes and inserts one verified row in the same transaction. `VERIFIED|CHALLENGE_INVALID|CHALLENGE_EXPIRED|CHALLENGE_EXHAUSTED|CHALLENGE_SUPERSEDED|SESSION_GONE`. Logout/verify race is serialized by session lock. |
| `public.ogh_activate_signup_session(p_user_id uuid,p_session_id uuid,p_now timestamptz) RETURNS boolean` | DEFINER, service_role only; server endpoint after provider `type:"signup"` result | Require exact returned user/session and live `auth.sessions` ownership, insert `verification_kind='signup'` once. No browser EXECUTE or arbitrary OTP session activation. |
| `public.ogh_revoke_verified_session(p_user_id uuid,p_session_id uuid,p_now timestamptz) RETURNS boolean` | DEFINER, service_role only; logout endpoint | Lock session, require owned row, set `revoked_at` before `auth.signOut({scope:'local'})`; idempotent only for the same actor/session; other sessions unaffected. |
| `public.ogh_record_policy_acceptance(p_user_id uuid,p_bundle text,p_terms text,p_privacy text,p_guidelines text,p_source text,p_now timestamptz) RETURNS void` | DEFINER, service_role only; consent bootstrap route | Worker validates signed identity and explicit checkbox; upsert only this user/bundle, current versions and allowed source; historical reader remains read-only. No age input. |
| `public.ogh_has_current_policy_acceptance(p_bundle text,p_terms text,p_privacy text,p_guidelines text) RETURNS boolean` | DEFINER, authenticated only; legal-status reader | Derive user from `auth.uid()`, never an ID argument. Check matching private row or historical `public.legal_policy_acceptances` versions; ignore historical `minimum_age`; return bool only and fail closed. Worker supplies current policy versions, and protected writes still separately require verified session. |

The SQL function set is eight. Migration tests must inspect effective function ACL/owner/search path and ensure unauthenticated and ordinary authenticated callers cannot execute service-only functions directly. The two user-token predicates return only booleans and leak no private row fields.

## API Error Contract

All responses are JSON, `Cache-Control: no-store`, with a stable `error` string. `INVALID_AUTH` = 401; `VERIFICATION_REQUIRED` = 403 with sanitized `/login/?next=...` or verification continuation; `CHALLENGE_INVALID`, `CHALLENGE_EXPIRED`, `CHALLENGE_EXHAUSTED`, `CHALLENGE_SUPERSEDED` = 400 without account enumeration; `RESEND_COOLDOWN`, `EMAIL_BUDGET_EXHAUSTED` = 429; `VERIFICATION_SERVICE_UNAVAILABLE` = 503. Existing owner/role denial remains 403 after verification. Auth/DB/provider uncertainty never becomes a verified response. Only reason codes, random request IDs, and aggregate counts may be logged.

## Task 1: Shared state and claim boundary

**Files:** Create `src/lib/verified-session-state.ts`, `src/lib/server/verified-session.server.ts`, `scripts/test-verified-session-claims.mjs`.

**Interfaces:** Consumes `admin-auth.ts` `RuntimeEnv`, `getBearerToken`, `createUserClient`; produces `VerifiedSessionClaims {userId:string;sessionId:string;amr:readonly {method:string;timestamp?:number}[];expiresAt:number}`, `getTrustedSessionClaims(token,env)`, `requireVerifiedSession(request,env)` and `SessionState`. `getTrustedSessionClaims` uses only `auth.getClaims(token)`, validates `sub/session_id` UUID, `exp`, `is_anonymous===false`, and normalizes provider AMR objects from the verified claims. `requireVerifiedSession` calls user-token `public.ogh_is_verified_session()`; never trusts browser state.

- [ ] RED: add signed valid/tampered/forged-session/forged-amr/expired/user-metadata tests and DB-unavailable/malformed-claims/pending/stale tests; `node --experimental-strip-types scripts/test-verified-session-claims.mjs` must fail because exports are absent.
- [ ] Implement claim parsing and typed fail-closed results; no raw JWT decode and no `getUser` plus separately decoded payload.
- [ ] GREEN: run `node --experimental-strip-types scripts/test-verified-session-claims.mjs`; all valid/negative controls pass on mocked unit cases and disposable signed local tokens.
- [ ] Regression: `npm run test:auth-redirect-safety`; no new redirect parser.
- [ ] Stage `src/lib/verified-session-state.ts src/lib/server/verified-session.server.ts scripts/test-verified-session-claims.mjs`; commit `feat(auth): establish trusted verified-session boundary`.

## Task 2: Forward private schema and live predicate

**Files:** Create `supabase/migrations/20260923000000_ogh_verified_session_v1.sql`, `scripts/test-verified-session-sql.mjs`.

**Interfaces:** Consumes Task 1 state contract and Supabase `auth.sessions`; produces the four tables above and `public.ogh_is_verified_session()`.

- [ ] RED: disposable local migration test asserts exactly four private tables, every column/constraint/index/ACL above, and predicate false for anon, pending, wrong session, removed session, revoked session, DB failure; true only for matching live row. `node scripts/test-verified-session-sql.mjs` fails before migration.
- [ ] Implement forward migration DDL and predicate with `SECURITY DEFINER`, owner `postgres`, fixed empty search path, narrow authenticated EXECUTE.
- [ ] GREEN: replay full migrations into disposable local Supabase and run `node scripts/test-verified-session-sql.mjs`; assert direct private table SELECT/INSERT denied for `anon`/`authenticated`.
- [ ] Regression: `node scripts/verify-forum-permissions.cjs` against local fixture and `npm run test:profile-role-security`; published/anonymous selects unchanged.
- [ ] Stage `supabase/migrations/20260923000000_ogh_verified_session_v1.sql scripts/test-verified-session-sql.mjs`; commit `feat(auth): add private session state and live predicate`.

## Task 3: Atomic challenge, quota, signup, revoke, policy SQL

**Files:** Extend the new forward migration after Task 2; extend `scripts/test-verified-session-sql.mjs`.

**Interfaces:** Produces the six service-only public RPC functions plus the authenticated policy-status predicate after the live-session predicate in the SQL contract. Service-only functions have service-role-only EXECUTE; only these functions and the two user-token predicates may access the private tables.

- [ ] RED: local concurrent tests for two starts, simultaneous resend, same-code double consume, superseded code, cross-session code, final-attempt race, budget race, logout-vs-verify, session disappearance between start/consume, and policy-only historical/new acceptance; assert `AT_MOST_ONE_VERIFICATION_TRANSITION_PER_CHALLENGE_SESSION=true` and no browser service-only EXECUTE. `node scripts/test-verified-session-sql.mjs` fails with missing functions.
- [ ] Implement transaction advisory lock keyed by session, row locking, atomic daily upsert counters, delivery-state transition, and one-transaction consume/verified insert. Avoid a function per UI action beyond the six listed.
- [ ] GREEN: `node scripts/test-verified-session-sql.mjs` on disposable local Supabase passes repeated concurrency runs; quota <=100 global/day, <=5 user/day, <=3 session sends, >=60s resend.
- [ ] Regression: `npm run test:legal-consent-persistence` and existing SQL policy tests pass locally.
- [ ] Stage the explicit migration and SQL test paths; commit `feat(auth): make challenge and policy writes atomic`.

## Task 4: Brevo transport and challenge service

**Files:** Create `src/lib/server/brevo-challenge.server.ts`, `src/lib/server/login-challenge.server.ts`, `scripts/test-verified-session-brevo.mjs`.

**Interfaces:** Consumes Task 1 `VerifiedSessionClaims`, Task 3 private RPCs; produces `sendFreshLoginCode({to,code,requestId},env,fetchImpl)`, `startChallenge`, `resendChallenge`, `verifyChallenge` with typed API errors. `BREVO_API_KEY`, `BREVO_VERIFIED_SENDER_EMAIL`, and `OGH_LOGIN_CODE_PEPPER` are server-only bindings.

- [ ] RED: mock fetch/DB for missing secret, timeout, 2xx acceptance, 4xx rejection, ambiguous network/5xx response, quota/cooldown, unknown account parity, and absent password `amr`. Run `node --experimental-strip-types scripts/test-verified-session-brevo.mjs`; missing exports fail.
- [ ] Implement six-digit CSPRNG code, HMAC-SHA256 over challenge/user/session/code, provider request to `https://api.brevo.com/v3/smtp/email` with bounded timeout and already verified sender; no code/key/token/address logging. Reserve quota before send, finalize accepted only on definite 2xx; uncertain result unusable and no automatic retry.
- [ ] GREEN: run the same suite, assert exactly one provider call per reservation and zero on denied starts.
- [ ] Regression: `npm run test:auth-legal-consent`; signup/reset still use Supabase Auth SMTP.
- [ ] Stage the three explicit files; commit `feat(auth): add bounded fresh-login email transport`.

## Task 5: Server guard and stable session-state API

**Files:** Modify `src/lib/server/admin-auth.ts`, `circle-management.ts`, `legal-consent-mutation.server.ts`; create `src/pages/api/auth/session-state.ts`, `scripts/test-verified-session-routes.mjs`.

**Interfaces:** Consumes Tasks 1-3; `requireVerifiedSession(request,env)` returns verified identity/client or `INVALID_AUTH`, `VERIFICATION_REQUIRED`, `VERIFICATION_SERVICE_UNAVAILABLE`; `GET /api/auth/session-state` returns only `ANONYMOUS|PENDING_VERIFICATION|VERIFIED_AUTHENTICATED` plus policy axis, never private row data. `requireCurrentPolicyConsent` remains independent.

- [ ] RED: route tests for anon/pending/verified/stale/DB-unavailable/password-only, malformed bearer, no downstream lookup for pending, and policy-pending bootstrap. Run `node --experimental-strip-types scripts/test-verified-session-routes.mjs`; expect missing route/guard failures.
- [ ] Implement guard before moderator/profile/consent/ownership reads; use signed claims and live user-token RPC. Preserve old owner/role errors only after verified.
- [ ] GREEN: focused route suite passes; `npm run test:legal-consent-mutation-guard` passes after expectation updates.
- [ ] Regression: `npm run test:device-admin-api-matrix` and `npm run test:auth-redirect-safety`.
- [ ] Stage five explicit files; commit `feat(auth): gate server identities on live verified sessions`.

## Task 6: Direct RLS, RPC, Storage, and Realtime coverage

**Files:** Extend the new migration before final release branch merge, `scripts/test-verified-session-sql.mjs`, `scripts/test-verified-session-bypass.mjs`.

**Interfaces:** Consumes `public.ogh_is_verified_session()`; produces restrictive verified policies for every authenticated-write/private-read table listed in the surface ledger, effective mutating-RPC EXECUTE restrictions, and verified Storage write/private-read policies. Public SELECT remains public.

- [ ] RED: direct PostgREST with password-only JWT can currently write/read private targets; Storage can write; mutating RPC calls bypass Worker; private notification Realtime can subscribe. Add all surface-ledger actors to `node scripts/test-verified-session-bypass.mjs` and expect those controls to fail until migration policy hardening.
- [ ] Implement `AS RESTRICTIVE` gate for authenticated writes and wholly private reads without removing existing owner/staff policies. On mixed public/private SELECT tables, preserve the public branch and add the predicate only to the private branch; a blanket restrictive SELECT would wrongly hide public rows from pending users. Check table grants first; close SECURITY DEFINER or public EXECUTE bypasses, exempt consent/signup bootstrap and public counters deliberately. Add verified condition to `post-media`, `profile-media`, `news-media` write/private policies; keep public object reads and visibility rules. Keep `forum_notifications` publication; its row visibility must honor verified RLS.
- [ ] GREEN: `node scripts/test-verified-session-bypass.mjs` and SQL suite pass for anonymous/pending/verified/staff plus direct REST/RPC/Storage/Realtime actors.
- [ ] Regression: `node scripts/test-post-media-delivery-authorization.mjs`, `node scripts/test-profile-media-delivery-authorization.mjs`, `node scripts/test-circle-cover-media-visibility.mjs`, `npm run test:products`, and public news/feed reads pass.
- [ ] Stage explicit migration and two test files; commit `feat(auth): enforce verified state on direct data surfaces`.

## Task 7: Worker/API and service-role authorization audit

**Files:** Modify every protected `src/pages/api/users/me/**`, `src/pages/api/forum/**`, `src/pages/api/admin/**` path in File Map and shared server helpers listed there; extend `scripts/test-verified-session-routes.mjs`, `scripts/test-verified-session-bypass.mjs`.

**Interfaces:** Consumes Task 5 guard; produces uniform pending 403 before any privileged API, service-role client construction, upload signing, rate-limit RPC, notification writer, purge, moderation, or admin capability operation. Public GETs and legal/auth bootstrap are explicit exceptions.

- [ ] RED: for every route/method in File Map, inject a pending token and spy on service/DB/R2/Brevo/notification calls; assert zero downstream privileged calls and stable `VERIFICATION_REQUIRED`. Run both focused route/bypass suites; expect current route failures.
- [ ] Put guard immediately after bearer parsing and before route-local `getUser`, `requireAuthenticatedLegalConsent`, `requireAdmin`, `requireModerator`, rate limit, or service-role helper. Make `admin-auth.ts` central for admin routes; keep existing role/owner/consent checks for verified actors. Public GETs use existing anon client and remain unauthenticated.
- [ ] GREEN: both focused suites pass for all mapped route methods, including `admin-circle-purge.server.ts`, trusted runtime, `moderation-notifications.server.ts`, `consume-forum-rate-limit.server.ts`, and legal-consent writer exception.
- [ ] Regression: run `npm run test:user-profile-api-safety`, `npm run test:user-summary-api-safety`, `npm run test:moderation-notification-writer`, and existing forum/admin authorization suites.
- [ ] Stage only explicitly modified API/helper/test paths as listed in `git diff --name-only`; commit `feat(auth): enforce verified state before privileged APIs`.

## Task 8: Fresh-login challenge endpoints

**Files:** Create `src/pages/api/auth/login-challenge/{start,resend,verify}.ts`; extend `scripts/test-verified-session-routes.mjs`.

**Interfaces:** POST start/resend/verify consume bearer token; claims from Task 1 only. Start requires confirmed provider email, `amr=password`, non-anonymous, owned live pending session; body cannot set authoritative email/user/session/amr. Verify accepts only opaque challenge ID and six-digit code. No endpoint grants normal privileged access except atomic verified transition.

- [ ] RED: test missing/forged claims, arbitrary email, no password method, stale session, duplicate start, cooldown, wrong/expired/replayed/cross-session code, provider ambiguity, quota, and DB failure. Focused route suite fails on missing endpoints.
- [ ] Implement thin routes calling Task 4 service; map all stable error codes, no-store, generic account response, sanitized continuation. Never auto retry Brevo or SQL.
- [ ] GREEN: `node --experimental-strip-types scripts/test-verified-session-routes.mjs`; `node scripts/test-verified-session-sql.mjs` concurrency subtests.
- [ ] Regression: `npm run test:auth-redirect-safety` and existing resend-confirmation suite.
- [ ] Stage the three route paths and focused test; commit `feat(auth): expose bounded login challenge endpoints`.

## Task 9: Provider-native signup confirmation

**Files:** Create `src/pages/api/auth/signup-confirm.ts`, `src/components/auth/SignupConfirmation.tsx`, `scripts/test-verified-session-signup.mjs`; modify `src/components/forum/AuthPanel.tsx`, `src/pages/api/auth/resend-confirmation.ts`.

**Interfaces:** Client sends `{email,code}` only; server hardcodes `supabase.auth.verifyOtp({email,token:code,type:"signup"})`, obtains returned session, validates its signed claims and live ownership, records explicit policy acceptance, and calls service-only `ogh_activate_signup_session`. On success the no-store endpoint returns only the provider session tokens to that requesting browser over HTTPS; the browser calls `supabase.auth.setSession({access_token,refresh_token})` before continuing. Resend keeps provider-native `auth.resend({type:"signup",email})`. No client type selector.

- [ ] RED: pin genuine six-digit signup code success, replay rejection, resent-code success/old-code rejection, generic email OTP/magic link/recovery/email change/cross-email rejection, `type:"email"` and `amr=otp` not accepted as provenance, and no client-selected type. Run `node --experimental-strip-types scripts/test-verified-session-signup.mjs`; expect absent endpoint/component.
- [ ] Implement signup code screen in existing AuthPanel visual language, hardcoded server provider type, returned-session-only activation. Provider response error never activates. Preserve existing password reset path.
- [ ] GREEN: focused signup suite with disposable exact-stack Supabase passes; local email only, no external delivery.
- [ ] Regression: `npm run test:auth-legal-consent` and resend abuse tests; check signup confirmation template operational requirement `{{ .Token }}` in release packet, not Production config.
- [ ] Stage the five exact paths; commit `feat(auth): activate only provider-confirmed signup sessions`.

## Task 10: Policy consent independent of age and auth

**Files:** Modify policy paths in File Map, `src/components/legal/{LegalConsentPage,LegalConsentGate}.tsx`, `src/layouts/CommunityLayout.astro`, `src/pages/api/legal/consent.ts`; update existing legal suites.

**Interfaces:** `requireCurrentPolicyConsent(repository,userId)` compares Terms/Privacy/Guidelines versions via `ogh_has_current_policy_acceptance` against new private acceptance or matching historical row; never compares `minimum_age`. Pending user may record explicit policy acceptance through narrow signed-identity bootstrap. `requireVerifiedSession` is separate and runs on protected mutations.

- [ ] RED: historical same-version record current despite `minimum_age`, version bump requires re-consent, no age checkbox/16+ account status, pending bootstrap accepted but unrelated mutation denied. Run `npm run test:legal-consent-persistence`, `npm run test:legal-consent-auth-flow`, `npm run test:legal-consent-page-gate`; expect current age assertions to fail.
- [ ] Implement new policy-only acceptance read/write, preserve historical data and public legal/Safety/Community Guidelines pages, remove only auth/UI age attestation. Do not silently edit Terms/Privacy content; release requires policy-owner wording decision.
- [ ] GREEN: three focused legal suites and `npm run test:legal-consent-route-coverage` pass.
- [ ] Regression: `npm run test:legal-consent-service-role-audit` proves pending only reaches narrow writer and no generic service operation.
- [ ] Stage only the listed policy/UI/route and test files; commit `feat(auth): separate policy consent from session verification and age`.

## Task 11: Login, callback, recovery, and logout UI

**Files:** Modify `src/components/forum/AuthPanel.tsx`, `src/components/auth/{AuthCallback,ResetPasswordForm}.tsx`, `src/pages/login/index.astro`, `src/pages/auth/callback.astro`; create `src/components/auth/LoginVerification.tsx`, `src/pages/api/auth/logout.ts`; extend `scripts/test-verified-session-ui.mjs`.

**Interfaces:** Password login calls start and remains pending until verify, then `getSafeNext(next)`. Callback/recovery never infer signup from a generic link/OTP and never mark fresh-login verified. Logout API revokes this verified row before browser `auth.signOut({scope:'local'})`; failure is surfaced, not reported as success.

- [ ] RED: browser/adapter tests for password pending, code entry/resend, verified navigation, expired/wrong/exhausted code, signup distinction, recovery to fresh password flow, logout revocation order, other session unchanged, and external/repeatedly encoded/malformed `next`. Run `node --experimental-strip-types scripts/test-verified-session-ui.mjs`; expect missing view/route.
- [ ] Implement continuation in existing auth-card style; sanitize every redirect with `getSafeNext`. Keep recovery and signup separate from fresh login; no automatic retry. Logout clears UI only after revocation and provider local sign-out complete.
- [ ] GREEN: focused UI suite and `npm run test:auth-redirect-safety` pass.
- [ ] Regression: `npm run test:auth-legal-consent`, `npm run test:legal-consent-auth-flow` pass.
- [ ] Stage exact auth UI/route/test paths; commit `feat(auth): complete verified login and local logout journey`.

## Task 12: Header, private UI, and degraded summary

**Files:** Modify `src/components/auth/useBrowserAuthState.ts`, `src/components/site/{HeaderUserMenu,HeaderNotifications,SiteHeader.astro}`, `src/components/notifications/NotificationsPage.tsx`, `src/components/profile/{MyProfilePage,EditProfileForm}.tsx`, `src/layouts/CommunityLayout.astro`; extend `scripts/test-verified-session-ui.mjs`, existing `scripts/test-mobile-header-auth.mjs`.

**Interfaces:** Browser auth hook consults `/api/auth/session-state` after `getSession` and on auth changes; only server-confirmed `VERIFIED_AUTHENTICATED` exposes account menu. Anonymous shows default avatar plus `未登录` as one login link with safe next. Pending shows verification/signout/recovery only. Verified summary failure keeps identity and hides statistics rather than fabricating zeros.

- [ ] RED: test anonymous/pending/verified/stale/DB-unavailable, profile-summary 500, no zero-stat fabrication, notifications hidden pending, profile/admin navigation absent pending. Run `node scripts/test-mobile-header-auth.mjs` and focused UI suite; expect old `getSession`-alone behavior to fail.
- [ ] Implement state-driven header and private-page gates; retain OpenGlass navigation, icons, and layout. Suppress private Realtime subscriptions until verified and tear them down on logout.
- [ ] GREEN: both suites pass at 390px, 430px and desktop local screenshot checks for login/code/header, with no overlapping controls.
- [ ] Regression: `npm run build`, `npm run test:legal-consent-page-gate-visual` (local only).
- [ ] Stage listed UI/layout/test paths; commit `fix(auth): render account controls from verified state`.

## Task 13: Full bypass and concurrency integration

**Files:** Extend `scripts/test-verified-session-bypass.mjs`, `test-verified-session-sql.mjs`, `test-verified-session-routes.mjs`, `test-verified-session-signup.mjs`; no new production paths.

**Interfaces:** End-to-end disposable actors: anonymous, pending password, verified A, fresh B, stale A after logout, staff, and service role. Direct PostgREST/RPC/Storage/Realtime cannot bypass gate; public reads still work.

- [ ] RED: add every spec threat-model case not already covered, especially email-budget race, same code twice concurrently, old signed JWT after signout, stale session, owner/role preservation, direct RPC/Storage, user metadata, summary failure, signup negative artifacts. Run all four suites; any uncovered bypass fails.
- [ ] Make only narrowly identified fixes in owning Task 1-12 files with a separate explicit diff review; do not broaden scope or weaken policy to force GREEN.
- [ ] GREEN: repeated local runs of all four suites, `npm test`, `npm run build`, `npm run test:auth-redirect-safety`, existing legal/header/security tests, and `git diff --check` pass.
- [ ] Regression: anonymous `/products/`, published devices, feed/forum public GET, news, and public media with no token; no public policy contains verified predicate.
- [ ] Stage only changed tests and justified owning files; commit `test(auth): close verified-session bypass matrix`.

## Task 14: Release preparation, no Production action

**Files:** Create `docs/ops/verified-session-v1-release-gates.md`, `scripts/test-verified-session-release.mjs`; optionally modify only the release packet after review.

**Interfaces:** Produces a non-executable review packet with five stages: backward-compatible code ready; DB security layer; Worker/API enforcement activation; bounded auth verification; closeout. Each future Production mutation requires its own authorization. No default-open fallback.

- [ ] RED: `node scripts/test-verified-session-release.mjs` checks package/lockfile versions, all four table names, eight function signatures, no fifth table, no `qa:prod`/deploy step, full route/policy surface ledger, no paid service, and explicit stop gates; absent packet fails.
- [ ] Document hosted `getClaims` signing behavior, session/AMR and signup `type:"signup"` compatibility, sender/API key and shared Brevo Free quota, public legal wording review, effective Production ACL drift audit, template `{{ .Token }}`, local/preview matrix, rollback that preserves gate, and release evidence fields. Do not run any stage.
- [ ] GREEN: release suite passes; `npm test`, `npm run build`, and `git diff --check` pass locally.
- [ ] Regression: review no Production URL/secret/password/code/token/log content in packet or diff.
- [ ] Stage `docs/ops/verified-session-v1-release-gates.md scripts/test-verified-session-release.mjs`; commit `docs(auth): prepare verified-session release gates`.

## Completion and Handoff

Before any future activation: all four tables and eight SQL functions exist in local/preview with exact ACLs; pending is denied by direct DB/RPC/Storage and all privileged Worker/service-role paths; Realtime private notifications deny pending; public reads remain public; fresh-login and provider-native signup negative controls pass; legal consent is versioned and independent; no 16+ auth gate; logout invalidates old JWT via live-session predicate; Free quotas and fail-closed behavior pass. Full-active status requires separately authorized Production verification of every stage, never process exit alone.

After Verified Session v1 is implemented, reviewed, separately released, and verified, `NEXT_TASK_AFTER_AUTH=PRODUCT_DETAIL_V2`: replace the `/products/{brand}/#product-{slug}` anchor with a normalized Schema v1 detail page. Do not start Compare v2 or Product Detail on this branch.
